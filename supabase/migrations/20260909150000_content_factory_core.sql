-- Social Content Factory OS — ядро Phase 1 (docs/ARCHITECTURE.md, раздел 5).
--
--   1. publish_jobs: верификация публикации (статус verifying, verification_status,
--      verified_at, verify_attempts), канонический класс ошибки error_class, trace_id.
--   2. publish_videos.client_ref — ключ идемпотентности внешнего клиента (API/MCP).
--   3. publish_accounts: capabilities, connection_type, auth_status.
--   4. publish_job_events — трасса задания (шаги JOB_CLAIMED … VERIFIED).
--   5. publish_notifications — центр уведомлений проекта.
--   6. api_request_logs — аудит вызовов публичного API (кто/что/когда через ключ).
--   7. post_metrics: ранние точки h1 / h6; post_metrics_due их учитывает.
--   8. publish_performance_score() + витрины publish_content_metrics, publish_publications.
--   9. claim_publish_verifications() — атомарный забор заданий на верификацию.
--  10. publish_maintenance_gc() + суточный крон — ретеншн журналов.
--
-- Идемпотентна: повторный прогон ничего не ломает. Ничего не удаляет.

-- ── 1. publish_jobs ──────────────────────────────────────────
ALTER TABLE public.publish_jobs DROP CONSTRAINT IF EXISTS publish_jobs_status_check;
ALTER TABLE public.publish_jobs ADD CONSTRAINT publish_jobs_status_check
  CHECK (status IN ('pending','processing','verifying','published','failed','retry','manual_review','cancelled'));

ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS verify_attempts     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_class         text,
  ADD COLUMN IF NOT EXISTS trace_id            uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.publish_jobs DROP CONSTRAINT IF EXISTS publish_jobs_verification_check;
ALTER TABLE public.publish_jobs ADD CONSTRAINT publish_jobs_verification_check
  CHECK (verification_status IN ('pending','verified','unverified','skipped'));

COMMENT ON COLUMN public.publish_jobs.verification_status IS
  'pending — площадка ответила, пост ещё не прочитан обратно; verified — пост найден у площадки; unverified — не найден за все попытки (пост скорее всего есть, повтор дал бы дубль); skipped — площадка не даёт прочитать пост этим токеном.';
COMMENT ON COLUMN public.publish_jobs.error_class IS
  'Канонический класс ошибки (_lib/publishPolicy.ts): AUTH_EXPIRED, RATE_LIMIT, MEDIA_INVALID, PLATFORM_TEMPORARY_ERROR, … — для витрин и AI, сырой код площадки остаётся в error_code.';
COMMENT ON COLUMN public.publish_jobs.trace_id IS
  'Сквозной идентификатор трассы: строки publish_job_events и структурные логи функций несут его же.';

-- Уже опубликованное до этой миграции считаем проверенным временем: метрики по нему собирались.
UPDATE public.publish_jobs SET verification_status = 'skipped'
 WHERE status = 'published' AND verification_status = 'pending' AND verified_at IS NULL;

CREATE INDEX IF NOT EXISTS publish_jobs_verifying_idx
  ON public.publish_jobs (next_attempt_at) WHERE status = 'verifying';
CREATE INDEX IF NOT EXISTS publish_jobs_trace_idx ON public.publish_jobs (trace_id);
CREATE INDEX IF NOT EXISTS publish_jobs_project_status_idx ON public.publish_jobs (project_id, status);

-- ── 2. publish_videos.client_ref ─────────────────────────────
ALTER TABLE public.publish_videos ADD COLUMN IF NOT EXISTS client_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS publish_videos_client_ref_uniq
  ON public.publish_videos (project_id, client_ref) WHERE client_ref IS NOT NULL;
COMMENT ON COLUMN public.publish_videos.client_ref IS
  'Ключ идемпотентности клиента API/MCP: повторный POST /publications с тем же client_ref возвращает то же видео, не создавая второе.';

-- ── 3. publish_accounts: возможности и тип подключения ───────
ALTER TABLE public.publish_accounts
  ADD COLUMN IF NOT EXISTS capabilities    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS connection_type text  NOT NULL DEFAULT 'oauth',
  ADD COLUMN IF NOT EXISTS auth_status     text  NOT NULL DEFAULT 'connected';

