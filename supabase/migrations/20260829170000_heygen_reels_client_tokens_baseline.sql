-- Базовые схемы таблиц, которые до сих пор существовали только в проде.
--
-- heygen_jobs / heygen_usage / heygen_defaults (AI-монтаж), reels_jobs / reels_usage
-- (Reels-видео) и client_dashboard_tokens (клиентский дашборд /client/:token) были
-- заведены руками, миграций на них в репозитории не было. Из-за этого свежее
-- окружение поднималось с неработающими разделами, а их RLS нигде не фиксировалась.
--
-- Схемы сняты с прод-базы (information_schema.columns, pg_indexes, pg_policies),
-- не восстановлены по коду.
--
-- Каждый блок выполняется ТОЛЬКО если таблицы ещё нет. На проде, где все шесть
-- таблиц существуют, миграция целиком no-op и не трогает существующие политики.
--
-- Внешние ключи намеренно не создаются: в снятом дампе их не было, а добавлять
-- непроверенные ограничения на свежем окружении опаснее, чем обойтись без них.

-- ============================================================
-- client_dashboard_tokens — токены доступа к клиентскому дашборду
-- ============================================================
DO $mig$
BEGIN
  IF to_regclass('public.client_dashboard_tokens') IS NULL THEN
    CREATE TABLE public.client_dashboard_tokens (
      token text NOT NULL,
      client_id uuid NOT NULL,
      label text,
      expires_at timestamptz,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT client_dashboard_tokens_pkey PRIMARY KEY (token)
    );

    CREATE INDEX client_dashboard_tokens_client_idx
      ON public.client_dashboard_tokens (client_id) WHERE (is_active = true);

    -- RLS включена БЕЗ политик — это не упущение: таблица читается только
    -- edge-функцией client-dashboard под service_role, который RLS обходит.
    -- Любая политика здесь открыла бы токены клиентам. Не добавлять.
    ALTER TABLE public.client_dashboard_tokens ENABLE ROW LEVEL SECURITY;
  END IF;
END
$mig$;

-- ============================================================
-- heygen_defaults — настройки аватара/голоса по проекту
-- ============================================================
DO $mig$
BEGIN
  IF to_regclass('public.heygen_defaults') IS NULL THEN
    CREATE TABLE public.heygen_defaults (
      project_id uuid NOT NULL,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT heygen_defaults_pkey PRIMARY KEY (project_id)
    );

    ALTER TABLE public.heygen_defaults ENABLE ROW LEVEL SECURITY;

    CREATE POLICY heygen_defaults_rw ON public.heygen_defaults
      FOR ALL TO public
      USING (project_id IN (SELECT id FROM public.projects))
      WITH CHECK (project_id IN (SELECT id FROM public.projects));
  END IF;
END
$mig$;

-- ============================================================
-- heygen_jobs — очередь генерации «говорящей головы»
-- ============================================================
DO $mig$
BEGIN
  IF to_regclass('public.heygen_jobs') IS NULL THEN
    CREATE TABLE public.heygen_jobs (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      project_id uuid,
      chat_id text,
      session_id text NOT NULL,
      source text NOT NULL DEFAULT 'telegram'::text,
      status text NOT NULL DEFAULT 'processing'::text,
      script text,
      aspect text,
      montage_brief text,
      video_url text,
      cover_url text,
      description text,
      error text,
      delivered boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT heygen_jobs_pkey PRIMARY KEY (id)
    );

    CREATE INDEX heygen_jobs_pending_idx
      ON public.heygen_jobs (delivered, created_at) WHERE (delivered = false);

    ALTER TABLE public.heygen_jobs ENABLE ROW LEVEL SECURITY;

    CREATE POLICY hj_select ON public.heygen_jobs
      FOR SELECT TO public
      USING (project_id IN (SELECT id FROM public.projects));

    CREATE POLICY hj_insert ON public.heygen_jobs
      FOR INSERT TO authenticated
      WITH CHECK (project_id IN (SELECT id FROM public.projects));
  END IF;
END
$mig$;

