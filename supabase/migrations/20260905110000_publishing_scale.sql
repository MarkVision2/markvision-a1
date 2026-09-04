-- Дистрибуция на 100+ аккаунтов и связка с генерацией
-- (docs/AUTOPOSTING-PLATFORM-PLAN.md, модули M2–M5).
--
--   1. personas — персона группы аккаунтов: аватар/голос, tone of voice, запреты.
--   2. content_plan_items: parent_item_id (вариант), target_group_id, persona_id,
--      engine, idea_id — тема знает, для какой группы и из какой идеи она.
--   3. publish_account_groups: персона, режим согласования, часовой пояс,
--      окно публикаций, минимальный интервал, джиттер.
--   4. publish_accounts: группа, персона, свои пояс/окно, разгон частоты,
--      здоровье, счётчик публикаций за локальный день, обновление токена.
--   5. publish_slots + plan_publish_slots(): планировщик слотов вместо
--      drip «по индексу» — окна, интервалы, лимиты, разгон, темп группы.
--   6. claim_publish_jobs: счётчик вместо O(N) подсчёта, здоровье, партиции
--      для параллельных воркеров; триггер учёта публикаций.
--   7. post_metrics — охваты публикаций по контрольным точкам d1/d3/d7.
--   8. publish_project_settings (режим уведомлений), project_budgets +
--      usage_ledger (единый журнал расходов), publish_metrics (витрина).
--   9. radar_promote_idea() — идея → тема контент-плана.
--  10. Кроны: воркер в три партиции, дайджест, сбор метрик.

-- ── 1. Персоны ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  niche text,
  tone_of_voice text,
  forbidden_phrases text[] NOT NULL DEFAULT '{}',
  language text NOT NULL DEFAULT 'ru',
  engine_default text NOT NULL DEFAULT 'heygen',
  heygen_avatar_id text,
  heygen_voice_id text,
  eleven_voice_id text,
  reels_theme text,
  caption_style text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personas_engine_check CHECK (engine_default IN ('heygen', 'reels_faceless', 'montage')),
  CONSTRAINT personas_name_uniq UNIQUE (project_id, name)
);

