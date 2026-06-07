-- CRM: project members see ALL leads/chats of their project (not only assigned_to = self).
-- WhatsApp webhook sets created_by = owner; without this, other managers on the project stay blind.

DROP POLICY IF EXISTS leads_select_visible ON public.leads;
DROP POLICY IF EXISTS leads_update_visible ON public.leads;
DROP POLICY IF EXISTS leads_delete_visible ON public.leads;
DROP POLICY IF EXISTS comm_select_via_lead ON public.communications;

CREATE POLICY leads_select_visible ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
    )
    OR (
      project_id IS NULL
      AND (assigned_to = auth.uid() OR created_by = auth.uid())
    )
  );

CREATE POLICY leads_update_visible ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
    )
    OR (
      project_id IS NULL
      AND (assigned_to = auth.uid() OR created_by = auth.uid())
    )
  );

CREATE POLICY leads_delete_visible ON public.leads
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
    )
    OR (
      project_id IS NULL
      AND (assigned_to = auth.uid() OR created_by = auth.uid())
    )
  );

CREATE POLICY comm_select_via_lead ON public.communications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = communications.lead_id
        AND (
          public.has_role(auth.uid(), 'admin')
          OR (
            l.project_id IS NOT NULL
            AND public.user_can_access_project(l.project_id)
          )
          OR (
            l.project_id IS NULL
            AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid())
          )
        )
    )
  );
