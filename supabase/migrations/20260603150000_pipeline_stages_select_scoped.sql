-- Restrict pipeline_stages reads to users who can access the owning project.
DROP POLICY IF EXISTS "stages_select_authed" ON public.pipeline_stages;

CREATE POLICY "stages_select_authed"
  ON public.pipeline_stages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.pipelines p
      WHERE p.id = pipeline_stages.pipeline_id
        AND public.user_can_access_project(p.project_id)
    )
  );
