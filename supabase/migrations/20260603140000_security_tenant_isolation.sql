-- Tenant isolation: project briefs, pipelines, pipeline stages.

-- project_briefs: was SELECT true for all authenticated users
DROP POLICY IF EXISTS "project_briefs_select_authed" ON public.project_briefs;
DROP POLICY IF EXISTS project_briefs_select_authed ON public.project_briefs;

CREATE POLICY project_briefs_select_scoped ON public.project_briefs
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS "project_briefs_write_admin" ON public.project_briefs;
DROP POLICY IF EXISTS project_briefs_write_admin ON public.project_briefs;

CREATE POLICY project_briefs_insert_member ON public.project_briefs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_can_access_project(project_id)
    AND (created_by = auth.uid() OR created_by IS NULL)
  );

CREATE POLICY project_briefs_update_member ON public.project_briefs
  FOR UPDATE TO authenticated
  USING (public.user_can_access_project(project_id))
  WITH CHECK (public.user_can_access_project(project_id));

CREATE POLICY project_briefs_delete_owner_admin ON public.project_briefs
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND p.created_by = auth.uid()
    )
  );

-- pipelines: global default (project_id IS NULL) + own projects only
DROP POLICY IF EXISTS "pipelines_select_authed" ON public.pipelines;
DROP POLICY IF EXISTS pipelines_select_authed ON public.pipelines;

CREATE POLICY pipelines_select_scoped ON public.pipelines
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR project_id IS NULL
    OR public.user_can_access_project(project_id)
  );

-- pipeline_stages: via parent pipeline
DROP POLICY IF EXISTS "stages_select_authed" ON public.pipeline_stages;
DROP POLICY IF EXISTS stages_select_authed ON public.pipeline_stages;

CREATE POLICY stages_select_scoped ON public.pipeline_stages
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = pipeline_id
        AND (
          p.project_id IS NULL
          OR public.user_can_access_project(p.project_id)
        )
    )
  );