ALTER TABLE public.publish_accounts DROP CONSTRAINT IF EXISTS publish_accounts_connection_type_check;
ALTER TABLE public.publish_accounts ADD CONSTRAINT publish_accounts_connection_type_check
  CHECK (connection_type IN ('oauth','device','hybrid'));
ALTER TABLE public.publish_accounts DROP CONSTRAINT IF EXISTS publish_accounts_auth_status_check;
ALTER TABLE public.publish_accounts ADD CONSTRAINT publish_accounts_auth_status_check
  CHECK (auth_status IN ('connected','expiring','expired','reconnect_required'));

COMMENT ON COLUMN public.publish_accounts.capabilities IS
  'Что умеет аккаунт этим токеном (_lib/publishCapabilities.ts): publish_video, publish_image, get_publication, get_insights, … Раннер проверяет перед действием.';
COMMENT ON COLUMN public.publish_accounts.auth_status IS
  'connected | expiring (< 7 дней) | expired | reconnect_required — выставляет монитор здоровья.';

GRANT SELECT (capabilities, connection_type, auth_status) ON public.publish_accounts TO authenticated;

-- DROP + CREATE, а не CREATE OR REPLACE: повторный прогон после более поздней миграции,
-- добавившей колонки в это же представление, иначе падает с «cannot drop columns from view».
DROP VIEW IF EXISTS public.publish_accounts_safe;
CREATE VIEW public.publish_accounts_safe
WITH (security_invoker = true) AS
SELECT id, project_id, platform, account_name, handle, external_account_id, fb_page_id,
       token_expires_at, status, publish_enabled, daily_limit, last_post_at,
       consecutive_errors, last_error, notes, created_at, updated_at,
       group_id, persona_id, timezone, window_start, window_end,
       ramp_enabled, ramp_started_at, health_score, health_reasons, last_checked_at,
       published_today, published_day, token_refreshed_at, followers, metrics_synced_at, oauth_scope,
       capabilities, connection_type, auth_status
  FROM public.publish_accounts;
GRANT SELECT ON public.publish_accounts_safe TO authenticated;

-- ── 4. Трасса задания ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.publish_job_events (
  id          bigserial PRIMARY KEY,
  job_id      uuid NOT NULL REFERENCES public.publish_jobs(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL,
  account_id  uuid,
  trace_id    uuid,
  step        text NOT NULL,
  level       text NOT NULL DEFAULT 'info',
  message     text,
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_job_events_level_check CHECK (level IN ('info','warning','error'))
);
COMMENT ON TABLE public.publish_job_events IS
  'Шаги выполнения задания: JOB_CLAIMED, AUTH_OK, CAPABILITY_OK, MEDIA_OK, UPLOAD_STARTED, PROVIDER_PROCESSING, MEDIA_CREATED, VERIFY_STARTED, VERIFIED, SUCCESS, RETRY, FAILED… data — без токенов.';
CREATE INDEX IF NOT EXISTS publish_job_events_job_idx ON public.publish_job_events (job_id, created_at);
CREATE INDEX IF NOT EXISTS publish_job_events_project_idx ON public.publish_job_events (project_id, created_at DESC);
ALTER TABLE public.publish_job_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publish_job_events_select ON public.publish_job_events;
CREATE POLICY publish_job_events_select ON public.publish_job_events FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
GRANT SELECT ON public.publish_job_events TO authenticated;

-- ── 5. Уведомления ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.publish_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  severity    text NOT NULL DEFAULT 'info',
  title       text NOT NULL,
  body        text,
  entity_type text,
  entity_id   uuid,
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_notifications_severity_check CHECK (severity IN ('info','warning','error'))
);
COMMENT ON TABLE public.publish_notifications IS
  'Центр уведомлений: account.reconnect_required, publication.failed, publication.unverified, account.health_error, system.*. dedupe_key не даёт завести одно и то же дважды.';
-- Не частичный: PostgREST-upsert (on_conflict=project_id,dedupe_key) не умеет предикат частичного
-- индекса, а NULL-ключи и так не конфликтуют между собой (NULLS DISTINCT).
DROP INDEX IF EXISTS public.publish_notifications_dedupe_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS publish_notifications_dedupe_uniq
  ON public.publish_notifications (project_id, dedupe_key);
