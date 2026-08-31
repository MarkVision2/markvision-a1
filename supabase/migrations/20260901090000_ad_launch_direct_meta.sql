-- Прямой запуск рекламы в Meta без n8n: очередь заданий, кэш справочников
-- таргетинга, расписания авто-запуска и bucket для медиа креативов.
--
-- Проектное решение — docs/AD-LAUNCH-DIRECT-META.md.
--
-- Схема повторяет уже работающий в проекте паттерн capi_outbox + capi-outbox-worker:
-- строка-задание, лизинг через locked_at, attempts + next_attempt_at на ретраи,
-- воркер дёргается pg_cron по x-automation-key.

-- ============================================================
-- 1. Очередь запусков
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ad_launch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Тот же launch_id, что и в ad_campaigns.launch_id — связывает задание,
  -- запись кампании и статус в UI.
  launch_id uuid NOT NULL UNIQUE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  cabinet_id uuid REFERENCES public.ad_cabinets(id) ON DELETE CASCADE,
  created_by uuid,
  -- manual — мастер запуска; schedule — авто-запуск по расписанию кабинета;
  -- content_factory — «Запустить рекламу» из галереи Контент-завода.
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'schedule', 'content_factory')),
  -- Нормализованный вход: цель, бюджет, тексты, таргетинг, ссылки на медиа.
  -- Форма — LaunchSpec из supabase/functions/_lib/adLaunchSpec.ts.
  spec jsonb NOT NULL,

  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'waiting_media', 'done', 'error', 'cancelled')),
  -- Шаг конечного автомата, он же status_step в ad_campaigns.
  step text,

  -- Прогресс: как только объект создан в Meta, его id фиксируется здесь.
  -- Это и есть механизм идемпотентности — повторный проход шаг пропускает.
  meta_image_hashes text[] NOT NULL DEFAULT '{}',
  meta_video_id text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_creative_id text,
  meta_ad_id text,

  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  -- Лизинг: строка взята воркером. Задания, зависшие в processing дольше
  -- 10 минут, крон возвращает в queued.
  locked_at timestamptz,
  last_error text,
  -- Код ошибки Meta (190 — токен, 4/17/613 — throttle, 100 — битые параметры).
  error_code integer,

  -- Ключ дедупликации для автоматических источников. Планировщик кладёт сюда
  -- 'sched:<schedule_id>:<YYYY-MM-DD>' или 'cab:<cabinet_id>:<YYYY-MM-DD>:<hour>',
  -- поэтому повторный проход крона в тот же час не создаёт второй запуск.
  -- Для ручных запусков NULL — их можно делать сколько угодно.
  dedupe_key text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Основная выборка воркера.
CREATE INDEX IF NOT EXISTS idx_ad_launch_jobs_pending
  ON public.ad_launch_jobs (next_attempt_at)
  WHERE status IN ('queued', 'waiting_media');

CREATE INDEX IF NOT EXISTS idx_ad_launch_jobs_stuck
  ON public.ad_launch_jobs (locked_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_ad_launch_jobs_project
  ON public.ad_launch_jobs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_launch_jobs_cabinet
  ON public.ad_launch_jobs (cabinet_id, created_at DESC);

-- Защита от дублей авто-запуска: повторный проход планировщика в тот же
-- час натыкается на конфликт вместо создания второй кампании.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_launch_jobs_dedupe
  ON public.ad_launch_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_ad_launch_jobs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_ad_launch_jobs ON public.ad_launch_jobs;
CREATE TRIGGER trg_touch_ad_launch_jobs
  BEFORE UPDATE ON public.ad_launch_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_ad_launch_jobs();

-- RLS: читать может тот, у кого есть доступ к проекту; писать — только
-- service_role (воркер и enqueue-функция ходят сервисным ключом).
-- В spec лежит бюджет и тексты, но НЕ токен — токен резолвится воркером
-- из ad_cabinets/meta_tokens в момент выполнения.
ALTER TABLE public.ad_launch_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_launch_jobs_select_scoped ON public.ad_launch_jobs;
CREATE POLICY ad_launch_jobs_select_scoped ON public.ad_launch_jobs
  FOR SELECT TO authenticated
  USING (project_id IS NULL OR public.user_can_access_project(project_id));

-- ============================================================
-- 2. Кэш справочников таргетинга Meta
-- ============================================================
-- Без кэша каждый запуск тратит 2-5 вызовов Graph /search на резолв городов
-- и интересов — это прямая дорога в throttle при пакетном авто-запуске.
CREATE TABLE IF NOT EXISTS public.meta_targeting_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- adgeolocation | adinterest | adlocale
  kind text NOT NULL,
  -- Нормализованный (lower/trim) запрос.
  query text NOT NULL,
  -- Код страны для adgeolocation ('KZ'); для интересов и языков — пустая
  -- строка, а НЕ NULL: в UNIQUE-индексе Postgres считает NULL-ы различными,
  -- поэтому с NULL кэш дублировался бы, а upsert не находил бы строку.
  country text NOT NULL DEFAULT '',
  -- Нормализованный ответ Graph /search.
  result jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, query, country)
);

