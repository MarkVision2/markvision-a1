-- Social Content Factory OS — Phase 2, заход 3 (docs/ARCHITECTURE.md):
--   1. RBAC: роль участника проекта (project_members.role) из набора owner/admin/manager/
--      content_manager/operator/viewer; legacy 'member' остаётся допустимым (наследует глобальную роль).
--      project_role_of(project) — та же логика на SQL для интерфейса.
--   2. Routine Engine: publish_routines (шаги относительно времени публикации) → publish_tasks
--      (очередь задач воркера publish-tasks): ACCOUNT_HEALTH_CHECK / TOKEN_CHECK до публикации,
--      METRICS_SYNC после. Назначение — аккаунту, группе или проекту по умолчанию.
-- Идемпотентна, ничего не удаляет.

-- ── 1. RBAC ──────────────────────────────────────────────────
ALTER TABLE public.project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
ALTER TABLE public.project_members ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('member','owner','admin','manager','content_manager','operator','viewer'));
COMMENT ON COLUMN public.project_members.role IS
  'Роль в проекте: admin | manager | content_manager | operator | viewer; member (legacy) — роль по глобальной роли команды (_lib/rbac.ts).';

CREATE OR REPLACE FUNCTION public.project_role_of(_project_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  g AS (
    SELECT coalesce(
      (SELECT p.display_role FROM public.profiles p, me WHERE p.id = me.uid),
      (SELECT CASE WHEN bool_or(r.role::text = 'admin') THEN 'admin' ELSE min(r.role::text) END FROM public.user_roles r, me WHERE r.user_id = me.uid)
    ) AS role
  ),
  m AS (SELECT pm.role FROM public.project_members pm, me WHERE pm.project_id = _project_id AND pm.user_id = me.uid),
  o AS (SELECT (pr.created_by = me.uid) AS is_owner FROM public.projects pr, me WHERE pr.id = _project_id)
  SELECT CASE
    WHEN coalesce((SELECT is_owner FROM o), false) THEN 'owner'
    WHEN (SELECT role FROM m) IN ('owner','admin','manager','content_manager','operator','viewer') THEN (SELECT role FROM m)
    WHEN (SELECT role FROM g) IN ('admin','director') THEN 'admin'
    WHEN NOT EXISTS (SELECT 1 FROM m) THEN NULL
    WHEN (SELECT role FROM g) = 'manager' THEN 'manager'
    WHEN (SELECT role FROM g) = 'marketer' THEN 'content_manager'
    WHEN (SELECT role FROM g) = 'viewer' THEN 'viewer'
    ELSE 'manager'
  END;
$$;
GRANT EXECUTE ON FUNCTION public.project_role_of(uuid) TO authenticated;
COMMENT ON FUNCTION public.project_role_of(uuid) IS 'Роль текущего пользователя в проекте (RBAC контура публикаций); NULL — нет доступа.';

-- ── 2. Рутины ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.publish_routines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text,
  steps       jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default  boolean NOT NULL DEFAULT false,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_routines_name_uniq UNIQUE (project_id, name)
);
COMMENT ON TABLE public.publish_routines IS
  'Рутина: шаги вокруг публикации — [{"action":"ACCOUNT_HEALTH_CHECK","offset_minutes":-15},{"action":"METRICS_SYNC","offset_minutes":20}]. Отрицательный offset — от scheduled_at, положительный — от published_at. is_default — для всех аккаунтов проекта без своей рутины.';
CREATE UNIQUE INDEX IF NOT EXISTS publish_routines_default_uniq ON public.publish_routines (project_id) WHERE is_default;
ALTER TABLE public.publish_routines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publish_routines_select ON public.publish_routines;
CREATE POLICY publish_routines_select ON public.publish_routines FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
GRANT SELECT ON public.publish_routines TO authenticated;
DROP TRIGGER IF EXISTS trg_publish_routines_updated ON public.publish_routines;
CREATE TRIGGER trg_publish_routines_updated BEFORE UPDATE ON public.publish_routines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.publish_accounts ADD COLUMN IF NOT EXISTS routine_id uuid REFERENCES public.publish_routines(id) ON DELETE SET NULL;
ALTER TABLE public.publish_account_groups ADD COLUMN IF NOT EXISTS routine_id uuid REFERENCES public.publish_routines(id) ON DELETE SET NULL;
GRANT SELECT (routine_id) ON public.publish_accounts TO authenticated;