CREATE INDEX IF NOT EXISTS publish_notifications_project_idx
  ON public.publish_notifications (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS publish_notifications_unread_idx
  ON public.publish_notifications (project_id) WHERE read_at IS NULL;
ALTER TABLE public.publish_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publish_notifications_select ON public.publish_notifications;
CREATE POLICY publish_notifications_select ON public.publish_notifications FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
GRANT SELECT ON public.publish_notifications TO authenticated;

-- ── 6. Аудит публичного API ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_request_logs (
  id           bigserial PRIMARY KEY,
  api_key_id   uuid,
  project_id   uuid NOT NULL,
  method       text NOT NULL,
  route        text NOT NULL,
  path         text,
  status       integer NOT NULL,
  params_hash  text,
  duration_ms  integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.api_request_logs IS
  'Кто (ключ), что (маршрут) и когда вызвал публичный API / MCP; параметры — только sha256-хэш, без содержимого.';
CREATE INDEX IF NOT EXISTS api_request_logs_project_idx ON public.api_request_logs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_request_logs_key_idx ON public.api_request_logs (api_key_id, created_at DESC);
ALTER TABLE public.api_request_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_request_logs_select ON public.api_request_logs;
CREATE POLICY api_request_logs_select ON public.api_request_logs FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
GRANT SELECT ON public.api_request_logs TO authenticated;

-- ── 7. Ранние контрольные точки метрик ───────────────────────
ALTER TABLE public.post_metrics DROP CONSTRAINT IF EXISTS post_metrics_checkpoint_check;
ALTER TABLE public.post_metrics ADD CONSTRAINT post_metrics_checkpoint_check
  CHECK (checkpoint IN ('h1', 'h6', 'd1', 'd3', 'd7', 'manual'));

CREATE OR REPLACE FUNCTION public.post_metrics_due(p_limit integer DEFAULT 200)
RETURNS TABLE (job_id uuid, project_id uuid, account_id uuid, platform text, external_post_id text, checkpoint text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.project_id, j.account_id, j.platform, j.external_post_id, cp.checkpoint
    FROM public.publish_jobs j
    CROSS JOIN (VALUES
      ('h1', interval '1 hour'), ('h6', interval '6 hours'),
      ('d1', interval '1 day'), ('d3', interval '3 days'), ('d7', interval '7 days')
    ) AS cp(checkpoint, age)
   WHERE j.status = 'published'
     AND j.external_post_id IS NOT NULL
     AND j.verification_status <> 'unverified'
     AND j.metrics_unavailable_reason IS NULL
     AND j.published_at <= now() - cp.age
     AND j.published_at >= now() - interval '30 days'
     -- Ранние точки не догоняем задним числом: h1 старше суток бессмысленна.
     AND (cp.checkpoint NOT IN ('h1', 'h6') OR j.published_at >= now() - interval '1 day')
     AND NOT EXISTS (SELECT 1 FROM public.post_metrics m WHERE m.job_id = j.id AND m.checkpoint = cp.checkpoint)
   ORDER BY j.published_at
   LIMIT greatest(p_limit, 1);
$$;
REVOKE ALL ON FUNCTION public.post_metrics_due(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_metrics_due(integer) TO service_role;

-- ── 8. Скоринг и витрины контента ────────────────────────────
-- Детерминированный Performance Score 0..100: половина — просмотры относительно
-- базы подписчиков (насыщение около 50 % базы), половина — вовлечение на просмотр
-- (лайк 1, комментарий 2, репост 3, сохранение 3; насыщение около 5 %).
CREATE OR REPLACE FUNCTION public.publish_performance_score(
  p_views integer, p_reach integer, p_likes integer, p_comments integer,
  p_shares integer, p_saves integer, p_followers integer
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN coalesce(p_views, 0) <= 0 AND coalesce(p_reach, 0) <= 0 THEN 0
  ELSE round(100 * (
      0.5 * (1 - exp(-2 * greatest(coalesce(p_views, 0), coalesce(p_reach, 0))::numeric / greatest(coalesce(p_followers, 0), 500)))
    + 0.5 * (1 - exp(-20 * (coalesce(p_likes, 0) + 2 * coalesce(p_comments, 0) + 3 * coalesce(p_shares, 0) + 3 * coalesce(p_saves, 0))::numeric
                         / greatest(coalesce(p_views, 0), coalesce(p_reach, 0), 1)))
  ), 1) END;
$$;
GRANT EXECUTE ON FUNCTION public.publish_performance_score(integer, integer, integer, integer, integer, integer, integer) TO authenticated, service_role;

-- Модель публикации: одна строка = один пост в одном аккаунте (без переноса данных из publish_jobs).
CREATE OR REPLACE VIEW public.publish_publications
WITH (security_invoker = true) AS
WITH latest AS (
  SELECT DISTINCT ON (m.job_id) m.job_id, m.checkpoint, m.captured_at, m.reach, m.views, m.likes, m.comments, m.shares, m.saves, m.followers
    FROM public.post_metrics m
   ORDER BY m.job_id,
            CASE m.checkpoint WHEN 'd7' THEN 6 WHEN 'd3' THEN 5 WHEN 'd1' THEN 4 WHEN 'h6' THEN 3 WHEN 'h1' THEN 2 ELSE 1 END DESC,
            m.captured_at DESC
)
SELECT
  j.id                    AS publication_id,
  j.project_id,
  j.video_id              AS content_id,
  j.account_id,
  j.platform,
  j.status,
  j.verification_status,
  j.verified_at,
  j.external_post_id      AS platform_media_id,
  j.external_post_url     AS platform_url,
  j.scheduled_at,
  j.published_at,
  j.caption,
  j.hashtags,
  j.error_class,
  j.error_code,
  j.trace_id,
  a.account_name,
  a.handle,
  v.title                 AS content_title,
  l.checkpoint            AS metrics_checkpoint,
  l.captured_at           AS metrics_captured_at,
  l.views, l.reach, l.likes, l.comments, l.shares, l.saves,
  CASE WHEN l.job_id IS NULL THEN NULL
       ELSE public.publish_performance_score(l.views, l.reach, l.likes, l.comments, l.shares, l.saves, coalesce(l.followers, a.followers)) END AS score
FROM public.publish_jobs j
JOIN public.publish_accounts a ON a.id = j.account_id
JOIN public.publish_videos v ON v.id = j.video_id
LEFT JOIN latest l ON l.job_id = j.id
WHERE j.status IN ('verifying', 'published');
GRANT SELECT ON public.publish_publications TO authenticated;
COMMENT ON VIEW public.publish_publications IS
  'Публикации (verifying/published) с последней контрольной точкой метрик и Performance Score.';

-- Аналитика контента: одно видео во всех аккаунтах — сумма, среднее, лучший аккаунт, победители.
CREATE OR REPLACE VIEW public.publish_content_metrics
WITH (security_invoker = true) AS
WITH pubs AS (
  SELECT p.*, row_number() OVER (PARTITION BY p.content_id ORDER BY coalesce(p.views, 0) DESC, p.published_at) AS rn
    FROM public.publish_publications p
),
agg AS (
  SELECT content_id,
         count(*)                                              AS publications_total,
         count(*) FILTER (WHERE status = 'published')          AS publications_published,
         count(*) FILTER (WHERE metrics_checkpoint IS NOT NULL) AS publications_measured,
         coalesce(sum(views), 0)                               AS views_total,
         coalesce(sum(reach), 0)                               AS reach_total,
         coalesce(sum(likes), 0)                               AS likes_total,
         coalesce(sum(comments), 0)                            AS comments_total,
         coalesce(sum(shares), 0)                              AS shares_total,
         coalesce(sum(saves), 0)                               AS saves_total,
         round(avg(views) FILTER (WHERE metrics_checkpoint IS NOT NULL), 0) AS views_avg,
         round(avg(score) FILTER (WHERE metrics_checkpoint IS NOT NULL), 1) AS score,
         max(metrics_captured_at)                              AS metrics_updated_at
    FROM pubs
   GROUP BY content_id
),
ranked AS (
  SELECT v.id AS content_id, v.project_id, v.title, v.file_url, v.thumbnail_url, v.status AS content_status, v.source, v.created_at,
         g.publications_total, g.publications_published, g.publications_measured,
         g.views_total, g.reach_total, g.likes_total, g.comments_total, g.shares_total, g.saves_total,
         g.views_avg, g.score, g.metrics_updated_at,
         b.account_id AS best_account_id, b.account_name AS best_account_name, b.views AS best_views,
         CASE WHEN g.score IS NOT NULL AND g.publications_measured > 0
              THEN percent_rank() OVER (PARTITION BY v.project_id, (g.score IS NOT NULL AND g.publications_measured > 0) ORDER BY g.score)
         END AS score_rank
    FROM public.publish_videos v
    LEFT JOIN agg g ON g.content_id = v.id
    LEFT JOIN pubs b ON b.content_id = v.id AND b.rn = 1
)
SELECT r.*, coalesce(r.score_rank >= 0.9 AND r.publications_measured >= 1, false) AS is_winner
  FROM ranked r;
GRANT SELECT ON public.publish_content_metrics TO authenticated;
COMMENT ON VIEW public.publish_content_metrics IS
  'Строка на видео: публикации, сумма/среднее просмотров и реакций по всем аккаунтам, лучший аккаунт, Performance Score и is_winner (верхние 10 % проекта среди измеренных).';

-- ── 9. Забор заданий на верификацию ──────────────────────────
CREATE OR REPLACE FUNCTION public.claim_publish_verifications(
  p_batch        integer  DEFAULT 20,
  p_lock_timeout interval DEFAULT interval '5 minutes'
)
RETURNS SETOF public.publish_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.publish_jobs j
     SET locked_at = now(), updated_at = now()
   WHERE j.id IN (
     SELECT pj.id FROM public.publish_jobs pj
      WHERE pj.status = 'verifying'
        AND pj.next_attempt_at <= now()
        AND (pj.locked_at IS NULL OR pj.locked_at < now() - p_lock_timeout)
      ORDER BY pj.next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT greatest(p_batch, 1)
   )
  RETURNING j.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_publish_verifications(integer, interval) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_publish_verifications(integer, interval) TO service_role;
COMMENT ON FUNCTION public.claim_publish_verifications(integer, interval) IS
  'Атомарный забор заданий в статусе verifying, которым пора прочитать пост у площадки (publish-worker, второй проход).';

-- publish_metrics: verifying — тоже «в работе».
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
  (SELECT count(*) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status IN ('processing', 'verifying')) AS jobs_processing,
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

-- ── 10. Ретеншн журналов ─────────────────────────────────────
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
  n_events integer; n_logs integer; n_api integer; n_notif integer;
BEGIN
  DELETE FROM public.publish_job_events WHERE created_at < now() - make_interval(days => greatest(p_events_days, 1));
  GET DIAGNOSTICS n_events = ROW_COUNT;
  DELETE FROM public.publish_logs WHERE created_at < now() - make_interval(days => greatest(p_logs_days, 1));
  GET DIAGNOSTICS n_logs = ROW_COUNT;
  DELETE FROM public.api_request_logs WHERE created_at < now() - make_interval(days => greatest(p_api_logs_days, 1));
  GET DIAGNOSTICS n_api = ROW_COUNT;
  DELETE FROM public.publish_notifications WHERE read_at IS NOT NULL AND created_at < now() - make_interval(days => greatest(p_notif_days, 1));
  GET DIAGNOSTICS n_notif = ROW_COUNT;
  RETURN jsonb_build_object('job_events', n_events, 'publish_logs', n_logs, 'api_request_logs', n_api, 'notifications', n_notif);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_maintenance_gc(integer, integer, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_maintenance_gc(integer, integer, integer, integer) TO service_role;
COMMENT ON FUNCTION public.publish_maintenance_gc(integer, integer, integer, integer) IS
  'Ретеншн: трасса заданий и сырые ответы площадок — 90 дней, аудит API — 90, прочитанные уведомления — 180 (аргументы крона).';

SELECT cron.unschedule('publish-maintenance-daily')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-maintenance-daily');
SELECT cron.schedule('publish-maintenance-daily', '50 3 * * *', $$ SELECT public.publish_maintenance_gc(); $$);
