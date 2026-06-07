-- Allow project members to DELETE leads they can already see/update.
-- Without this, delete succeeds in UI (optimistic) but RLS silently deletes 0 rows.

DROP POLICY IF EXISTS leads_delete_visible ON public.leads;

CREATE POLICY leads_delete_visible ON public.leads
  FOR DELETE TO authenticated
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
