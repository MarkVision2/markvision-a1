DROP POLICY IF EXISTS pipelines_select_authed ON public.pipelines;
CREATE POLICY pipelines_select_member ON public.pipelines
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS stages_select_authed ON public.pipeline_stages;
CREATE POLICY stages_select_member ON public.pipeline_stages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pipelines p
    WHERE p.id = pipeline_stages.pipeline_id
      AND public.user_can_access_project(p.project_id)
  ));

DROP POLICY IF EXISTS project_briefs_select_authed ON public.project_briefs;
CREATE POLICY project_briefs_select_member ON public.project_briefs
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));