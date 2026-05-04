-- Tighten lead_status_history insert: must be insert by authenticated user for a visible lead
DROP POLICY IF EXISTS "lsh_insert_authed" ON public.lead_status_history;
CREATE POLICY "lsh_insert_via_lead" ON public.lead_status_history
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_status_history.lead_id
        AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.assigned_to IS NULL)
    )
  );

-- Tighten tasks insert
DROP POLICY IF EXISTS "tasks_insert_authed" ON public.tasks;
CREATE POLICY "tasks_insert_via_lead" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = tasks.lead_id
        AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.assigned_to IS NULL)
    )
  );

-- Tighten events insert
DROP POLICY IF EXISTS "events_insert_authed" ON public.events;
CREATE POLICY "events_insert_via_lead" ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (
    lead_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = events.lead_id
        AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.assigned_to IS NULL)
    )
  );

-- Revoke EXECUTE on SECURITY DEFINER functions from anon/public; keep authenticated
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_lead_stage_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_lead_created() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_communication_inserted() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_deal_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;