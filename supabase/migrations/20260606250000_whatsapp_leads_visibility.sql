-- WhatsApp / intake leads: visible to all members of the project, not only assignee/creator.
-- greenapi-webhook creates leads without assigned_to/created_by — old RLS hid them from CRM UI.

DROP POLICY IF EXISTS leads_select_visible ON public.leads;
DROP POLICY IF EXISTS leads_update_visible ON public.leads;

CREATE POLICY leads_select_visible ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
      AND (
        assigned_to = auth.uid()
        OR created_by = auth.uid()
        OR (assigned_to IS NULL AND created_by IS NULL)
      )
    )
  );

CREATE POLICY leads_update_visible ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
      AND (
        assigned_to = auth.uid()
        OR created_by = auth.uid()
        OR (assigned_to IS NULL AND created_by IS NULL)
      )
    )
  );

DROP POLICY IF EXISTS comm_select_via_lead ON public.communications;

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
            AND (
              l.assigned_to = auth.uid()
              OR l.created_by = auth.uid()
              OR (l.assigned_to IS NULL AND l.created_by IS NULL)
            )
          )
        )
    )
  );
