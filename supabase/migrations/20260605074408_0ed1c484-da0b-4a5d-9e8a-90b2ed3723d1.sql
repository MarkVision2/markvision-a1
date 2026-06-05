CREATE OR REPLACE FUNCTION public.is_project_member(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = _project_id AND user_id = _user_id
  )
$$;

DROP POLICY IF EXISTS projects_select_owner_admin ON public.projects;
CREATE POLICY projects_select_owner_admin ON public.projects
  FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR created_by = auth.uid()
    OR public.is_project_member(auth.uid(), id)
  );