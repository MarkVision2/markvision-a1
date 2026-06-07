-- Manual apply on MarkVision Supabase (mekwfbqmsqiborjdrjxc) if CI deploy is unavailable.
-- Fixes: leads reappear after refresh because DELETE was blocked by RLS (admin-only).

-- Prefer full fix: scripts/fix-whatsapp-leads-visibility.sql (select/update/delete + comm).
-- This file kept for delete-only apply if you already ran an older visibility script.

DROP POLICY IF EXISTS leads_delete_visible ON public.leads;

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
