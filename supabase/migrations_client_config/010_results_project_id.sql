-- Clony: привязка results к проекту MarkVision для галереи «Готовый контент»
-- n8n при INSERT в content_factory_results должен писать project_id из body.project_id

ALTER TABLE public.content_factory_results
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS type_id text,
  ADD COLUMN IF NOT EXISTS type_title text;

CREATE INDEX IF NOT EXISTS idx_cf_results_project_ready
  ON public.content_factory_results (project_id, created_at DESC)
  WHERE status = 'ready' AND image_url IS NOT NULL;

COMMENT ON COLUMN public.content_factory_results.project_id IS
  'UUID проекта MarkVision из webhook body.project_id';
