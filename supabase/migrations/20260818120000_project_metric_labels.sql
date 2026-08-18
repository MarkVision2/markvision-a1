-- Переопределение названий столбцов «Таблицы показателей» под каждый проект.
-- Ключ столбца стабилен (см. src/lib/metricColumns.ts), меняется только видимое название.

CREATE TABLE IF NOT EXISTS public.project_metric_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  column_key text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_project_metric_labels_project
  ON public.project_metric_labels(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_metric_labels TO authenticated;
GRANT ALL ON public.project_metric_labels TO service_role;

ALTER TABLE public.project_metric_labels ENABLE ROW LEVEL SECURITY;

-- Видеть переименования могут все участники проекта; менять — только админ проекта.
DROP POLICY IF EXISTS pml_select ON public.project_metric_labels;
CREATE POLICY pml_select ON public.project_metric_labels
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS pml_write_admin ON public.project_metric_labels;
CREATE POLICY pml_write_admin ON public.project_metric_labels
  FOR ALL TO authenticated
  USING (public.user_can_access_project(project_id) AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.user_can_access_project(project_id) AND public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_project_metric_labels_updated ON public.project_metric_labels;
CREATE TRIGGER trg_project_metric_labels_updated
  BEFORE UPDATE ON public.project_metric_labels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