COMMENT ON TABLE public.personas IS
  'Персона группы аккаунтов: голос/аватар, tone of voice, ниша, запреты — вход фабрики вариантов.';

ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personas_select ON public.personas;
CREATE POLICY personas_select ON public.personas FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS personas_insert ON public.personas;
CREATE POLICY personas_insert ON public.personas FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS personas_update ON public.personas;
CREATE POLICY personas_update ON public.personas FOR UPDATE TO authenticated
  USING (public.user_can_access_project(project_id))
  WITH CHECK (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS personas_delete ON public.personas;
CREATE POLICY personas_delete ON public.personas FOR DELETE TO authenticated
  USING (public.user_can_access_project(project_id));
DROP TRIGGER IF EXISTS trg_personas_updated ON public.personas;
CREATE TRIGGER trg_personas_updated BEFORE UPDATE ON public.personas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. Тема контент-плана: вариант, группа, персона, движок, идея ──
ALTER TABLE public.content_plan_items
  ADD COLUMN IF NOT EXISTS parent_item_id uuid REFERENCES public.content_plan_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_group_id uuid REFERENCES public.publish_account_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS persona_id uuid REFERENCES public.personas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS engine text,
  ADD COLUMN IF NOT EXISTS idea_id uuid REFERENCES public.idea_bank(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS publish_video_id uuid REFERENCES public.publish_videos(id) ON DELETE SET NULL;

ALTER TABLE public.content_plan_items DROP CONSTRAINT IF EXISTS content_plan_items_engine_check;
ALTER TABLE public.content_plan_items ADD CONSTRAINT content_plan_items_engine_check
  CHECK (engine IS NULL OR engine IN ('heygen', 'reels_faceless', 'montage'));

COMMENT ON COLUMN public.content_plan_items.parent_item_id IS
  'Вариант темы под группу: родитель — исходная тема (фабрика вариантов).';
COMMENT ON COLUMN public.content_plan_items.publish_video_id IS
  'Видео в библиотеке публикации, созданное после одобрения.';

CREATE INDEX IF NOT EXISTS content_plan_items_parent_idx
  ON public.content_plan_items (parent_item_id) WHERE parent_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_plan_items_group_idx
  ON public.content_plan_items (target_group_id) WHERE target_group_id IS NOT NULL;
-- Один вариант родительской темы на группу: повторный запрос «сделать варианты» не плодит дубли.
CREATE UNIQUE INDEX IF NOT EXISTS content_plan_items_variant_uidx
  ON public.content_plan_items (parent_item_id, target_group_id)
  WHERE parent_item_id IS NOT NULL AND target_group_id IS NOT NULL;

-- ── 3. Группы: персона, согласование, окно ──────────────────
ALTER TABLE public.publish_account_groups
  ADD COLUMN IF NOT EXISTS persona_id uuid REFERENCES public.personas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_mode text NOT NULL DEFAULT 'review_required',
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Almaty',
  ADD COLUMN IF NOT EXISTS window_start time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS window_end time NOT NULL DEFAULT '21:00',
  ADD COLUMN IF NOT EXISTS min_gap_minutes integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS jitter_minutes integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS auto_publish_after integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS approved_streak integer NOT NULL DEFAULT 0;

ALTER TABLE public.publish_account_groups DROP CONSTRAINT IF EXISTS publish_account_groups_review_mode_check;
ALTER TABLE public.publish_account_groups ADD CONSTRAINT publish_account_groups_review_mode_check
  CHECK (review_mode IN ('review_required', 'auto_publish', 'paused'));
ALTER TABLE public.publish_account_groups DROP CONSTRAINT IF EXISTS publish_account_groups_window_check;
ALTER TABLE public.publish_account_groups ADD CONSTRAINT publish_account_groups_window_check
  CHECK (min_gap_minutes BETWEEN 0 AND 1440 AND jitter_minutes BETWEEN 0 AND 180 AND window_start < window_end);

COMMENT ON COLUMN public.publish_account_groups.review_mode IS
  'review_required — ворота согласования; auto_publish — доверенная группа (после auto_publish_after одобрений подряд); paused — стоп.';

-- ── 4. Аккаунты: группа, разгон, здоровье, счётчики ─────────
ALTER TABLE public.publish_accounts
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.publish_account_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS persona_id uuid REFERENCES public.personas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS window_start time,
  ADD COLUMN IF NOT EXISTS window_end time,
  ADD COLUMN IF NOT EXISTS ramp_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ramp_started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS health_score numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS published_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_day date,
  ADD COLUMN IF NOT EXISTS token_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS followers integer,
  ADD COLUMN IF NOT EXISTS metrics_synced_at timestamptz;

COMMENT ON COLUMN public.publish_accounts.ramp_started_at IS
  'Старт разгона частоты: 1 публикация/день первые 7 дней → 2 до 14 → 3 до 28 → daily_limit.';
COMMENT ON COLUMN public.publish_accounts.health_score IS
  '0..100: успехи +1 (до 100), временные сбои −5, лимиты −15, мёртвый токен −40. Ниже 20 — очередь аккаунт не берёт.';

CREATE INDEX IF NOT EXISTS idx_publish_accounts_group
  ON public.publish_accounts (group_id) WHERE group_id IS NOT NULL;

-- Эффективный дневной лимит с учётом разгона.
CREATE OR REPLACE FUNCTION public.publish_account_effective_limit(
  p_daily_limit integer,
  p_ramp_enabled boolean,
  p_ramp_started_at timestamptz,
  p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN NOT p_ramp_enabled OR p_ramp_started_at IS NULL THEN p_daily_limit
    WHEN p_now < p_ramp_started_at + interval '7 days'  THEN least(p_daily_limit, 1)
    WHEN p_now < p_ramp_started_at + interval '14 days' THEN least(p_daily_limit, 2)
    WHEN p_now < p_ramp_started_at + interval '28 days' THEN least(p_daily_limit, 3)
    ELSE p_daily_limit
  END;
$$;

-- Пояс/окно аккаунта с наследованием от группы.
CREATE OR REPLACE FUNCTION public.publish_account_window(p_account_id uuid)
RETURNS TABLE (tz text, window_start time, window_end time, min_gap_minutes integer, jitter_minutes integer, per_hour integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(a.timezone, g.timezone, 'Asia/Almaty'),
         coalesce(a.window_start, g.window_start, '09:00'::time),
         coalesce(a.window_end, g.window_end, '21:00'::time),
         coalesce(g.min_gap_minutes, 120),
         coalesce(g.jitter_minutes, 20),
         coalesce(g.per_hour, 10)
    FROM public.publish_accounts a
    LEFT JOIN public.publish_account_groups g ON g.id = a.group_id
   WHERE a.id = p_account_id;
$$;

-- ── 5. Слоты и планировщик ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.publish_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.publish_accounts(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.publish_jobs(id) ON DELETE CASCADE,
  slot_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_slots_uniq UNIQUE (account_id, slot_at)
);

COMMENT ON TABLE public.publish_slots IS
  'Занятые слоты публикаций по аккаунту — планировщик plan_publish_slots не ставит два задания ближе min_gap.';

CREATE INDEX IF NOT EXISTS publish_slots_account_idx ON public.publish_slots (account_id, slot_at DESC);

ALTER TABLE public.publish_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publish_slots_select ON public.publish_slots;
CREATE POLICY publish_slots_select ON public.publish_slots FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

-- Следующий свободный слот аккаунта не раньше p_from: окно в локальном поясе,
-- min_gap от последнего слота/публикации, дневной лимит с разгоном, джиттер.
CREATE OR REPLACE FUNCTION public.publish_next_slot(
  p_account_id uuid,
  p_from timestamptz,
  p_jitter boolean DEFAULT true
) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
  acc record;
  cand timestamptz;
  last_at timestamptz;
  local_ts timestamp;
  local_day date;
  day_count integer;
  eff_limit integer;
  guard integer := 0;
BEGIN
  SELECT * INTO w FROM public.publish_account_window(p_account_id);
  SELECT daily_limit, ramp_enabled, ramp_started_at INTO acc
    FROM public.publish_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  eff_limit := public.publish_account_effective_limit(acc.daily_limit, acc.ramp_enabled, acc.ramp_started_at, p_from);
  IF eff_limit <= 0 THEN RETURN NULL; END IF;

  SELECT greatest(
           (SELECT max(slot_at) FROM public.publish_slots WHERE account_id = p_account_id),
           (SELECT last_post_at FROM public.publish_accounts WHERE id = p_account_id))
    INTO last_at;

  cand := greatest(p_from, coalesce(last_at + make_interval(mins => w.min_gap_minutes), p_from));

  LOOP
    guard := guard + 1;
    IF guard > 60 THEN RETURN NULL; END IF;  -- аккаунт забит на два месяца вперёд — не планируем
    local_ts := cand AT TIME ZONE w.tz;
    local_day := local_ts::date;
    -- Окно публикаций
    IF local_ts::time < w.window_start THEN
      cand := (local_day + w.window_start) AT TIME ZONE w.tz;
      local_ts := cand AT TIME ZONE w.tz;
    ELSIF local_ts::time >= w.window_end THEN
      cand := ((local_day + 1) + w.window_start) AT TIME ZONE w.tz;
      CONTINUE;
    END IF;
    -- Дневной лимит (слоты + уже опубликованное за этот локальный день)
    SELECT count(*) INTO day_count
      FROM public.publish_slots s
     WHERE s.account_id = p_account_id
       AND (s.slot_at AT TIME ZONE w.tz)::date = local_day;
    day_count := day_count + coalesce((
      SELECT count(*) FROM public.publish_jobs j
       WHERE j.account_id = p_account_id AND j.status = 'published'
         AND (j.published_at AT TIME ZONE w.tz)::date = local_day
         AND NOT EXISTS (SELECT 1 FROM public.publish_slots s2 WHERE s2.job_id = j.id)), 0);
    IF day_count >= eff_limit THEN
      cand := ((local_day + 1) + w.window_start) AT TIME ZONE w.tz;
      CONTINUE;
    END IF;
    EXIT;
  END LOOP;

  IF p_jitter AND w.jitter_minutes > 0 THEN
    -- Джиттер вперёд, чтобы не выпасть из окна и не нарушить min_gap.
    cand := cand + make_interval(mins => floor(random() * w.jitter_minutes)::integer);
  END IF;
  RETURN cand;
END;
$$;

-- Раскладка видео по группе (или явному списку аккаунтов): задания + слоты.
-- Темп группы per_hour соблюдается курсором: i-й аккаунт не раньше start + i·3600/per_hour.
CREATE OR REPLACE FUNCTION public.plan_publish_slots(
  p_video_id uuid,
  p_group_id uuid DEFAULT NULL,
  p_account_ids uuid[] DEFAULT NULL,
  p_start timestamptz DEFAULT now(),
  p_mode text DEFAULT 'drip'
) RETURNS TABLE (job_id uuid, account_id uuid, scheduled_at timestamptz, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v public.publish_videos%ROWTYPE;
  g public.publish_account_groups%ROWTYPE;
  acc record;
  i integer := 0;
  cursor_at timestamptz;
  slot timestamptz;
  v_job uuid;
  v_created boolean;
  step interval;
  variants jsonb;
  caption text;
BEGIN
  SELECT * INTO v FROM public.publish_videos WHERE id = p_video_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'video % not found', p_video_id; END IF;
  -- Аварийная пауза проекта: ничего не планируем (publish_project_settings.paused).
  IF EXISTS (SELECT 1 FROM public.publish_project_settings s WHERE s.project_id = v.project_id AND s.paused) THEN RETURN; END IF;
  IF p_group_id IS NOT NULL THEN
    SELECT * INTO g FROM public.publish_account_groups WHERE id = p_group_id AND project_id = v.project_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'group % not found', p_group_id; END IF;
    IF g.review_mode = 'paused' THEN RETURN; END IF;
  END IF;
  step := CASE
    WHEN p_mode = 'now' THEN interval '0'
    WHEN p_mode = 'daily' THEN interval '1 day'
    ELSE make_interval(secs => 3600.0 / greatest(coalesce(g.per_hour, 10), 1))
  END;
  variants := coalesce(v.caption_variants, '[]'::jsonb);

  FOR acc IN
    SELECT a.id, a.platform
      FROM public.publish_accounts a
     WHERE a.project_id = v.project_id
       AND a.status = 'active' AND a.publish_enabled
       AND a.health_score >= 20
       AND (p_group_id IS NULL OR a.group_id = p_group_id OR a.id = ANY (coalesce(g.account_ids, '{}')))
       AND (p_account_ids IS NULL OR a.id = ANY (p_account_ids))
       AND (g.platform IS NULL OR a.platform = g.platform)
     ORDER BY a.health_score DESC, a.created_at
  LOOP
    cursor_at := p_start + step * i;
    slot := CASE WHEN p_mode = 'now' THEN p_start ELSE public.publish_next_slot(acc.id, cursor_at, p_mode <> 'now') END;
    i := i + 1;
    IF slot IS NULL THEN CONTINUE; END IF;

    caption := CASE
      WHEN jsonb_typeof(variants) = 'array' AND jsonb_array_length(variants) > 0
        THEN variants ->> ((i - 1) % jsonb_array_length(variants))
      ELSE v.base_caption
    END;

    INSERT INTO public.publish_jobs (project_id, video_id, account_id, platform, caption, hashtags, scheduled_at, next_attempt_at)
    VALUES (v.project_id, v.id, acc.id, acc.platform, caption, coalesce(v.hashtags, '{}'), slot, slot)
    ON CONFLICT (video_id, account_id) DO NOTHING
    RETURNING id INTO v_job;
    v_created := v_job IS NOT NULL;
    IF NOT v_created THEN
      SELECT id, publish_jobs.scheduled_at INTO v_job, slot FROM public.publish_jobs
       WHERE video_id = v.id AND publish_jobs.account_id = acc.id;
    ELSE
      INSERT INTO public.publish_slots (project_id, account_id, job_id, slot_at)
      VALUES (v.project_id, acc.id, v_job, slot)
      ON CONFLICT (account_id, slot_at) DO NOTHING;
    END IF;
    job_id := v_job; account_id := acc.id; scheduled_at := slot; created := v_created;
    RETURN NEXT;
  END LOOP;

  UPDATE public.publish_videos SET status = 'queued' WHERE id = v.id AND status = 'ready';
END;
$$;

REVOKE ALL ON FUNCTION public.publish_next_slot(uuid, timestamptz, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_publish_slots(uuid, uuid, uuid[], timestamptz, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_account_window(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.publish_next_slot(uuid, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_publish_slots(uuid, uuid, uuid[], timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_account_window(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_account_effective_limit(integer, boolean, timestamptz, timestamptz) TO service_role, authenticated;

-- ── 6. Очередь: счётчики, здоровье, партиции ────────────────
-- Учёт публикации: счётчик за локальный день аккаунта, last_post_at, здоровье.
CREATE OR REPLACE FUNCTION public.publish_jobs_account_bookkeeping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  tz text;
  today date;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT coalesce(a.timezone, g.timezone, 'Asia/Almaty') INTO tz
    FROM public.publish_accounts a LEFT JOIN public.publish_account_groups g ON g.id = a.group_id
   WHERE a.id = NEW.account_id;
  today := (now() AT TIME ZONE coalesce(tz, 'Asia/Almaty'))::date;

  IF NEW.status = 'published' THEN
    UPDATE public.publish_accounts
       SET published_today = CASE WHEN published_day = today THEN published_today + 1 ELSE 1 END,
           published_day = today,
           last_post_at = coalesce(NEW.published_at, now()),
           health_score = least(100, health_score + 1)
     WHERE id = NEW.account_id;
  ELSIF NEW.status = 'failed' THEN
    UPDATE public.publish_accounts SET health_score = greatest(0, health_score - 10) WHERE id = NEW.account_id;
  ELSIF NEW.status = 'retry' AND NEW.error_code IS NOT NULL AND OLD.status = 'processing' THEN
    UPDATE public.publish_accounts SET health_score = greatest(0, health_score - 3) WHERE id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_publish_jobs_bookkeeping ON public.publish_jobs;
CREATE TRIGGER trg_publish_jobs_bookkeeping
  AFTER UPDATE OF status ON public.publish_jobs
  FOR EACH ROW EXECUTE FUNCTION public.publish_jobs_account_bookkeeping();

-- Здоровье по статусу аккаунта (монитор гасит токен/лимит — здоровье падает).
CREATE OR REPLACE FUNCTION public.publish_accounts_health_on_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'token_expired' THEN NEW.health_score := greatest(0, NEW.health_score - 40);
    ELSIF NEW.status = 'limited' THEN NEW.health_score := greatest(0, NEW.health_score - 15);
    ELSIF NEW.status = 'error' THEN NEW.health_score := greatest(0, NEW.health_score - 25);
    ELSIF NEW.status = 'active' AND OLD.status <> 'active' THEN NEW.health_score := greatest(NEW.health_score, 50);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_publish_accounts_health ON public.publish_accounts;
CREATE TRIGGER trg_publish_accounts_health
  BEFORE UPDATE OF status ON public.publish_accounts
  FOR EACH ROW EXECUTE FUNCTION public.publish_accounts_health_on_status();

-- Забор v2: та же сигнатура плюс партиции; без коррелированного count(*).
DROP FUNCTION IF EXISTS public.claim_publish_jobs(integer, interval);
CREATE OR REPLACE FUNCTION public.claim_publish_jobs(
  p_batch        integer  DEFAULT 5,
  p_lock_timeout interval DEFAULT interval '10 minutes',
  p_partition    integer  DEFAULT NULL,
  p_partitions   integer  DEFAULT 1
)
RETURNS SETOF public.publish_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.publish_jobs
     SET status = 'retry',
         locked_at = NULL,
         error_message = coalesce(error_message, 'воркер не завершил задание, повтор'),
         updated_at = now()
   WHERE status = 'processing'
     AND locked_at IS NOT NULL
     AND locked_at < now() - p_lock_timeout;

  RETURN QUERY
  UPDATE public.publish_jobs j
     SET status = 'processing',
         attempts = j.attempts + 1,
         locked_at = now(),
         updated_at = now()
   WHERE j.id IN (
     SELECT cand.id
       FROM public.publish_jobs cand
       JOIN public.publish_accounts acc ON acc.id = cand.account_id
       LEFT JOIN public.publish_account_groups g ON g.id = acc.group_id
      WHERE cand.status IN ('pending', 'retry')
        AND cand.scheduled_at <= now()
        AND cand.next_attempt_at <= now()
        AND acc.publish_enabled
        AND acc.status = 'active'
        AND acc.health_score >= 20
        AND coalesce(g.review_mode, 'review_required') <> 'paused'
        AND NOT EXISTS (SELECT 1 FROM public.publish_project_settings s WHERE s.project_id = cand.project_id AND s.paused)
        AND (p_partition IS NULL OR p_partitions <= 1
             OR mod(abs(hashtext(acc.id::text)), greatest(p_partitions, 1)) = p_partition)
        AND (
          public.publish_account_effective_limit(acc.daily_limit, acc.ramp_enabled, acc.ramp_started_at, now()) = 0
          OR acc.published_day IS DISTINCT FROM (now() AT TIME ZONE coalesce(acc.timezone, g.timezone, 'Asia/Almaty'))::date
          OR acc.published_today < public.publish_account_effective_limit(acc.daily_limit, acc.ramp_enabled, acc.ramp_started_at, now())
        )
        AND acc.daily_limit > 0
      ORDER BY cand.scheduled_at
      FOR UPDATE OF cand SKIP LOCKED
      LIMIT greatest(p_batch, 1)
   )
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_publish_jobs(integer, interval, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_publish_jobs(integer, interval, integer, integer) TO service_role;

COMMENT ON FUNCTION public.claim_publish_jobs(integer, interval, integer, integer) IS
  'Атомарный забор заданий: аренда, статус и здоровье аккаунта, дневной лимит с разгоном (счётчик), партиции по аккаунту для параллельных воркеров.';

-- ── 7. Метрики публикаций ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.post_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.publish_accounts(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.publish_jobs(id) ON DELETE CASCADE,
  platform text NOT NULL,
  external_post_id text NOT NULL,
  checkpoint text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  reach integer NOT NULL DEFAULT 0,
  views integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  shares integer NOT NULL DEFAULT 0,
  saves integer NOT NULL DEFAULT 0,
  followers integer,
  raw jsonb,
  CONSTRAINT post_metrics_checkpoint_check CHECK (checkpoint IN ('d1', 'd3', 'd7', 'manual')),
  CONSTRAINT post_metrics_uniq UNIQUE (job_id, checkpoint)
);

COMMENT ON TABLE public.post_metrics IS
  'Охваты опубликованных роликов по контрольным точкам (1/3/7 дней) — вход для outcome_score идей.';

CREATE INDEX IF NOT EXISTS post_metrics_project_idx ON public.post_metrics (project_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS post_metrics_account_idx ON public.post_metrics (account_id, checkpoint);

ALTER TABLE public.post_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_metrics_select ON public.post_metrics;
CREATE POLICY post_metrics_select ON public.post_metrics FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

-- Задания, которым пора снять метрики.
CREATE OR REPLACE FUNCTION public.post_metrics_due(p_limit integer DEFAULT 200)
RETURNS TABLE (job_id uuid, project_id uuid, account_id uuid, platform text, external_post_id text, checkpoint text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.project_id, j.account_id, j.platform, j.external_post_id, cp.checkpoint
    FROM public.publish_jobs j
    CROSS JOIN (VALUES ('d1', interval '1 day'), ('d3', interval '3 days'), ('d7', interval '7 days')) AS cp(checkpoint, age)
   WHERE j.status = 'published'
     AND j.external_post_id IS NOT NULL
     AND j.published_at <= now() - cp.age
     AND j.published_at >= now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.post_metrics m WHERE m.job_id = j.id AND m.checkpoint = cp.checkpoint)
   ORDER BY j.published_at
   LIMIT greatest(p_limit, 1);
$$;

-- outcome_score идеи: медиана нормированного охвата (reach / followers) по d3,
-- масштабированная так, что 5 % охвата от базы ≈ 100.
CREATE OR REPLACE FUNCTION public.idea_recompute_outcomes(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT i.id AS idea_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY
             CASE WHEN coalesce(m.followers, 0) > 0 THEN m.reach::numeric / m.followers ELSE m.reach::numeric / 1000 END
           ) AS med
      FROM public.idea_bank i
      JOIN public.content_plan_items c ON c.idea_id = i.id OR c.parent_item_id IN (SELECT id FROM public.content_plan_items WHERE idea_id = i.id)
      JOIN public.publish_videos v ON v.id = c.publish_video_id
      JOIN public.publish_jobs j ON j.video_id = v.id AND j.status = 'published'
      JOIN public.post_metrics m ON m.job_id = j.id AND m.checkpoint IN ('d3', 'd7')
     WHERE i.project_id = p_project_id
     GROUP BY i.id
  LOOP
    UPDATE public.idea_bank SET outcome_score = round(least(100, r.med / 0.05 * 100), 1) WHERE id = r.idea_id;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.post_metrics_due(integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.idea_recompute_outcomes(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_metrics_due(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.idea_recompute_outcomes(uuid) TO service_role;

-- ── 8. Настройки, бюджеты, витрина ──────────────────────────
CREATE TABLE IF NOT EXISTS public.publish_project_settings (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  notify_mode text NOT NULL DEFAULT 'digest',
  digest_chat_id text,
  max_parallel_workers integer NOT NULL DEFAULT 3,
  paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_project_settings_notify_check CHECK (notify_mode IN ('digest', 'each', 'silent'))
);
ALTER TABLE public.publish_project_settings ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.publish_project_settings.paused IS
  'Аварийная пауза проекта: claim_publish_jobs не отдаёт задания, plan_publish_slots не ставит новые; очередь сохраняется.';

ALTER TABLE public.publish_project_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publish_project_settings_select ON public.publish_project_settings;
CREATE POLICY publish_project_settings_select ON public.publish_project_settings FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS publish_project_settings_write ON public.publish_project_settings;
CREATE POLICY publish_project_settings_write ON public.publish_project_settings FOR ALL TO authenticated
  USING (public.user_can_access_project(project_id))
  WITH CHECK (public.user_can_access_project(project_id));

CREATE TABLE IF NOT EXISTS public.project_budgets (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  daily_usd numeric NOT NULL DEFAULT 20,
  monthly_usd numeric NOT NULL DEFAULT 300,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_budgets_check CHECK (daily_usd >= 0 AND monthly_usd >= 0)
);

CREATE TABLE IF NOT EXISTS public.usage_ledger (
  id bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  engine text NOT NULL,
  ref text,
  cost_usd numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_ledger_engine_check CHECK (
    engine IN ('openai', 'heygen', 'elevenlabs', 'apify', 'scrapecreators', 'whisper', 'llm', 'other')
  )
);

COMMENT ON TABLE public.usage_ledger IS
  'Единый журнал расходов всех движков; project_budget_ok() считает по нему день и месяц.';

CREATE INDEX IF NOT EXISTS usage_ledger_project_idx ON public.usage_ledger (project_id, created_at DESC);

ALTER TABLE public.project_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_budgets_select ON public.project_budgets;
CREATE POLICY project_budgets_select ON public.project_budgets FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS project_budgets_write ON public.project_budgets;
CREATE POLICY project_budgets_write ON public.project_budgets FOR ALL TO authenticated
  USING (public.user_can_access_project(project_id))
  WITH CHECK (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS usage_ledger_select ON public.usage_ledger;
CREATE POLICY usage_ledger_select ON public.usage_ledger FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

CREATE OR REPLACE FUNCTION public.project_spend(p_project_id uuid)
RETURNS TABLE (spent_today_usd numeric, spent_month_usd numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0),
         coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0)
    FROM public.usage_ledger WHERE project_id = p_project_id;
$$;

CREATE OR REPLACE FUNCTION public.project_budget_ok(p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.project_budgets%ROWTYPE;
  today numeric; month numeric;
BEGIN
  SELECT * INTO b FROM public.project_budgets WHERE project_id = p_project_id;
  IF NOT FOUND THEN b.daily_usd := 20; b.monthly_usd := 300; END IF;
  SELECT spent_today_usd, spent_month_usd INTO today, month FROM public.project_spend(p_project_id);
  RETURN (b.daily_usd = 0 OR today < b.daily_usd) AND (b.monthly_usd = 0 OR month < b.monthly_usd);
END;
$$;

GRANT EXECUTE ON FUNCTION public.project_spend(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.project_budget_ok(uuid) TO service_role, authenticated;

-- Расход контент-конвейера зеркалится в общий журнал.
CREATE OR REPLACE FUNCTION public.pipeline_runs_ledger()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cost_usd > coalesce(OLD.cost_usd, 0) THEN
    INSERT INTO public.usage_ledger (project_id, engine, ref, cost_usd, note)
    VALUES (NEW.project_id,
            CASE WHEN NEW.state IN ('script_generating', 'script_ready') THEN 'openai'
                 WHEN NEW.state IN ('video_ready', 'video_rendering', 'video_requested') THEN 'heygen'
                 ELSE 'other' END,
            NEW.id::text, NEW.cost_usd - coalesce(OLD.cost_usd, 0), 'content_pipeline ' || NEW.state);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipeline_runs_ledger ON public.pipeline_runs;
CREATE TRIGGER trg_pipeline_runs_ledger
  AFTER UPDATE OF cost_usd ON public.pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION public.pipeline_runs_ledger();

CREATE OR REPLACE VIEW public.publish_metrics
WITH (security_invoker = true)
AS
SELECT
  p.id AS project_id,
  (SELECT count(*) FROM public.publish_accounts a WHERE a.project_id = p.id) AS accounts_total,
  (SELECT count(*) FROM public.publish_accounts a WHERE a.project_id = p.id AND a.status = 'active' AND a.publish_enabled) AS accounts_active,
  (SELECT count(*) FROM public.publish_accounts a WHERE a.project_id = p.id AND a.status = 'token_expired') AS accounts_token_expired,
  (SELECT count(*) FROM public.publish_accounts a WHERE a.project_id = p.id AND a.status IN ('limited', 'error')) AS accounts_limited_or_error,
  (SELECT round(avg(a.health_score), 1) FROM public.publish_accounts a WHERE a.project_id = p.id) AS health_avg,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status IN ('pending', 'retry')) AS jobs_queued,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status = 'processing') AS jobs_processing,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status = 'published' AND j.published_at >= now() - interval '24 hours') AS published_24h,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status = 'failed' AND j.updated_at >= now() - interval '24 hours') AS failed_24h,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status = 'manual_review') AS manual_review,
  (SELECT min(j.scheduled_at) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status IN ('pending', 'retry') AND j.scheduled_at > now()) AS next_slot_at,
  (SELECT count(*) FROM public.publish_accounts a WHERE a.project_id = p.id AND a.token_expires_at IS NOT NULL AND a.token_expires_at < now() + interval '7 days') AS tokens_expiring_7d,
  (SELECT coalesce(sum(m.reach), 0) FROM public.post_metrics m WHERE m.project_id = p.id AND m.checkpoint = 'd3' AND m.captured_at >= now() - interval '7 days') AS reach_d3_7d,
  (SELECT spent_month_usd FROM public.project_spend(p.id)) AS spent_month_usd,
  coalesce((SELECT s.paused FROM public.publish_project_settings s WHERE s.project_id = p.id), false) AS paused
FROM public.projects p;

GRANT SELECT ON public.publish_metrics TO authenticated;

-- Витрина по группам аккаунтов («Сеть» на странице «Публикации»): состав,
-- публикации и ошибки за 7 дней, охват d3, здоровье, ближайший слот.
-- Членство: publish_accounts.group_id или старый список group.account_ids.
CREATE OR REPLACE VIEW public.publish_group_metrics
WITH (security_invoker = true)
AS
WITH members AS (
  SELECT g.id AS group_id, a.id AS account_id, a.status, a.publish_enabled, a.health_score, a.token_expires_at
    FROM public.publish_account_groups g
    JOIN public.publish_accounts a
      ON a.project_id = g.project_id
     AND (a.group_id = g.id OR a.id = ANY (coalesce(g.account_ids, '{}')))
)
SELECT
  g.id AS group_id,
  g.project_id,
  g.name,
  g.platform,
  g.review_mode,
  g.persona_id,
  (SELECT count(*) FROM members m WHERE m.group_id = g.id) AS accounts_total,
  (SELECT count(*) FROM members m WHERE m.group_id = g.id AND m.status = 'active' AND m.publish_enabled) AS accounts_active,
  (SELECT count(*) FROM members m WHERE m.group_id = g.id AND m.status = 'token_expired') AS accounts_token_expired,
  (SELECT round(avg(m.health_score), 1) FROM members m WHERE m.group_id = g.id) AS health_avg,
  (SELECT count(*) FROM public.publish_jobs j JOIN members m ON m.account_id = j.account_id AND m.group_id = g.id
    WHERE j.status IN ('pending', 'retry')) AS jobs_queued,
  (SELECT count(*) FROM public.publish_jobs j JOIN members m ON m.account_id = j.account_id AND m.group_id = g.id
    WHERE j.status = 'published' AND j.published_at >= now() - interval '7 days') AS published_7d,
  (SELECT count(*) FROM public.publish_jobs j JOIN members m ON m.account_id = j.account_id AND m.group_id = g.id
    WHERE j.status = 'failed' AND j.updated_at >= now() - interval '7 days') AS failed_7d,
  (SELECT min(j.scheduled_at) FROM public.publish_jobs j JOIN members m ON m.account_id = j.account_id AND m.group_id = g.id
    WHERE j.status IN ('pending', 'retry') AND j.scheduled_at > now()) AS next_slot_at,
  (SELECT coalesce(sum(pm.reach), 0) FROM public.post_metrics pm JOIN members m ON m.account_id = pm.account_id AND m.group_id = g.id
    WHERE pm.checkpoint = 'd3' AND pm.captured_at >= now() - interval '7 days') AS reach_d3_7d,
  (SELECT count(*) FROM public.content_plan_items c WHERE c.target_group_id = g.id AND c.status = 'approved') AS items_approved
FROM public.publish_account_groups g;

GRANT SELECT ON public.publish_group_metrics TO authenticated;

-- ── 9. Идея → тема контент-плана ────────────────────────────
CREATE OR REPLACE FUNCTION public.radar_promote_idea(
  p_idea_id uuid,
  p_group_id uuid DEFAULT NULL,
  p_persona_id uuid DEFAULT NULL,
  p_engine text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i public.idea_bank%ROWTYPE;
  v_persona uuid;
  v_item uuid;
BEGIN
  SELECT * INTO i FROM public.idea_bank WHERE id = p_idea_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'idea not found'; END IF;
  IF NOT public.user_can_access_project(i.project_id) AND current_user <> 'service_role' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF i.content_item_id IS NOT NULL THEN RETURN i.content_item_id; END IF;

  v_persona := coalesce(p_persona_id, (SELECT persona_id FROM public.publish_account_groups WHERE id = p_group_id));

  INSERT INTO public.content_plan_items (
    project_id, title, category, content_type, status, description, prompts,
    target_group_id, persona_id, engine, idea_id, created_by
  ) VALUES (
    i.project_id,
    left(i.title, 200),
    'content',
    'REELS',
    'idea',
    NULL,
    concat_ws(E'\n',
      CASE WHEN i.hook IS NOT NULL THEN 'Хук: ' || i.hook END,
      CASE WHEN i.angle IS NOT NULL THEN 'Угол: ' || i.angle END,
      CASE WHEN i.niche IS NOT NULL THEN 'Ниша: ' || i.niche END,
      CASE WHEN i.structure <> '{}'::jsonb THEN 'Структура: ' || i.structure::text END,
      CASE WHEN i.script_draft IS NOT NULL THEN 'Черновик: ' || i.script_draft END
    ),
    p_group_id,
    v_persona,
    coalesce(p_engine, (SELECT engine_default FROM public.personas WHERE id = v_persona)),
    i.id,
    auth.uid()
  ) RETURNING id INTO v_item;

  UPDATE public.idea_bank
     SET status = 'used', content_item_id = v_item, target_group_id = coalesce(p_group_id, target_group_id)
   WHERE id = i.id;
  RETURN v_item;
END;
$$;

GRANT EXECUTE ON FUNCTION public.radar_promote_idea(uuid, uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.radar_promote_idea(uuid, uuid, uuid, text) IS
  'Идея радара → тема REELS в контент-плане с группой/персоной; идемпотентно (второй вызов вернёт ту же тему).';

-- ── 9b. Очередь контент-конвейера: фильтр по движку ─────────
-- n8n-воркфлоу v5 рендерит только HeyGen; темы с engine = reels_faceless /
-- montage забирают свои воркеры. Старую двухаргументную версию удаляем —
-- иначе вызов с двумя аргументами станет неоднозначным.
DROP FUNCTION IF EXISTS public.claim_next_content_job(text, uuid);
CREATE OR REPLACE FUNCTION public.claim_next_content_job(
  p_worker_id text,
  p_project_id uuid DEFAULT NULL,
  p_engine text DEFAULT 'heygen'
)
RETURNS TABLE (
  pipeline_run_id uuid,
  content_item_id uuid,
  project_id uuid,
  attempt integer,
  resumed boolean,
  provider_job_id text,
  run_metadata jsonb,
  title text,
  description text,
  prompts text,
  category text,
  hashtags text,
  project_name text,
  settings jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.pipeline_runs%ROWTYPE;
  v_item public.content_plan_items%ROWTYPE;
BEGIN
  PERFORM public.requeue_stale_content_jobs();

  SELECT r.* INTO v_run
    FROM public.pipeline_runs r
    JOIN public.content_plan_items i ON i.id = r.content_item_id
    LEFT JOIN public.personas ps ON ps.id = i.persona_id
   WHERE r.state = 'retry_wait'
     AND r.next_retry_at IS NOT NULL
     AND r.next_retry_at <= now()
     AND (p_project_id IS NULL OR r.project_id = p_project_id)
     AND (p_engine IS NULL OR coalesce(i.engine, ps.engine_default, 'heygen') = p_engine)
     AND coalesce((SELECT s.enabled FROM public.content_pipeline_settings s WHERE s.project_id = r.project_id), true)
     AND public.content_pipeline_budget_ok(r.project_id)
     AND public.project_budget_ok(r.project_id)
     AND public.content_pipeline_slot_free(r.project_id)
   ORDER BY r.next_retry_at
   FOR UPDATE OF r SKIP LOCKED
   LIMIT 1;

  IF FOUND THEN
    UPDATE public.pipeline_runs
       SET state = 'claimed', attempt = pipeline_runs.attempt + 1, locked_at = now(), locked_by = p_worker_id,
           heartbeat_at = now(), next_retry_at = NULL,
           error_code = NULL, error_message = NULL, error_user = NULL, error_node = NULL, error_at = NULL
     WHERE id = v_run.id
     RETURNING * INTO v_run;
    UPDATE public.content_plan_items SET status = 'in_progress', pipeline_run_id = v_run.id WHERE id = v_run.content_item_id;
    RETURN QUERY
      SELECT v_run.id, i.id, i.project_id, v_run.attempt, true, v_run.provider_job_id, v_run.metadata,
             i.title, i.description, i.prompts, i.category, i.hashtags, p.name,
             public.content_pipeline_settings_json(i.project_id)
        FROM public.content_plan_items i JOIN public.projects p ON p.id = i.project_id
       WHERE i.id = v_run.content_item_id;
    RETURN;
  END IF;

  SELECT i.* INTO v_item
    FROM public.content_plan_items i
    LEFT JOIN public.personas ps ON ps.id = i.persona_id
    LEFT JOIN public.publish_account_groups g ON g.id = i.target_group_id
   WHERE i.content_type = 'REELS'
     AND i.status = 'idea'
     AND (p_project_id IS NULL OR i.project_id = p_project_id)
     AND (p_engine IS NULL OR coalesce(i.engine, ps.engine_default, 'heygen') = p_engine)
     AND coalesce(g.review_mode, 'review_required') <> 'paused'
     AND NOT EXISTS (
       SELECT 1 FROM public.pipeline_runs r
        WHERE r.content_item_id = i.id AND r.state NOT IN ('approved', 'rejected', 'failed', 'cancelled')
     )
     AND coalesce((SELECT s.enabled FROM public.content_pipeline_settings s WHERE s.project_id = i.project_id), true)
     AND public.content_pipeline_budget_ok(i.project_id)
     AND public.project_budget_ok(i.project_id)
     AND public.content_pipeline_slot_free(i.project_id)
   ORDER BY i.created_at
   FOR UPDATE OF i SKIP LOCKED
   LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.pipeline_runs (content_item_id, project_id, state, attempt, locked_at, locked_by, heartbeat_at, started_at)
  VALUES (v_item.id, v_item.project_id, 'claimed', 1, now(), p_worker_id, now(), now())
  RETURNING * INTO v_run;
  UPDATE public.content_plan_items SET status = 'in_progress', pipeline_run_id = v_run.id WHERE id = v_item.id;

  RETURN QUERY
    SELECT v_run.id, v_item.id, v_item.project_id, v_run.attempt, false, NULL::text, v_run.metadata,
           v_item.title, v_item.description, v_item.prompts, v_item.category, v_item.hashtags, p.name,
           public.content_pipeline_settings_json(v_item.project_id)
      FROM public.projects p WHERE p.id = v_item.project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_content_job(text, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_content_job(text, uuid, text) TO service_role;

-- ── 10. Кроны ───────────────────────────────────────────────
-- Воркер публикаций — три партиции по аккаунту: параллельные вызовы не спорят
-- за одни аккаунты, суммарно до 75 заданий в минуту.
SELECT cron.unschedule('publish-worker-minutely')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-worker-minutely');

DO $cron$
DECLARE i integer;
BEGIN
  FOR i IN 0..2 LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-worker-p' || i) THEN
      PERFORM cron.unschedule('publish-worker-p' || i);
    END IF;
    PERFORM cron.schedule(
      'publish-worker-p' || i,
      '* * * * *',
      format($job$
        SELECT net.http_post(
          url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-worker',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
          ),
          body    := jsonb_build_object('batch_size', 25, 'partition', %s, 'partitions', 3)
        );
      $job$, i)
    );
  END LOOP;
END
$cron$;

-- Дайджест сбоев раз в час и сбор метрик публикаций раз в 6 часов.
SELECT cron.unschedule('publish-monitor-digest-hourly')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-monitor-digest-hourly');
SELECT cron.schedule(
  'publish-monitor-digest-hourly',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('mode', 'digest')
  );
  $$
);

SELECT cron.unschedule('publish-metrics-6h')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-metrics-6h');
SELECT cron.schedule(
  'publish-metrics-6h',
  '20 */6 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-metrics',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('source', 'pg_cron')
  );
  $$
);
