
-- Fix: leads_insert must scope project_id to accessible projects
DROP POLICY IF EXISTS leads_insert_authed ON public.leads;
CREATE POLICY leads_insert_authed ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    (created_by = auth.uid())
    AND ((assigned_to IS NULL) OR (assigned_to = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR (project_id IS NULL)
      OR user_can_access_project(project_id)
    )
  );

-- Fix: whatsapp_config raw token columns readable only by admin/service_role.
-- Regular owners read the token-free public.whatsapp_config_safe view.
DROP POLICY IF EXISTS wa_select ON public.whatsapp_config;
CREATE POLICY wa_select ON public.whatsapp_config
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
