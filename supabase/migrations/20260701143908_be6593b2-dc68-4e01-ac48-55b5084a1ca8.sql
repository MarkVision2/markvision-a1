DROP POLICY IF EXISTS projects_delete_admin ON public.projects;
CREATE POLICY projects_delete_owner_admin ON public.projects
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));