-- Прямая генерация статичного контента в Контент-заводе, без n8n.
--
-- Раньше «Создать дизайн» уходило вебхуком в n8n, а тот сам писал результат
-- в content_factory_results. Теперь заявка встаёт в очередь, а её разбирает
-- content-factory-worker: анализ входа → промпт ветки → стратегия слайдов →
-- генерация картинок в Gemini → Storage → results/gallery → Telegram.
--
-- Схема — тот же паттерн, что у capi_outbox и ad_launch_jobs: строка-задание,
-- лизинг через locked_at, attempts + next_attempt_at на ретраи, воркер
-- дёргается pg_cron по x-automation-key.
--
-- Детали — docs/CONTENT-FACTORY-DIRECT.md.

-- ============================================================
-- 1. Очередь генераций
-- ============================================================
CREATE TABLE IF NOT EXISTS public.content_factory_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Тот же request_id, что фронт слушает в content_factory_results.
  -- Один стиль = одно задание = один request_id.
  request_id text NOT NULL UNIQUE,
  session_id text,
  project_id uuid,
  created_by uuid,

  -- Тело заявки — ровно то, что мастер собирал для вебхука
  -- (src/lib/contentFactoryWebhook.ts, поле body).
  body jsonb NOT NULL,

  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'done', 'error', 'cancelled')),
  step text,

  -- Промежуточные результаты: анализ входа и стратегия слайдов.
  -- Хранятся, чтобы ретрай не платил за них второй раз.
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  strategy jsonb,
  -- Сколько кадров уже сгенерировано: повторный проход продолжает с этого места.
  slides_done integer NOT NULL DEFAULT 0,
  slides_total integer NOT NULL DEFAULT 0,

  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cf_jobs_pending
  ON public.content_factory_jobs (next_attempt_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_cf_jobs_stuck
  ON public.content_factory_jobs (locked_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_cf_jobs_project
  ON public.content_factory_jobs (project_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_content_factory_jobs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_content_factory_jobs ON public.content_factory_jobs;
CREATE TRIGGER trg_touch_content_factory_jobs
  BEFORE UPDATE ON public.content_factory_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_content_factory_jobs();

-- RLS: писать может только service_role (приёмник и воркер). Читать — автор
-- заявки: по request_id фронт и так получает результат через realtime
-- content_factory_results, а в body лежит бриф клиента.
ALTER TABLE public.content_factory_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cf_jobs_select_own ON public.content_factory_jobs;
CREATE POLICY cf_jobs_select_own ON public.content_factory_jobs
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

-- ============================================================
-- 1.1. Уникальность слайда в results
-- ============================================================
-- Приёмник заранее создаёт строки-заглушки, а воркер заменяет их готовыми
-- картинками — обе операции идут upsert-ом по (request_id, slide_index),
-- и без уникального индекса он невозможен. Индекс там был, но не уникальный.
-- Дубли, накопленные прежним контуром (n8n вставлял строки без дедупликации),
-- схлопываем, оставляя самую свежую запись слайда.
DELETE FROM public.content_factory_results a
USING public.content_factory_results b
WHERE a.request_id = b.request_id
  AND a.slide_index = b.slide_index
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_factory_results_slide
  ON public.content_factory_results (request_id, slide_index);

-- ============================================================
-- 2. Крон воркера
-- ============================================================
-- Как и в контуре запуска рекламы, крон здесь — страховка: приёмник дёргает
-- воркер сразу, а раз в минуту подбирается то, что упало или зависло.
SELECT cron.unschedule('content-factory-worker-1min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-factory-worker-1min');

SELECT cron.schedule(
  'content-factory-worker-1min',
  '* * * * *',
  $CRON$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/content-factory-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('source', 'cron', 'batch_size', 2)
  );
  $CRON$
);

-- ============================================================
-- 3. Автоочистка: короче срок хранения
-- ============================================================
-- Функция очистки объявлена в ручном наборе — migrations_client_config/009.
-- Тот набор накатывается руками, db push его не применяет, поэтому крон ниже
-- мог бы звать несуществующую функцию: расписание хранит текст команды и не
-- проверяет его при постановке, так что падало бы молча каждую ночь. Ровно
-- этим и опасна очистка: она не работает, а заметно это только по тому, что
-- контент копится. Повторяем объявление здесь, как 20260606160000 повторяет
-- таблицы галереи из 007 — авто-набор должен быть самодостаточным.
-- Тело обязано совпадать с 009_content_factory_cleanup.sql.
CREATE TABLE IF NOT EXISTS public.content_factory_cleanup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'sql',
  gallery_deleted int NOT NULL DEFAULT 0,
  results_deleted int NOT NULL DEFAULT 0,
  storage_deleted int NOT NULL DEFAULT 0,
  gallery_retention_days int NOT NULL,
  results_retention_days int NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cf_cleanup_log_ran_at
  ON public.content_factory_cleanup_log (ran_at DESC);

CREATE OR REPLACE FUNCTION public.cleanup_content_factory_data(
  p_gallery_days int DEFAULT 30,
  p_results_days int DEFAULT 14,
  p_write_log boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $CLEANUP$
DECLARE
  v_gallery_cutoff timestamptz;
  v_results_cutoff timestamptz;
  v_gallery_count int;
  v_results_count int;
  v_result jsonb;
BEGIN
  p_gallery_days := GREATEST(p_gallery_days, 7);
  p_results_days := GREATEST(p_results_days, 3);

  v_gallery_cutoff := now() - (p_gallery_days || ' days')::interval;
  v_results_cutoff := now() - (p_results_days || ' days')::interval;

  DELETE FROM public.content_factory_gallery
  WHERE created_at < v_gallery_cutoff;
  GET DIAGNOSTICS v_gallery_count = ROW_COUNT;

  DELETE FROM public.content_factory_results
  WHERE created_at < v_results_cutoff;
  GET DIAGNOSTICS v_results_count = ROW_COUNT;

  v_result := jsonb_build_object(
    'gallery_deleted', v_gallery_count,
    'results_deleted', v_results_count,
    'gallery_cutoff', v_gallery_cutoff,
    'results_cutoff', v_results_cutoff
  );

  IF p_write_log THEN
    INSERT INTO public.content_factory_cleanup_log (
      source,
      gallery_deleted,
      results_deleted,
      gallery_retention_days,
      results_retention_days,
      details
    ) VALUES (
      'sql',
      v_gallery_count,
      v_results_count,
      p_gallery_days,
      p_results_days,
      v_result
    );
  END IF;

  RETURN v_result;
END;
$CLEANUP$;

REVOKE ALL ON FUNCTION public.cleanup_content_factory_data(int, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_content_factory_data(int, int, boolean) TO service_role;

-- Пользователь просил, чтобы созданный контент не копился: держим галерею
-- неделю, а промежуточные results — трое суток. Меньше нельзя: функция
-- cleanup_content_factory_data сама поднимает значения до этих минимумов.
-- Расписание уже есть — .github/workflows/content-factory-cleanup.yml,
-- воскресенье 03:00 UTC. Здесь добавляем ещё и ежедневный прогон в БД,
-- чтобы очистка не зависела от GitHub Actions.
SELECT cron.unschedule('content-factory-cleanup-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-factory-cleanup-daily');

SELECT cron.schedule(
  'content-factory-cleanup-daily',
  '0 3 * * *',
  $CRON$
  SELECT public.cleanup_content_factory_data(7, 3, true);
  $CRON$
);

-- Задания старше недели тоже не нужны — они лишь след генерации.
CREATE OR REPLACE FUNCTION public.cleanup_content_factory_jobs(p_days int DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM public.content_factory_jobs
  WHERE created_at < now() - (GREATEST(p_days, 3) || ' days')::interval
    AND status IN ('done', 'error', 'cancelled');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

SELECT cron.unschedule('content-factory-jobs-cleanup-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-factory-jobs-cleanup-daily');

SELECT cron.schedule(
  'content-factory-jobs-cleanup-daily',
  '20 3 * * *',
  $CRON$
  SELECT public.cleanup_content_factory_jobs(7);
  $CRON$
);

-- Строки в БД чистит SQL выше, но сами файлы лежат в Storage, и удалить их
-- из SQL нельзя — этим занимается edge-функция content-factory-cleanup.
-- Раньше её дёргал только GitHub Actions по секрету CONTENT_FACTORY_CLEANUP_KEY;
-- секрет в репозитории не задан, поэтому все запуски падали на проверке, и
-- референсные фото копились с самого запуска контент-завода. Дёргаем её отсюда
-- тем же ключом, что и остальные кроны: у БД он есть всегда.
SELECT cron.unschedule('content-factory-storage-cleanup-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-factory-storage-cleanup-daily');

SELECT cron.schedule(
  'content-factory-storage-cleanup-daily',
  '40 3 * * *',
  $CRON$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/content-factory-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('gallery_days', 7, 'results_days', 3, 'uploads_days', 7)
  );
  $CRON$
);
