-- Social Content Factory OS — Phase 2 (docs/ARCHITECTURE.md):
--   1. Кампании: publish_campaigns + publish_campaign_items, publish_jobs.campaign_id,
--      SQL-планировщик plan_campaign_day / plan_publish_campaigns (крон ежечасно), витрина.
--   2. Исходящие вебхуки: publish_webhooks + publish_webhook_deliveries, события из
--      publish_jobs / publish_notifications триггерами, claim для воркера publish-webhooks.
--   3. Feature flags проекта: publish_project_settings.features jsonb.
-- Идемпотентна, ничего не удаляет.

-- ── 1. Кампании ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.publish_campaigns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  objective      text,
  status         text NOT NULL DEFAULT 'draft',
  start_date     date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Almaty')::date,
  end_date       date,
  timezone       text,
  group_id       uuid REFERENCES public.publish_account_groups(id) ON DELETE SET NULL,
  account_ids    uuid[] NOT NULL DEFAULT '{}',
  posts_per_day  integer NOT NULL DEFAULT 1 CHECK (posts_per_day BETWEEN 1 AND 24),
  slot_times     time[] NOT NULL DEFAULT '{}',
  weekdays       integer[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  mode           text NOT NULL DEFAULT 'drip',
  distribution   text NOT NULL DEFAULT 'fanout',
  planned_until  date,
  completed_at   timestamptz,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_campaigns_status_check CHECK (status IN ('draft','active','paused','completed','archived')),
  CONSTRAINT publish_campaigns_mode_check CHECK (mode IN ('drip','now')),
  CONSTRAINT publish_campaigns_distribution_check CHECK (distribution IN ('fanout','spread')),
  CONSTRAINT publish_campaigns_period_check CHECK (end_date IS NULL OR end_date >= start_date)
);
COMMENT ON TABLE public.publish_campaigns IS
  'Кампания: период, аккаунты (группа и/или список), правило публикации (постов в день, времена слотов, дни недели), очередь контента. fanout — каждое видео во все аккаунты; spread — каждое видео в один аккаунт по кругу.';