CREATE INDEX IF NOT EXISTS idx_meta_targeting_cache_fetched
  ON public.meta_targeting_cache (fetched_at);

ALTER TABLE public.meta_targeting_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_targeting_cache_select ON public.meta_targeting_cache;
CREATE POLICY meta_targeting_cache_select ON public.meta_targeting_cache
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 3. Расписания авто-запуска
-- ============================================================
-- Базовый режим авто-запуска берётся прямо из ad_cabinets
-- (auto_launch_enabled / launch_hour / days_of_week / timezone).
-- Эта таблица — для случаев, когда на один кабинет нужно несколько
-- разных регулярных запусков.
CREATE TABLE IF NOT EXISTS public.ad_launch_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  cabinet_id uuid NOT NULL REFERENCES public.ad_cabinets(id) ON DELETE CASCADE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- Час запуска в таймзоне кабинета и дни недели (ISO: 1 = понедельник).
  launch_hour integer NOT NULL DEFAULT 9 CHECK (launch_hour BETWEEN 0 AND 23),
  days_of_week integer[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7],
  -- Шаблон запуска — та же форма, что ad_launch_jobs.spec.
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- spec — креатив зашит в шаблоне; content_factory_gallery — берём свежий
  -- креатив из галереи Контент-завода по project_id.
  creative_source text NOT NULL DEFAULT 'spec'
    CHECK (creative_source IN ('spec', 'content_factory_gallery')),
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_launch_schedules_enabled
  ON public.ad_launch_schedules (cabinet_id)
  WHERE enabled = true;

DROP TRIGGER IF EXISTS trg_touch_ad_launch_schedules ON public.ad_launch_schedules;
CREATE TRIGGER trg_touch_ad_launch_schedules
  BEFORE UPDATE ON public.ad_launch_schedules
  FOR EACH ROW EXECUTE FUNCTION public.touch_ad_launch_jobs();

ALTER TABLE public.ad_launch_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_launch_schedules_select_scoped ON public.ad_launch_schedules;
CREATE POLICY ad_launch_schedules_select_scoped ON public.ad_launch_schedules
  FOR SELECT TO authenticated
  USING (project_id IS NULL OR public.user_can_access_project(project_id));

DROP POLICY IF EXISTS ad_launch_schedules_write_admin ON public.ad_launch_schedules;
CREATE POLICY ad_launch_schedules_write_admin ON public.ad_launch_schedules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 4. Bucket для медиа креативов
-- ============================================================
-- Файлы из мастера запуска складываются сюда, а воркер уже отдаёт их в Meta.
-- Так ретрай не теряет байты (при прямой загрузке из multipart повторить
-- шаг было бы нечем), и видео можно отдать Meta по file_url.
-- Публичный: /advideos скачивает ролик по ссылке сам, подписанные URL
-- Meta не принимает стабильно.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ad-launch-media',
  'ad-launch-media',
  true,
  314572800, -- 300 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "ad-launch-media public read" ON storage.objects;
CREATE POLICY "ad-launch-media public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'ad-launch-media');

DROP POLICY IF EXISTS "ad-launch-media authed insert" ON storage.objects;
CREATE POLICY "ad-launch-media authed insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'ad-launch-media');

-- ============================================================
-- 5. Realtime: статус запуска стримится в UI
-- ============================================================
-- Фронт подписывается на ad_campaigns по launch_id и видит шаги запуска
-- без опроса — так же, как Контент-завод слушает content_factory_results.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_campaigns;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_launch_jobs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 6. Фиксация колонок meta_creatives, добавленных мимо миграций
-- ============================================================
-- meta-creative-upsert пишет landing_url/description/format/destination/
-- objective/thumbnail/updated_at, но в миграциях этих колонок нет — их
-- добавляли прямо в дашборде. На живой базе IF NOT EXISTS ничего не изменит,
-- а на чистой (локальная разработка, восстановление) прямой контур запуска
-- перестанет падать на шаге сохранения креатива.
ALTER TABLE public.meta_creatives
  ADD COLUMN IF NOT EXISTS landing_url text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS format text,
  ADD COLUMN IF NOT EXISTS destination text,
  ADD COLUMN IF NOT EXISTS objective text,
  ADD COLUMN IF NOT EXISTS thumbnail text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ============================================================
-- 7. Здоровье токенов Meta по кабинетам
-- ============================================================
-- Заполняет meta-token-health раз в сутки. Нужно, чтобы протухающий токен
-- было видно заранее, а не по факту упавшего запуска (Graph code 190).
ALTER TABLE public.ad_cabinets
  ADD COLUMN IF NOT EXISTS token_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS token_valid boolean;
