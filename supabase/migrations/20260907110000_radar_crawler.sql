-- Радар идей: прямой сборщик через Apify внутри edge-функции radar.
--
-- Раньше сбор постов жил только в n8n («Radar · сборщик v2»), которого в
-- боевом n8n нет. Теперь edge-функция сама запускает актор Apify
-- (асинхронно) и дособирает результат при обновлении обзора и по крону
-- radar-maintenance. Для этого журналу сборов нужен статус и id запуска.

ALTER TABLE public.radar_runs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'done',
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'crawl',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS actor text,
  ADD COLUMN IF NOT EXISTS url text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE public.radar_runs DROP CONSTRAINT IF EXISTS radar_runs_status_check;
ALTER TABLE public.radar_runs
  ADD CONSTRAINT radar_runs_status_check CHECK (status IN ('running', 'done', 'failed'));
ALTER TABLE public.radar_runs DROP CONSTRAINT IF EXISTS radar_runs_mode_check;
ALTER TABLE public.radar_runs
  ADD CONSTRAINT radar_runs_mode_check CHECK (mode IN ('crawl', 'url'));

COMMENT ON COLUMN public.radar_runs.status IS
  'running — актор Apify ещё работает; done — результат загружен; failed — ошибка (текст в error).';
COMMENT ON COLUMN public.radar_runs.mode IS 'crawl — сбор источника; url — разбор одной ссылки.';
COMMENT ON COLUMN public.radar_runs.external_id IS 'ID запуска у провайдера (Apify run id).';

CREATE INDEX IF NOT EXISTS radar_runs_running_idx
  ON public.radar_runs (started_at)
  WHERE status = 'running';

-- Старые записи журнала (n8n) завершены по определению.
UPDATE public.radar_runs SET status = CASE WHEN error IS NULL THEN 'done' ELSE 'failed' END
 WHERE finished_at IS NOT NULL AND status = 'done' AND error IS NOT NULL;