CREATE OR REPLACE VIEW public.publish_accounts_safe
WITH (security_invoker = true) AS
SELECT id, project_id, platform, account_name, handle, external_account_id, fb_page_id,
       token_expires_at, status, publish_enabled, daily_limit, last_post_at,
       consecutive_errors, last_error, notes, created_at, updated_at,
       group_id, persona_id, timezone, window_start, window_end,
       ramp_enabled, ramp_started_at, health_score, health_reasons, last_checked_at,
       published_today, published_day, token_refreshed_at, followers, metrics_synced_at, oauth_scope,
       capabilities, connection_type, auth_status, routine_id
  FROM public.publish_accounts;
GRANT SELECT ON public.publish_accounts_safe TO authenticated;

CREATE TABLE IF NOT EXISTS public.publish_tasks (
  id          bigserial PRIMARY KEY,
  project_id  uuid NOT NULL,
  routine_id  uuid REFERENCES public.publish_routines(id) ON DELETE SET NULL,
  job_id      uuid REFERENCES public.publish_jobs(id) ON DELETE CASCADE,
  account_id  uuid REFERENCES public.publish_accounts(id) ON DELETE CASCADE,
  task_type   text NOT NULL,
  run_at      timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'pending',
  attempts    integer NOT NULL DEFAULT 0,
  locked_at   timestamptz,
  result      jsonb,
  error       text,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_tasks_type_check CHECK (task_type IN ('ACCOUNT_HEALTH_CHECK','TOKEN_CHECK','METRICS_SYNC')),
  CONSTRAINT publish_tasks_status_check CHECK (status IN ('pending','running','done','failed','skipped')),
  CONSTRAINT publish_tasks_uniq UNIQUE (job_id, task_type, run_at)
);
COMMENT ON TABLE public.publish_tasks IS 'Задачи рутин вокруг публикации (Routine Engine). Выполняет edge publish-tasks по крону.';
CREATE INDEX IF NOT EXISTS publish_tasks_due_idx ON public.publish_tasks (run_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS publish_tasks_job_idx ON public.publish_tasks (job_id, run_at);
CREATE INDEX IF NOT EXISTS publish_tasks_project_idx ON public.publish_tasks (project_id, created_at DESC);
ALTER TABLE public.publish_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publish_tasks_select ON public.publish_tasks;
CREATE POLICY publish_tasks_select ON public.publish_tasks FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
GRANT SELECT ON public.publish_tasks TO authenticated;

-- Контрольные точки метрик от рутин: rNm (минуты после публикации).
ALTER TABLE public.post_metrics DROP CONSTRAINT IF EXISTS post_metrics_checkpoint_check;
ALTER TABLE public.post_metrics ADD CONSTRAINT post_metrics_checkpoint_check
  CHECK (checkpoint IN ('h1', 'h6', 'd1', 'd3', 'd7', 'manual') OR checkpoint ~ '^r[0-9]{1,6}m$');

-- Рутина аккаунта: своя → группы → проекта по умолчанию.
CREATE OR REPLACE FUNCTION public.publish_routine_for_account(p_account_id uuid)
RETURNS public.publish_routines
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.* FROM public.publish_accounts a
    LEFT JOIN public.publish_account_groups g ON g.id = a.group_id
    JOIN public.publish_routines r
      ON r.id = coalesce(a.routine_id, g.routine_id, (SELECT d.id FROM public.publish_routines d WHERE d.project_id = a.project_id AND d.is_default))
   WHERE a.id = p_account_id
   LIMIT 1;
$$;

/*
 * Материализация шагов рутины для задания: p_phase = 'before' — шаги с offset < 0 от scheduled_at
 * (при создании / переносе задания), 'after' — шаги с offset >= 0 от published_at (при published).
 * Идемпотентно (UNIQUE job_id, task_type, run_at); шаги в прошлом старше 5 минут не ставятся.
 */
CREATE OR REPLACE FUNCTION public.publish_tasks_materialize(p_job_id uuid, p_phase text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j public.publish_jobs%ROWTYPE;
  r public.publish_routines;
  step jsonb;
  offs integer;
  act text;
  base timestamptz;
  n integer := 0;
BEGIN
  SELECT * INTO j FROM public.publish_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  r := public.publish_routine_for_account(j.account_id);
  IF r.id IS NULL THEN RETURN 0; END IF;
  base := CASE WHEN p_phase = 'after' THEN coalesce(j.published_at, now()) ELSE j.scheduled_at END;
  FOR step IN SELECT * FROM jsonb_array_elements(coalesce(r.steps, '[]'::jsonb)) LOOP
    act := step->>'action';
    offs := coalesce((step->>'offset_minutes')::integer, 0);
    IF act NOT IN ('ACCOUNT_HEALTH_CHECK','TOKEN_CHECK','METRICS_SYNC') THEN CONTINUE; END IF;
    IF (p_phase = 'before' AND offs >= 0) OR (p_phase = 'after' AND offs < 0) THEN CONTINUE; END IF;
    IF p_phase = 'before' AND act = 'METRICS_SYNC' THEN CONTINUE; END IF;  -- метрик до публикации не бывает
    IF base + make_interval(mins => offs) < now() - interval '5 minutes' THEN CONTINUE; END IF;
    INSERT INTO public.publish_tasks (project_id, routine_id, job_id, account_id, task_type, run_at)
    VALUES (j.project_id, r.id, j.id, j.account_id, act, base + make_interval(mins => offs))
    ON CONFLICT (job_id, task_type, run_at) DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_jobs_routine_tasks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('pending','retry') THEN PERFORM public.publish_tasks_materialize(NEW.id, 'before'); END IF;
    RETURN NEW;
  END IF;
  -- Перенос слота (повтор из интерфейса) — пересчитать «до»-шаги; старые pending — снять.
  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at AND NEW.status IN ('pending','retry') THEN
    UPDATE public.publish_tasks SET status = 'skipped', error = 'слот перенесён' WHERE job_id = NEW.id AND status = 'pending' AND task_type <> 'METRICS_SYNC';
    PERFORM public.publish_tasks_materialize(NEW.id, 'before');
  END IF;
  IF NEW.status = 'published' AND OLD.status <> 'published' THEN
    -- Пост уже вышел: проверки «до» больше не нужны.
    UPDATE public.publish_tasks SET status = 'skipped', error = 'публикация уже состоялась' WHERE job_id = NEW.id AND status = 'pending' AND task_type <> 'METRICS_SYNC';
    PERFORM public.publish_tasks_materialize(NEW.id, 'after');
  END IF;
  IF NEW.status IN ('failed','cancelled') AND OLD.status NOT IN ('failed','cancelled') THEN
    UPDATE public.publish_tasks SET status = 'skipped', error = 'задание ' || NEW.status WHERE job_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_publish_jobs_routine_tasks ON public.publish_jobs;
CREATE TRIGGER trg_publish_jobs_routine_tasks AFTER INSERT OR UPDATE OF status, scheduled_at ON public.publish_jobs
  FOR EACH ROW EXECUTE FUNCTION public.publish_jobs_routine_tasks();

CREATE OR REPLACE FUNCTION public.claim_publish_tasks(p_batch integer DEFAULT 20, p_lock_timeout interval DEFAULT interval '5 minutes')
RETURNS SETOF public.publish_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Зависшие running (воркер умер) — назад в pending.
  UPDATE public.publish_tasks SET status = 'pending', locked_at = NULL
   WHERE status = 'running' AND locked_at IS NOT NULL AND locked_at < now() - p_lock_timeout;
  RETURN QUERY
  UPDATE public.publish_tasks t
     SET status = 'running', locked_at = now(), attempts = t.attempts + 1
   WHERE t.id IN (
     SELECT x.id FROM public.publish_tasks x
      WHERE x.status = 'pending' AND x.run_at <= now()
      ORDER BY x.run_at
      FOR UPDATE SKIP LOCKED
      LIMIT greatest(p_batch, 1)
   )
  RETURNING t.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_publish_tasks(integer, interval) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_tasks_materialize(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_routine_for_account(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_publish_tasks(integer, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_tasks_materialize(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_routine_for_account(uuid) TO service_role;

SELECT cron.unschedule('publish-tasks-minutely')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-tasks-minutely');
SELECT cron.schedule(
  'publish-tasks-minutely',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-tasks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('source', 'pg_cron')
  )
  WHERE EXISTS (SELECT 1 FROM public.publish_tasks t WHERE t.status = 'pending' AND t.run_at <= now());
  $$
);

-- GC: выполненные задачи рутин старше 30 дней.
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
  n_events integer; n_logs integer; n_api integer; n_notif integer; n_hooks integer; n_tasks integer;
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
  DELETE FROM public.publish_tasks WHERE status IN ('done', 'failed', 'skipped') AND created_at < now() - interval '30 days';
  GET DIAGNOSTICS n_tasks = ROW_COUNT;
  RETURN jsonb_build_object('job_events', n_events, 'publish_logs', n_logs, 'api_request_logs', n_api, 'notifications', n_notif, 'webhook_deliveries', n_hooks, 'tasks', n_tasks);
END;
$$;
