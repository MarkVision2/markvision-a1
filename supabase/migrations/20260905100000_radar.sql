-- Радар идей (docs/AUTOPOSTING-PLATFORM-PLAN.md, модуль M1).
--
-- До этого сбор конкурентов жил только в n8n и писал в таблицу content_factory,
-- которой нет в миграциях. Здесь появляется схема в git:
--   radar_sources — что мониторим (аккаунт конкурента, хештег, запрос Ad
--                   Library, собственный аккаунт);
--   radar_posts   — собранные публикации с метриками, транскриптом и разбором;
--   radar_runs    — журнал сборов с расходом провайдера;
--   idea_bank     — идеи с оценкой; «в контент-план» делает из идеи тему
--                   (RPC radar_promote_idea — в миграции publishing_scale,
--                   ей нужны колонки content_plan_items оттуда).
--
-- Пишет edge-функция radar под service_role (подписанный callback n8n +
-- разбор через AI-провайдер); пользователи проекта управляют источниками и
-- статусами идей через RLS.

-- ── 1. Источники ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.radar_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  platform text NOT NULL,
  handle text NOT NULL,
  label text,
  enabled boolean NOT NULL DEFAULT true,
  crawl_interval_hours integer NOT NULL DEFAULT 24,
  last_crawled_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT radar_sources_kind_check CHECK (
    kind IN ('competitor_account', 'hashtag', 'ad_library_query', 'own_account')
  ),
  CONSTRAINT radar_sources_platform_check CHECK (
    platform IN ('instagram', 'tiktok', 'youtube', 'threads', 'facebook')
  ),
  CONSTRAINT radar_sources_interval_check CHECK (crawl_interval_hours BETWEEN 1 AND 168),
  CONSTRAINT radar_sources_uniq UNIQUE (project_id, platform, kind, handle)
);

COMMENT ON TABLE public.radar_sources IS
  'Источники радара: аккаунты конкурентов, хештеги, запросы Ad Library, собственные аккаунты.';

CREATE INDEX IF NOT EXISTS radar_sources_due_idx
  ON public.radar_sources (last_crawled_at NULLS FIRST)
  WHERE enabled;

ALTER TABLE public.radar_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS radar_sources_select ON public.radar_sources;
CREATE POLICY radar_sources_select ON public.radar_sources FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS radar_sources_insert ON public.radar_sources;
CREATE POLICY radar_sources_insert ON public.radar_sources FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS radar_sources_update ON public.radar_sources;
CREATE POLICY radar_sources_update ON public.radar_sources FOR UPDATE TO authenticated
  USING (public.user_can_access_project(project_id))
  WITH CHECK (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS radar_sources_delete ON public.radar_sources;
CREATE POLICY radar_sources_delete ON public.radar_sources FOR DELETE TO authenticated
  USING (public.user_can_access_project(project_id));

DROP TRIGGER IF EXISTS trg_radar_sources_updated ON public.radar_sources;
CREATE TRIGGER trg_radar_sources_updated
  BEFORE UPDATE ON public.radar_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. Публикации ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.radar_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.radar_sources(id) ON DELETE SET NULL,
  platform text NOT NULL,
  external_id text NOT NULL,
  url text,
  author_handle text,
  published_at timestamptz,
  media_type text,
  caption text,
  transcript text,
  video_url text,
  thumbnail_url text,
  -- likes / comments / shares / saves / views / followers на момент сбора.
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  followers integer,
  engagement_rate numeric,
  velocity numeric,
  score numeric,
  analysis jsonb,
  analysis_status text NOT NULL DEFAULT 'pending',
  analyzed_at timestamptz,
  error text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT radar_posts_platform_check CHECK (
    platform IN ('instagram', 'tiktok', 'youtube', 'threads', 'facebook')
  ),
  CONSTRAINT radar_posts_analysis_status_check CHECK (
    analysis_status IN ('pending', 'analyzing', 'done', 'failed', 'skipped')
  ),
  CONSTRAINT radar_posts_uniq UNIQUE (project_id, platform, external_id)
);

COMMENT ON TABLE public.radar_posts IS
  'Собранные публикации: метрики, транскрипт, разбор (hook / structure / triggers / score). Сырое — raw, TTL 90 дней.';
