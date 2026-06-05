
-- 1) Drop overly broad CRM module-access policies. Keep scoped *_visible / *_via_lead policies.
DROP POLICY IF EXISTS leads_select ON public.leads;
DROP POLICY IF EXISTS leads_insert ON public.leads;
DROP POLICY IF EXISTS leads_update ON public.leads;
DROP POLICY IF EXISTS leads_delete ON public.leads;

DROP POLICY IF EXISTS communications_select ON public.communications;
DROP POLICY IF EXISTS communications_insert ON public.communications;
DROP POLICY IF EXISTS communications_update ON public.communications;
DROP POLICY IF EXISTS communications_delete ON public.communications;

DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
DROP POLICY IF EXISTS tasks_delete ON public.tasks;

DROP POLICY IF EXISTS deals_select ON public.deals;
DROP POLICY IF EXISTS deals_insert ON public.deals;
DROP POLICY IF EXISTS deals_update ON public.deals;
DROP POLICY IF EXISTS deals_delete ON public.deals;

-- 2) Instagram accounts: restrict SELECT (page_access_token column) to admin/owner.
DROP POLICY IF EXISTS ig_accounts_select ON public.instagram_accounts;
CREATE POLICY ig_accounts_select ON public.instagram_accounts
  FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = instagram_accounts.project_id AND p.created_by = auth.uid()
    )
  );

-- 3) phone_attribution / wa_clicks: drop NULL project_id leak branch.
DROP POLICY IF EXISTS phone_attr_select ON public.phone_attribution;
CREATE POLICY phone_attr_select ON public.phone_attribution
  FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (project_id IS NOT NULL AND user_can_access_project(project_id))
  );

DROP POLICY IF EXISTS wa_clicks_select ON public.wa_clicks;
CREATE POLICY wa_clicks_select ON public.wa_clicks
  FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (project_id IS NOT NULL AND user_can_access_project(project_id))
  );

-- 4) Extend projects SELECT to include project members.
DROP POLICY IF EXISTS projects_select_owner_admin ON public.projects;
CREATE POLICY projects_select_owner_admin ON public.projects
  FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id = projects.id AND m.user_id = auth.uid()
    )
  );
