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