COMMENT ON COLUMN public.radar_posts.engagement_rate IS
  '(likes + comments + shares + saves) / followers на момент сбора.';
COMMENT ON COLUMN public.radar_posts.velocity IS
  'Взаимодействий в час с момента публикации — «скорость» поста.';

CREATE INDEX IF NOT EXISTS radar_posts_project_score_idx
  ON public.radar_posts (project_id, score DESC NULLS LAST, published_at DESC);
CREATE INDEX IF NOT EXISTS radar_posts_pending_idx
  ON public.radar_posts (created_at)
  WHERE analysis_status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS radar_posts_source_idx
  ON public.radar_posts (source_id, published_at DESC);

ALTER TABLE public.radar_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS radar_posts_select ON public.radar_posts;
CREATE POLICY radar_posts_select ON public.radar_posts FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP TRIGGER IF EXISTS trg_radar_posts_updated ON public.radar_posts;
CREATE TRIGGER trg_radar_posts_updated
  BEFORE UPDATE ON public.radar_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 3. Журнал сборов ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.radar_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.radar_sources(id) ON DELETE SET NULL,
  provider text NOT NULL,
  items integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS radar_runs_project_idx
  ON public.radar_runs (project_id, started_at DESC);

ALTER TABLE public.radar_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS radar_runs_select ON public.radar_runs;
CREATE POLICY radar_runs_select ON public.radar_runs FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

-- ── 4. Банк идей ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idea_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  hook text,
  angle text,
  niche text,
  script_draft text,
  structure jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_post_ids uuid[] NOT NULL DEFAULT '{}',
  score numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new',
  target_group_id uuid REFERENCES public.publish_account_groups(id) ON DELETE SET NULL,
  content_item_id uuid REFERENCES public.content_plan_items(id) ON DELETE SET NULL,
  outcome_score numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idea_bank_status_check CHECK (status IN ('new', 'approved', 'used', 'rejected'))
);

COMMENT ON TABLE public.idea_bank IS
  'Идеи радара: хук, угол, структура, оценка; «в контент-план» → content_plan_items; outcome_score заполняет аналитика.';

