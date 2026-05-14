
-- 1) report_subscriptions: add created_by, scope policies to owner/admin
ALTER TABLE public.report_subscriptions
  ADD COLUMN IF NOT EXISTS created_by uuid;

DROP POLICY IF EXISTS "Anyone can create report subscriptions" ON public.report_subscriptions;
DROP POLICY IF EXISTS "Anyone can read report subscriptions"   ON public.report_subscriptions;
DROP POLICY IF EXISTS "Anyone can update report subscriptions" ON public.report_subscriptions;
DROP POLICY IF EXISTS "Anyone can delete report subscriptions" ON public.report_subscriptions;

CREATE POLICY rs_select_owner_admin ON public.report_subscriptions
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY rs_insert_authed ON public.report_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY rs_update_owner_admin ON public.report_subscriptions
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY rs_delete_owner_admin ON public.report_subscriptions
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 2) ad_cabinets: restrict SELECT to project owner or admin
DROP POLICY IF EXISTS ad_cabinets_select_authed ON public.ad_cabinets;

CREATE POLICY ad_cabinets_select_scoped ON public.ad_cabinets
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR created_by = auth.uid()
    OR project_id IN (SELECT id FROM public.projects WHERE created_by = auth.uid())
  );

-- 3) automation_settings: restrict SELECT to admin
DROP POLICY IF EXISTS automation_settings_select_authed ON public.automation_settings;

CREATE POLICY automation_settings_select_admin ON public.automation_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) projects: hide intake_token from non-owners.
-- Keep the table readable only for owners + admins; provide a sanitized view
-- for general listing.
DROP POLICY IF EXISTS projects_select_authed ON public.projects;

CREATE POLICY projects_select_owner_admin ON public.projects
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE VIEW public.projects_public
  WITH (security_invoker = true) AS
SELECT id, name, created_by, created_at, updated_at
FROM public.projects;

GRANT SELECT ON public.projects_public TO authenticated, anon;

-- 5) leads: drop the assigned_to IS NULL branch
DROP POLICY IF EXISTS leads_select_visible ON public.leads;
DROP POLICY IF EXISTS leads_update_visible ON public.leads;

CREATE POLICY leads_select_visible ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );

CREATE POLICY leads_update_visible ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );
