-- Clony: привязка results к проекту MarkVision для галереи «Готовый контент»
-- n8n при INSERT в content_factory_results должен писать project_id из body.project_id
-- Формат request_id: {projectId}:{batchId}:{styleId}

ALTER TABLE public.content_factory_results
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS type_id text,
  ADD COLUMN IF NOT EXISTS type_title text;

-- Backfill только для трёхчастного формата (не путать batchId старого формата с project_id)
UPDATE public.content_factory_results
SET project_id = (split_part(request_id, ':', 1))::uuid
WHERE project_id IS NULL
  AND request_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:';

CREATE INDEX IF NOT EXISTS idx_cf_results_project_ready
  ON public.content_factory_results (project_id, created_at DESC)
  WHERE status = 'ready' AND image_url IS NOT NULL;

COMMENT ON COLUMN public.content_factory_results.project_id IS
  'UUID проекта MarkVision из webhook body.project_id или префикса request_id';