CREATE INDEX IF NOT EXISTS idea_bank_project_idx
  ON public.idea_bank (project_id, status, score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idea_bank_item_uidx
  ON public.idea_bank (content_item_id) WHERE content_item_id IS NOT NULL;

ALTER TABLE public.idea_bank ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idea_bank_select ON public.idea_bank;
CREATE POLICY idea_bank_select ON public.idea_bank FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
-- Пользователь меняет статус/группу/правит текст; создание и оценка — сервер.
DROP POLICY IF EXISTS idea_bank_update ON public.idea_bank;
CREATE POLICY idea_bank_update ON public.idea_bank FOR UPDATE TO authenticated
  USING (public.user_can_access_project(project_id))
  WITH CHECK (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS idea_bank_insert ON public.idea_bank;
CREATE POLICY idea_bank_insert ON public.idea_bank FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_project(project_id));

DROP TRIGGER IF EXISTS trg_idea_bank_updated ON public.idea_bank;
CREATE TRIGGER trg_idea_bank_updated
  BEFORE UPDATE ON public.idea_bank
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 5. Скоринг ──────────────────────────────────────────────
-- Оценка поста 0..100: engagement rate насыщается около 5 % (1 − e^(−er·60)),
-- скорость — около 200 взаимодействий/час; разбор модели (0..100) даёт
-- половину веса, когда он есть. Чистая функция — проверяется тестами.
CREATE OR REPLACE FUNCTION public.radar_post_score(
  p_engagement_rate numeric,
  p_velocity numeric,
  p_llm_score numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(
    CASE
      WHEN p_llm_score IS NULL THEN
        100 * (0.7 * (1 - exp(-coalesce(p_engagement_rate, 0) * 60))
             + 0.3 * (1 - exp(-coalesce(p_velocity, 0) / 200.0)))
      ELSE
        50 * (0.7 * (1 - exp(-coalesce(p_engagement_rate, 0) * 60))
            + 0.3 * (1 - exp(-coalesce(p_velocity, 0) / 200.0)))
        + 0.5 * least(greatest(p_llm_score, 0), 100)
    END, 1);
$$;

COMMENT ON FUNCTION public.radar_post_score(numeric, numeric, numeric) IS
  'Оценка поста 0..100 из engagement rate, скорости и оценки модели.';

-- Пересчёт метрик по одному посту (вызывается после ingest и analyze).
CREATE OR REPLACE FUNCTION public.radar_recompute_post(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.radar_posts%ROWTYPE;
  interactions numeric;
  hours numeric;
BEGIN
  SELECT * INTO r FROM public.radar_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RETURN; END IF;
  interactions :=
      coalesce((r.metrics->>'likes')::numeric, 0)
    + coalesce((r.metrics->>'comments')::numeric, 0)
    + coalesce((r.metrics->>'shares')::numeric, 0)
    + coalesce((r.metrics->>'saves')::numeric, 0);
  hours := greatest(extract(epoch FROM (coalesce(r.updated_at, now()) - coalesce(r.published_at, r.created_at))) / 3600.0, 1);
  UPDATE public.radar_posts
     SET engagement_rate = CASE WHEN coalesce(r.followers, 0) > 0 THEN interactions / r.followers ELSE NULL END,
         velocity = interactions / hours,
         score = public.radar_post_score(
           CASE WHEN coalesce(r.followers, 0) > 0 THEN interactions / r.followers ELSE NULL END,
           interactions / hours,
           (r.analysis->>'score')::numeric
         )
   WHERE id = p_post_id;
END;
$$;

-- Источники, которым пора собираться (для крона/n8n).
CREATE OR REPLACE FUNCTION public.radar_due_sources(p_limit integer DEFAULT 50)
RETURNS SETOF public.radar_sources
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.*
    FROM public.radar_sources s
   WHERE s.enabled
     AND (s.last_crawled_at IS NULL
          OR s.last_crawled_at < now() - make_interval(hours => s.crawl_interval_hours))
   ORDER BY s.last_crawled_at NULLS FIRST
   LIMIT greatest(p_limit, 1);
$$;

-- GC: сырые данные старше 90 дней и журнал сборов старше года.
CREATE OR REPLACE FUNCTION public.radar_gc()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.radar_posts SET raw = NULL
   WHERE raw IS NOT NULL AND created_at < now() - interval '90 days';
  DELETE FROM public.radar_runs WHERE started_at < now() - interval '365 days';
$$;

REVOKE ALL ON FUNCTION public.radar_recompute_post(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.radar_due_sources(integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.radar_gc() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.radar_recompute_post(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.radar_due_sources(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.radar_gc() TO service_role;
GRANT EXECUTE ON FUNCTION public.radar_post_score(numeric, numeric, numeric) TO authenticated, service_role;

-- ── 6. Витрина ──────────────────────────────────────────────
CREATE OR REPLACE VIEW public.radar_metrics
WITH (security_invoker = true)
AS
SELECT
  p.id AS project_id,
  (SELECT count(*) FROM public.radar_sources s WHERE s.project_id = p.id AND s.enabled) AS sources,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id
     AND r.created_at >= now() - interval '7 days') AS posts_7d,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id
     AND r.analysis_status IN ('pending', 'failed')) AS posts_unanalyzed,
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id AND i.status = 'new') AS ideas_new,
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id AND i.status = 'used') AS ideas_used,
  (SELECT coalesce(sum(cost_usd), 0) FROM public.radar_runs rr WHERE rr.project_id = p.id
     AND rr.started_at >= date_trunc('month', now())) AS spent_month_usd
FROM public.projects p;

GRANT SELECT ON public.radar_metrics TO authenticated;

-- ── 7. Крон: разбор и сбор ──────────────────────────────────
-- Каждые 15 минут edge-функция radar разбирает накопившиеся посты (Whisper +
-- LLM), помечает источники к сбору и пинает n8n-сборщик. Секретов в SQL нет.
SELECT cron.unschedule('radar-maintenance')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'radar-maintenance');

SELECT cron.schedule(
  'radar-maintenance',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/radar/maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('source', 'pg_cron')
  );
  $$
);