-- ============================================================
-- heygen_usage — готовые ролики и расход по проекту
-- ============================================================
DO $mig$
BEGIN
  IF to_regclass('public.heygen_usage') IS NULL THEN
    CREATE TABLE public.heygen_usage (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      project_id uuid,
      source text NOT NULL DEFAULT 'web'::text,
      mode text NOT NULL DEFAULT 'agent'::text,
      ref_id text,
      duration_sec numeric,
      render_time_sec numeric,
      cost_usd numeric,
      status text NOT NULL DEFAULT 'completed'::text,
      title text,
      description text,
      video_url text,
      cover_url text,
      thumbnail_url text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT heygen_usage_pkey PRIMARY KEY (id)
    );

    CREATE UNIQUE INDEX heygen_usage_project_ref_unique
      ON public.heygen_usage (project_id, ref_id);
    CREATE INDEX heygen_usage_project_idx
      ON public.heygen_usage (project_id, created_at DESC);

    ALTER TABLE public.heygen_usage ENABLE ROW LEVEL SECURITY;

    CREATE POLICY heygen_usage_select ON public.heygen_usage
      FOR SELECT TO public
      USING (project_id IN (SELECT id FROM public.projects));

    CREATE POLICY heygen_usage_insert ON public.heygen_usage
      FOR INSERT TO public
      WITH CHECK (project_id IN (SELECT id FROM public.projects));

    CREATE POLICY heygen_usage_delete ON public.heygen_usage
      FOR DELETE TO authenticated
      USING (project_id IN (SELECT id FROM public.projects));
  END IF;
END
$mig$;

-- ============================================================
-- reels_jobs — очередь Reels-видео
-- ============================================================
DO $mig$
BEGIN
  IF to_regclass('public.reels_jobs') IS NULL THEN
    CREATE TABLE public.reels_jobs (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      project_id uuid,
      session_id text NOT NULL,
      chat_id text,
      source text NOT NULL DEFAULT 'web'::text,
      status text NOT NULL DEFAULT 'queued'::text,
      script text,
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      progress integer NOT NULL DEFAULT 0,
      stage text,
      video_url text,
      cover_url text,
      duration_sec numeric,
      error text,
      worker_id text,
      attempts integer NOT NULL DEFAULT 0,
      delivered boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT reels_jobs_pkey PRIMARY KEY (id)
    );

    CREATE INDEX idx_reels_jobs_queued
      ON public.reels_jobs (created_at) WHERE (status = 'queued'::text);
    CREATE INDEX idx_reels_jobs_project
      ON public.reels_jobs (project_id, created_at DESC);

    ALTER TABLE public.reels_jobs ENABLE ROW LEVEL SECURITY;

    CREATE POLICY reels_jobs_select ON public.reels_jobs
      FOR SELECT TO public
      USING (project_id IN (SELECT id FROM public.projects));

    CREATE POLICY reels_jobs_insert ON public.reels_jobs
      FOR INSERT TO public
      WITH CHECK (project_id IN (SELECT id FROM public.projects));
  END IF;
END
$mig$;

-- ============================================================
-- reels_usage — готовые Reels и расход по проекту
-- ============================================================
DO $mig$
BEGIN
  IF to_regclass('public.reels_usage') IS NULL THEN
    CREATE TABLE public.reels_usage (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      job_id uuid,
      project_id uuid,
      source text NOT NULL DEFAULT 'web'::text,
      mode text NOT NULL DEFAULT 'faceless'::text,
      ref_id text,
      duration_sec numeric,
      cost_usd numeric,
      status text NOT NULL DEFAULT 'completed'::text,
      title text,
      description text,
      video_url text,
      cover_url text,
      thumbnail_url text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT reels_usage_pkey PRIMARY KEY (id)
    );

    CREATE INDEX idx_reels_usage_project
      ON public.reels_usage (project_id, created_at DESC);

    ALTER TABLE public.reels_usage ENABLE ROW LEVEL SECURITY;

    CREATE POLICY reels_usage_select ON public.reels_usage
      FOR SELECT TO public
      USING (project_id IN (SELECT id FROM public.projects));

    CREATE POLICY reels_usage_insert ON public.reels_usage
      FOR INSERT TO public
      WITH CHECK (project_id IN (SELECT id FROM public.projects));

    CREATE POLICY reels_usage_delete ON public.reels_usage
      FOR DELETE TO authenticated
      USING (project_id IN (SELECT id FROM public.projects));
  END IF;
END
$mig$;
