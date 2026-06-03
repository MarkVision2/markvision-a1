-- Restrict pipelines reads to users who can access the owning project.
DROP POLICY IF EXISTS "pipelines_select_authed" ON public.pipelines;

CREATE POLICY "pipelines_select_authed"
  ON public.pipelines
  FOR SELECT
  TO authenticated
  USING (public.user_can_access_project(project_id));
