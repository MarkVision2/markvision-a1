-- Restrict project_briefs reads to project members (was USING (true) for all authenticated users).
DROP POLICY IF EXISTS "project_briefs_select_authed" ON public.project_briefs;

CREATE POLICY "project_briefs_select_authed"
  ON public.project_briefs
  FOR SELECT
  TO authenticated
  USING (public.user_can_access_project(project_id));
