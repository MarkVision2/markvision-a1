-- Tombstones для «Готовый контент»: удаление должно переживать reload,
-- даже если запись ещё лежит в content_factory_results (источник n8n).

CREATE TABLE IF NOT EXISTS public.content_factory_gallery_hidden (
  project_id uuid NOT NULL,
  request_id text NOT NULL,
  slide_index integer NOT NULL DEFAULT 0,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  hidden_by uuid NULL,
  PRIMARY KEY (project_id, request_id, slide_index)
);

CREATE INDEX IF NOT EXISTS idx_cfgallery_hidden_project
  ON public.content_factory_gallery_hidden (project_id, hidden_at DESC);

ALTER TABLE public.content_factory_gallery_hidden ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfgallery_hidden_select ON public.content_factory_gallery_hidden;
CREATE POLICY cfgallery_hidden_select ON public.content_factory_gallery_hidden
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR user_can_access_project(project_id));

DROP POLICY IF EXISTS cfgallery_hidden_insert ON public.content_factory_gallery_hidden;
CREATE POLICY cfgallery_hidden_insert ON public.content_factory_gallery_hidden
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR user_can_access_project(project_id));

DROP POLICY IF EXISTS cfgallery_hidden_update ON public.content_factory_gallery_hidden;
CREATE POLICY cfgallery_hidden_update ON public.content_factory_gallery_hidden
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR user_can_access_project(project_id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR user_can_access_project(project_id));

DROP POLICY IF EXISTS cfgallery_hidden_delete ON public.content_factory_gallery_hidden;
CREATE POLICY cfgallery_hidden_delete ON public.content_factory_gallery_hidden
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR user_can_access_project(project_id));

COMMENT ON TABLE public.content_factory_gallery_hidden IS
  'Удалённые из галереи креативы: load() не показывает их из content_factory_results';