CREATE INDEX IF NOT EXISTS publish_campaigns_project_idx ON public.publish_campaigns (project_id, status, created_at DESC);
ALTER TABLE public.publish_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publish_campaigns_select ON public.publish_campaigns;
CREATE POLICY publish_campaigns_select ON public.publish_campaigns FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
GRANT SELECT ON public.publish_campaigns TO authenticated;
DROP TRIGGER IF EXISTS trg_publish_campaigns_updated ON public.publish_campaigns;
CREATE TRIGGER trg_publish_campaigns_updated BEFORE UPDATE ON public.publish_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.publish_campaign_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES public.publish_campaigns(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  video_id     uuid NOT NULL REFERENCES public.publish_videos(id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'queued',
  planned_at   timestamptz,
  jobs_count   integer NOT NULL DEFAULT 0,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_campaign_items_status_check CHECK (status IN ('queued','planned','skipped')),
  CONSTRAINT publish_campaign_items_uniq UNIQUE (campaign_id, video_id)
);
CREATE INDEX IF NOT EXISTS publish_campaign_items_queue_idx ON public.publish_campaign_items (campaign_id, status, position, created_at);
ALTER TABLE public.publish_campaign_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publish_campaign_items_select ON public.publish_campaign_items;
CREATE POLICY publish_campaign_items_select ON public.publish_campaign_items FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
GRANT SELECT ON public.publish_campaign_items TO authenticated;

ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.publish_campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS publish_jobs_campaign_idx ON public.publish_jobs (campaign_id, scheduled_at) WHERE campaign_id IS NOT NULL;

-- Времена слотов: заданные пользователем или равномерно между 10:00 и 19:00.
CREATE OR REPLACE FUNCTION public.publish_campaign_slot_times(p_slot_times time[], p_posts_per_day integer)
RETURNS time[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(cardinality(p_slot_times), 0) > 0 THEN (SELECT array_agg(t ORDER BY t) FROM unnest(p_slot_times) AS t)
    WHEN greatest(p_posts_per_day, 1) = 1 THEN ARRAY['12:00'::time]
    ELSE (SELECT array_agg((time '10:00' + (interval '9 hours' * (i::numeric / (greatest(p_posts_per_day, 1) - 1))))::time ORDER BY i)
            FROM generate_series(0, greatest(p_posts_per_day, 1) - 1) AS i)
  END;
$$;

-- Годные аккаунты кампании: группа (group_id или старый список) ∩ явный список, активные, здоровые.
CREATE OR REPLACE FUNCTION public.publish_campaign_accounts(p_campaign_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id
    FROM public.publish_campaigns c
    LEFT JOIN public.publish_account_groups g ON g.id = c.group_id
    JOIN public.publish_accounts a ON a.project_id = c.project_id
   WHERE c.id = p_campaign_id
     AND a.status = 'active' AND a.publish_enabled AND a.health_score >= 20
     AND (c.group_id IS NULL OR a.group_id = c.group_id OR a.id = ANY (coalesce(g.account_ids, '{}')))
     AND (cardinality(c.account_ids) = 0 OR a.id = ANY (c.account_ids))
     AND (g.platform IS NULL OR a.platform = g.platform)
     AND coalesce(g.review_mode, 'review_required') <> 'paused'
   ORDER BY a.health_score DESC, a.created_at;
$$;

/*
 * Планирование одного дня кампании. Идемпотентно: уже занятые слоты дня считаются по
 * planned_at (fanout) или по заданиям аккаунта (spread), планируются только оставшиеся.
 * Прошедшие слоты (старше часа) не догоняем. Возвращает, что запланировано.
 */
CREATE OR REPLACE FUNCTION public.plan_campaign_day(p_campaign_id uuid, p_day date)
RETURNS TABLE (video_id uuid, slot_at timestamptz, jobs_created integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  c        public.publish_campaigns%ROWTYPE;
  tz       text;
  slots    time[];
  slot     time;
  slot_ts  timestamptz;
  day_from timestamptz;
  day_to   timestamptz;
  idx      integer := 0;
  already  integer;
  item     public.publish_campaign_items%ROWTYPE;
  ids      uuid[];
  n        integer;
  acc      uuid;
  acc_ids  uuid[];
BEGIN
  SELECT * INTO c FROM public.publish_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'active' THEN RETURN; END IF;
  IF p_day < c.start_date OR (c.end_date IS NOT NULL AND p_day > c.end_date) THEN RETURN; END IF;
  IF NOT (extract(isodow FROM p_day)::integer = ANY (c.weekdays)) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.publish_project_settings s WHERE s.project_id = c.project_id AND s.paused) THEN RETURN; END IF;

  tz := coalesce(c.timezone, (SELECT g.timezone FROM public.publish_account_groups g WHERE g.id = c.group_id), 'Asia/Almaty');
  slots := public.publish_campaign_slot_times(c.slot_times, c.posts_per_day);
  day_from := (p_day::timestamp) AT TIME ZONE tz;
  day_to := ((p_day + 1)::timestamp) AT TIME ZONE tz;
  acc_ids := CASE WHEN cardinality(c.account_ids) > 0 THEN c.account_ids ELSE NULL END;

  IF c.distribution = 'fanout' THEN
    SELECT count(*) INTO already FROM public.publish_campaign_items i
     WHERE i.campaign_id = c.id AND i.status IN ('planned', 'skipped') AND i.planned_at >= day_from AND i.planned_at < day_to;
    FOREACH slot IN ARRAY slots LOOP
      idx := idx + 1;
      IF idx <= already THEN CONTINUE; END IF;
      slot_ts := (p_day::timestamp + slot) AT TIME ZONE tz;
      IF slot_ts < now() - interval '1 hour' THEN CONTINUE; END IF;
      SELECT * INTO item FROM public.publish_campaign_items i
       WHERE i.campaign_id = c.id AND i.status = 'queued'
       ORDER BY i.position, i.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN EXIT; END IF;
      SELECT array_agg(p.job_id) FILTER (WHERE p.created), count(*) FILTER (WHERE p.created)
        INTO ids, n
        FROM public.plan_publish_slots(item.video_id, c.group_id, acc_ids, greatest(slot_ts, now()), c.mode) AS p;
      IF coalesce(n, 0) > 0 THEN
        UPDATE public.publish_jobs SET campaign_id = c.id WHERE id = ANY (ids);
      END IF;
      UPDATE public.publish_campaign_items
         SET status = CASE WHEN coalesce(n, 0) > 0 THEN 'planned' ELSE 'skipped' END,
             planned_at = slot_ts, jobs_count = coalesce(n, 0),
             note = CASE WHEN coalesce(n, 0) > 0 THEN NULL ELSE 'ни один аккаунт не годен или видео уже стояло на всех' END
       WHERE id = item.id;
      video_id := item.video_id; slot_at := slot_ts; jobs_created := coalesce(n, 0);
      RETURN NEXT;
    END LOOP;
  ELSE
    -- spread: каждому годному аккаунту — свои видео по кругу, posts_per_day на аккаунт.
    FOR acc IN SELECT * FROM public.publish_campaign_accounts(c.id) LOOP
      SELECT count(*) INTO already FROM public.publish_jobs j
       WHERE j.campaign_id = c.id AND j.account_id = acc AND j.scheduled_at >= day_from AND j.scheduled_at < day_to;
      idx := 0;
      FOREACH slot IN ARRAY slots LOOP
        idx := idx + 1;
        IF idx <= already THEN CONTINUE; END IF;
        slot_ts := (p_day::timestamp + slot) AT TIME ZONE tz;
        IF slot_ts < now() - interval '1 hour' THEN CONTINUE; END IF;
        SELECT * INTO item FROM public.publish_campaign_items i
         WHERE i.campaign_id = c.id AND i.status = 'queued'
           AND NOT EXISTS (SELECT 1 FROM public.publish_jobs j WHERE j.video_id = i.video_id AND j.account_id = acc)
         ORDER BY i.position, i.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
        IF NOT FOUND THEN EXIT; END IF;
        SELECT array_agg(p.job_id) FILTER (WHERE p.created), count(*) FILTER (WHERE p.created)
          INTO ids, n
          FROM public.plan_publish_slots(item.video_id, NULL, ARRAY[acc], greatest(slot_ts, now()), c.mode) AS p;
        IF coalesce(n, 0) > 0 THEN
          UPDATE public.publish_jobs SET campaign_id = c.id WHERE id = ANY (ids);
        END IF;
        UPDATE public.publish_campaign_items
           SET status = CASE WHEN coalesce(n, 0) > 0 THEN 'planned' ELSE 'skipped' END,
               planned_at = slot_ts, jobs_count = coalesce(n, 0),
               note = CASE WHEN coalesce(n, 0) > 0 THEN NULL ELSE 'аккаунт не принял слот' END
         WHERE id = item.id;
        video_id := item.video_id; slot_at := slot_ts; jobs_created := coalesce(n, 0);
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END IF;

  UPDATE public.publish_campaigns SET planned_until = greatest(coalesce(planned_until, p_day), p_day) WHERE id = c.id;
END;
$$;

/* Планировщик: все активные кампании, сегодня и ещё p_days_ahead дней вперёд; автозавершение. */
CREATE OR REPLACE FUNCTION public.plan_publish_campaigns(p_days_ahead integer DEFAULT 1)
RETURNS TABLE (campaign_id uuid, planned integer, jobs_created integer, completed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  tz text;
  today date;
  d date;
  r record;
  v_planned integer;
  v_jobs integer;
  v_done boolean;
BEGIN
  FOR c IN SELECT * FROM public.publish_campaigns WHERE status = 'active' ORDER BY created_at LOOP
    tz := coalesce(c.timezone, (SELECT g.timezone FROM public.publish_account_groups g WHERE g.id = c.group_id), 'Asia/Almaty');
    today := (now() AT TIME ZONE tz)::date;
    v_planned := 0; v_jobs := 0; v_done := false;
    FOR d IN SELECT generate_series(greatest(today, c.start_date), least(today + greatest(p_days_ahead, 0), coalesce(c.end_date, today + greatest(p_days_ahead, 0))), interval '1 day')::date LOOP
      FOR r IN SELECT * FROM public.plan_campaign_day(c.id, d) LOOP
        v_planned := v_planned + 1; v_jobs := v_jobs + r.jobs_created;
      END LOOP;
    END LOOP;
    -- Завершение: очередь контента пуста (или период кончился) и нет открытых заданий.
    IF (NOT EXISTS (SELECT 1 FROM public.publish_campaign_items i WHERE i.campaign_id = c.id AND i.status = 'queued')
        OR (c.end_date IS NOT NULL AND today > c.end_date))
       AND NOT EXISTS (SELECT 1 FROM public.publish_jobs j WHERE j.campaign_id = c.id AND j.status IN ('pending','retry','processing','verifying'))
       AND EXISTS (SELECT 1 FROM public.publish_campaign_items i WHERE i.campaign_id = c.id) THEN
      UPDATE public.publish_campaigns SET status = 'completed', completed_at = now() WHERE id = c.id;
      v_done := true;
    END IF;
    campaign_id := c.id; planned := v_planned; jobs_created := v_jobs; completed := v_done;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.plan_campaign_day(uuid, date) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_publish_campaigns(integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_campaign_accounts(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_campaign_day(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_publish_campaigns(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_campaign_accounts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_campaign_slot_times(time[], integer) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.publish_campaign_metrics
WITH (security_invoker = true) AS
WITH latest AS (
  SELECT DISTINCT ON (m.job_id) m.job_id, m.views, m.reach, m.likes, m.comments, m.shares, m.saves
    FROM public.post_metrics m
   ORDER BY m.job_id,
            CASE m.checkpoint WHEN 'd7' THEN 6 WHEN 'd3' THEN 5 WHEN 'd1' THEN 4 WHEN 'h6' THEN 3 WHEN 'h1' THEN 2 ELSE 1 END DESC,
            m.captured_at DESC
)
SELECT
  c.id AS campaign_id, c.project_id, c.name, c.status, c.start_date, c.end_date, c.posts_per_day, c.distribution, c.planned_until,
  (SELECT count(*) FROM public.publish_campaign_accounts(c.id)) AS accounts_eligible,
  (SELECT count(*) FROM public.publish_campaign_items i WHERE i.campaign_id = c.id) AS items_total,
  (SELECT count(*) FROM public.publish_campaign_items i WHERE i.campaign_id = c.id AND i.status = 'queued') AS items_queued,
  (SELECT count(*) FROM public.publish_campaign_items i WHERE i.campaign_id = c.id AND i.status = 'planned') AS items_planned,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.campaign_id = c.id) AS jobs_total,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.campaign_id = c.id AND j.status = 'published') AS jobs_published,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.campaign_id = c.id AND j.status = 'failed') AS jobs_failed,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.campaign_id = c.id AND j.status IN ('pending','retry','processing','verifying')) AS jobs_open,
  (SELECT min(j.scheduled_at) FROM public.publish_jobs j WHERE j.campaign_id = c.id AND j.status IN ('pending','retry') AND j.scheduled_at > now()) AS next_slot_at,
  (SELECT coalesce(sum(l.views), 0) FROM public.publish_jobs j JOIN latest l ON l.job_id = j.id WHERE j.campaign_id = c.id) AS views_total,
  (SELECT coalesce(sum(l.reach), 0) FROM public.publish_jobs j JOIN latest l ON l.job_id = j.id WHERE j.campaign_id = c.id) AS reach_total,
  (SELECT coalesce(sum(l.likes + l.comments + l.shares + l.saves), 0) FROM public.publish_jobs j JOIN latest l ON l.job_id = j.id WHERE j.campaign_id = c.id) AS engagements_total
FROM public.publish_campaigns c;
GRANT SELECT ON public.publish_campaign_metrics TO authenticated;

SELECT cron.unschedule('publish-campaign-planner-hourly')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-campaign-planner-hourly');
SELECT cron.schedule('publish-campaign-planner-hourly', '10 * * * *', $$ SELECT public.plan_publish_campaigns(1); $$);

-- ── 2. Исходящие вебхуки ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.publish_webhooks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  url              text NOT NULL CHECK (url ~* '^https://'),
  secret_encrypted text NOT NULL,
  events           text[] NOT NULL DEFAULT '{*}',
  enabled          boolean NOT NULL DEFAULT true,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_delivery_at timestamptz,
  last_status      integer
);
COMMENT ON TABLE public.publish_webhooks IS
  'Подписки на события: publication.published / failed / needs_human / unverified, account.reconnect_required, campaign.completed, report.daily… (`*` — все). Секрет зашифрован, показывается один раз.';
CREATE INDEX IF NOT EXISTS publish_webhooks_project_idx ON public.publish_webhooks (project_id) WHERE enabled;
ALTER TABLE public.publish_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publish_webhooks_select ON public.publish_webhooks;
CREATE POLICY publish_webhooks_select ON public.publish_webhooks FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
REVOKE ALL ON public.publish_webhooks FROM authenticated;
GRANT SELECT (id, project_id, name, url, events, enabled, created_by, created_at, last_delivery_at, last_status) ON public.publish_webhooks TO authenticated;

CREATE TABLE IF NOT EXISTS public.publish_webhook_deliveries (
  id               bigserial PRIMARY KEY,
  webhook_id       uuid NOT NULL REFERENCES public.publish_webhooks(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL,
  event            text NOT NULL,
  payload          jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'pending',
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_at        timestamptz,
  response_status  integer,
  last_error       text,
  delivered_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_webhook_deliveries_status_check CHECK (status IN ('pending','retry','delivered','failed'))
);
CREATE INDEX IF NOT EXISTS publish_webhook_deliveries_due_idx ON public.publish_webhook_deliveries (next_attempt_at) WHERE status IN ('pending','retry');
CREATE INDEX IF NOT EXISTS publish_webhook_deliveries_hook_idx ON public.publish_webhook_deliveries (webhook_id, created_at DESC);
ALTER TABLE public.publish_webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publish_webhook_deliveries_select ON public.publish_webhook_deliveries;
CREATE POLICY publish_webhook_deliveries_select ON public.publish_webhook_deliveries FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
GRANT SELECT ON public.publish_webhook_deliveries TO authenticated;

-- Постановка события в доставку всем подписанным вебхукам проекта.
CREATE OR REPLACE FUNCTION public.publish_emit_event(p_project_id uuid, p_event text, p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.publish_webhook_deliveries (webhook_id, project_id, event, payload)
  SELECT w.id, w.project_id, p_event,
         jsonb_build_object('event', p_event, 'project_id', p_project_id, 'occurred_at', now(), 'data', p_payload)
    FROM public.publish_webhooks w
   WHERE w.project_id = p_project_id AND w.enabled
     AND ('*' = ANY (w.events) OR p_event = ANY (w.events));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_emit_event(uuid, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_emit_event(uuid, text, jsonb) TO service_role;

-- События заданий: только когда в проекте есть хоть один вебхук (иначе триггер — no-op).
CREATE OR REPLACE FUNCTION public.publish_jobs_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE ev text; payload jsonb;
BEGIN
  IF NEW.status = OLD.status AND NEW.verification_status = OLD.verification_status THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.publish_webhooks w WHERE w.project_id = NEW.project_id AND w.enabled) THEN RETURN NEW; END IF;
  ev := CASE
    WHEN NEW.status = 'published' AND OLD.status <> 'published' AND NEW.verification_status = 'unverified' THEN 'publication.unverified'
    WHEN NEW.status = 'published' AND OLD.status <> 'published' THEN 'publication.published'
    WHEN NEW.status = 'failed' AND OLD.status <> 'failed' THEN 'publication.failed'
    WHEN NEW.status = 'manual_review' AND OLD.status <> 'manual_review' THEN 'publication.needs_human'
    ELSE NULL END;
  IF ev IS NULL THEN RETURN NEW; END IF;
  payload := jsonb_build_object(
    'job_id', NEW.id, 'content_id', NEW.video_id, 'account_id', NEW.account_id, 'platform', NEW.platform,
    'status', NEW.status, 'verification_status', NEW.verification_status,
    'platform_media_id', NEW.external_post_id, 'platform_url', NEW.external_post_url,
    'published_at', NEW.published_at, 'error_class', NEW.error_class, 'error_code', NEW.error_code,
    'error_message', NEW.error_message, 'campaign_id', NEW.campaign_id, 'trace_id', NEW.trace_id);
  PERFORM public.publish_emit_event(NEW.project_id, ev, payload);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_publish_jobs_emit_events ON public.publish_jobs;
CREATE TRIGGER trg_publish_jobs_emit_events AFTER UPDATE OF status, verification_status ON public.publish_jobs
  FOR EACH ROW EXECUTE FUNCTION public.publish_jobs_emit_events();

CREATE OR REPLACE FUNCTION public.publish_notifications_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.publish_emit_event(NEW.project_id, NEW.kind, jsonb_build_object(
    'notification_id', NEW.id, 'severity', NEW.severity, 'title', NEW.title, 'body', NEW.body,
    'entity_type', NEW.entity_type, 'entity_id', NEW.entity_id));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_publish_notifications_emit_events ON public.publish_notifications;
CREATE TRIGGER trg_publish_notifications_emit_events AFTER INSERT ON public.publish_notifications
  FOR EACH ROW EXECUTE FUNCTION public.publish_notifications_emit_events();

CREATE OR REPLACE FUNCTION public.publish_campaigns_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    -- Событие campaign.completed уходит вебхукам через уведомление (триггер publish_notifications).
    INSERT INTO public.publish_notifications (project_id, kind, severity, title, body, entity_type, entity_id, dedupe_key)
    VALUES (NEW.project_id, 'campaign.completed', 'info', 'Кампания завершена: ' || NEW.name,
            'Очередь контента исчерпана или период закончился; открытых заданий не осталось.', 'publish_campaign', NEW.id, 'campaign:' || NEW.id || ':completed')
    ON CONFLICT (project_id, dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_publish_campaigns_emit_events ON public.publish_campaigns;
CREATE TRIGGER trg_publish_campaigns_emit_events AFTER UPDATE OF status ON public.publish_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.publish_campaigns_emit_events();

-- Забор доставок воркером publish-webhooks.
CREATE OR REPLACE FUNCTION public.claim_webhook_deliveries(p_batch integer DEFAULT 20, p_lock_timeout interval DEFAULT interval '5 minutes')
RETURNS SETOF public.publish_webhook_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.publish_webhook_deliveries d
     SET locked_at = now(), attempts = d.attempts + 1
   WHERE d.id IN (
     SELECT x.id FROM public.publish_webhook_deliveries x
      WHERE x.status IN ('pending', 'retry') AND x.next_attempt_at <= now()
        AND (x.locked_at IS NULL OR x.locked_at < now() - p_lock_timeout)
      ORDER BY x.next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT greatest(p_batch, 1)
   )
  RETURNING d.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_webhook_deliveries(integer, interval) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_deliveries(integer, interval) TO service_role;

SELECT cron.unschedule('publish-webhooks-minutely')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-webhooks-minutely');
SELECT cron.schedule(
  'publish-webhooks-minutely',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-webhooks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('source', 'pg_cron')
  )
  WHERE EXISTS (SELECT 1 FROM public.publish_webhook_deliveries d WHERE d.status IN ('pending','retry') AND d.next_attempt_at <= now());
  $$
);

-- Ежедневный отчёт по проектам (Telegram + уведомление report.daily): 05:00 UTC = 10:00 Алматы.
SELECT cron.unschedule('publish-monitor-daily-report')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-monitor-daily-report');
SELECT cron.schedule(
  'publish-monitor-daily-report',
  '0 5 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('mode', 'daily_report')
  );
  $$
);

-- ── 3. Feature flags проекта ─────────────────────────────────
ALTER TABLE public.publish_project_settings ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.publish_project_settings.features IS
  'Флаги проекта: ai_autopublish_enabled, winner_replication_enabled, tiktok_direct_publish_enabled, phonegrid_enabled… Читаются кодом через featureEnabled(); по умолчанию всё выключено.';

-- Расширяем GC: доставки вебхуков старше 30 дней.
CREATE OR REPLACE FUNCTION public.publish_maintenance_gc(
  p_events_days   integer DEFAULT 90,
  p_logs_days     integer DEFAULT 90,
  p_api_logs_days integer DEFAULT 90,
  p_notif_days    integer DEFAULT 180
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_events integer; n_logs integer; n_api integer; n_notif integer; n_hooks integer;
BEGIN
  DELETE FROM public.publish_job_events WHERE created_at < now() - make_interval(days => greatest(p_events_days, 1));
  GET DIAGNOSTICS n_events = ROW_COUNT;
  DELETE FROM public.publish_logs WHERE created_at < now() - make_interval(days => greatest(p_logs_days, 1));
  GET DIAGNOSTICS n_logs = ROW_COUNT;
  DELETE FROM public.api_request_logs WHERE created_at < now() - make_interval(days => greatest(p_api_logs_days, 1));
  GET DIAGNOSTICS n_api = ROW_COUNT;
  DELETE FROM public.publish_notifications WHERE read_at IS NOT NULL AND created_at < now() - make_interval(days => greatest(p_notif_days, 1));
  GET DIAGNOSTICS n_notif = ROW_COUNT;
  DELETE FROM public.publish_webhook_deliveries WHERE status IN ('delivered', 'failed') AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS n_hooks = ROW_COUNT;
  RETURN jsonb_build_object('job_events', n_events, 'publish_logs', n_logs, 'api_request_logs', n_api, 'notifications', n_notif, 'webhook_deliveries', n_hooks);
END;
$$;
