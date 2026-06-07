-- sipuni_cdr_log: require explicit project context on the resolved lead.
-- Historical policy allowed orphan leads (project_id IS NULL) without tenant checks.
-- which exposed phone numbers, recording URLs, and raw payloads for orphan leads.

DROP POLICY IF EXISTS sipuni_cdr_log_select_via_lead ON public.sipuni_cdr_log;

CREATE POLICY sipuni_cdr_log_select_via_lead ON public.sipuni_cdr_log
  FOR SELECT TO authenticated
  USING (
    lead_id_resolved IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = sipuni_cdr_log.lead_id_resolved
        AND l.project_id IS NOT NULL
        AND public.user_can_access_project(l.project_id)
        AND (
          public.has_role(auth.uid(), 'admin')
          OR l.assigned_to = auth.uid()
          OR l.created_by = auth.uid()
        )
    )
  );
