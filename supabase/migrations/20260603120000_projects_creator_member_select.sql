-- Auto-add project creator as owner; allow members to list their projects.

CREATE OR REPLACE FUNCTION public.ensure_project_creator_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.project_members (project_id, user_id, role)
    VALUES (NEW.id, NEW.created_by, 'owner')
    ON CONFLICT (project_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_creator_member ON public.projects;
CREATE TRIGGER trg_projects_creator_member
AFTER INSERT ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.ensure_project_creator_member();

DROP POLICY IF EXISTS projects_select_owner_admin ON public.projects;
CREATE POLICY projects_select_owner_admin ON public.projects
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id = projects.id AND m.user_id = auth.uid()
    )
  );
