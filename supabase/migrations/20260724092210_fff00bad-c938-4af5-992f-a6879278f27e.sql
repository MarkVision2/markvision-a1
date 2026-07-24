-- Add WITH CHECK clauses to UPDATE policies to prevent moving rows outside authorized scope

-- leads_update_visible
DROP POLICY IF EXISTS leads_update_visible ON public.leads;
CREATE POLICY leads_update_visible ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (project_id IS NOT NULL AND public.user_can_access_project(project_id))
    OR (project_id IS NULL AND (assigned_to = auth.uid() OR created_by = auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (project_id IS NOT NULL AND public.user_can_access_project(project_id))
    OR (project_id IS NULL AND (assigned_to = auth.uid() OR created_by = auth.uid()))
  );

-- comm_update_via_lead
DROP POLICY IF EXISTS comm_update_via_lead ON public.communications;
CREATE POLICY comm_update_via_lead ON public.communications
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = communications.lead_id
        AND (
          public.has_role(auth.uid(), 'admin')
          OR (l.project_id IS NOT NULL AND public.user_can_access_project(l.project_id))
          OR (l.project_id IS NULL AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid()))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = communications.lead_id
        AND (
          public.has_role(auth.uid(), 'admin')
          OR (l.project_id IS NOT NULL AND public.user_can_access_project(l.project_id))
          OR (l.project_id IS NULL AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid()))
        )
    )
  );

-- tasks_update_visible
DROP POLICY IF EXISTS tasks_update_visible ON public.tasks;
CREATE POLICY tasks_update_visible ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = tasks.lead_id AND l.assigned_to = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = tasks.lead_id AND l.assigned_to = auth.uid()
    )
  );