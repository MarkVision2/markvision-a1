-- Manual apply on MarkVision Supabase (mekwfbqmsqiborjdrjxc) if CI deploy is unavailable.
-- Fixes: leads reappear after refresh because DELETE was blocked by RLS (admin-only).

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
