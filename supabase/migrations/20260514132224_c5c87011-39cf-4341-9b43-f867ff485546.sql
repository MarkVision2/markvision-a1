
-- Helper: is the current user a member/owner of a project
CREATE OR REPLACE FUNCTION public.user_can_access_project(_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _project_id IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = _project_id AND p.created_by = auth.uid()
    )
  )
$$;

-- 1) ad_cabinets.access_token — revoke column read for non-admins
REVOKE SELECT (access_token) ON public.ad_cabinets FROM authenticated, anon;

-- 2) projects.intake_token — revoke column read for non-admins
REVOKE SELECT (intake_token) ON public.projects FROM authenticated, anon;

-- 3) cabinet_daily_insights — scope by project
DROP POLICY IF EXISTS cdi_select_authed ON public.cabinet_daily_insights;
CREATE POLICY cdi_select_scoped ON public.cabinet_daily_insights
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

-- 4) finance_plans / revenue_plan / monthly_finance — scope by project
DROP POLICY IF EXISTS finance_plans_select_authed ON public.finance_plans;
CREATE POLICY finance_plans_select_scoped ON public.finance_plans
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS revenue_plan_select_authed ON public.revenue_plan;
CREATE POLICY revenue_plan_select_scoped ON public.revenue_plan
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS monthly_finance_select_authed ON public.monthly_finance;
CREATE POLICY monthly_finance_select_scoped ON public.monthly_finance
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

-- 5) Meta tables — scope by project
DROP POLICY IF EXISTS meta_campaigns_select_authed ON public.meta_campaigns;
CREATE POLICY meta_campaigns_select_scoped ON public.meta_campaigns
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS mcd_select_authed ON public.meta_campaign_daily;
CREATE POLICY mcd_select_scoped ON public.meta_campaign_daily
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS meta_creatives_select_authed ON public.meta_creatives;
CREATE POLICY meta_creatives_select_scoped ON public.meta_creatives
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS mcrd_select_authed ON public.meta_creative_daily;
CREATE POLICY mcrd_select_scoped ON public.meta_creative_daily
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS ad_campaigns_select_authed ON public.ad_campaigns;
CREATE POLICY ad_campaigns_select_scoped ON public.ad_campaigns
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS ig_codewords_select_authed ON public.instagram_codewords;
CREATE POLICY ig_codewords_select_scoped ON public.instagram_codewords
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS ig_events_select_authed ON public.instagram_organic_events;
CREATE POLICY ig_events_select_scoped ON public.instagram_organic_events
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

-- 6) leads-related: remove the "assigned_to IS NULL" loophole on dependent tables
DROP POLICY IF EXISTS comm_insert_authed ON public.communications;
CREATE POLICY comm_insert_authed ON public.communications
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = communications.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.created_by = auth.uid())
  ));

DROP POLICY IF EXISTS comm_select_via_lead ON public.communications;
CREATE POLICY comm_select_via_lead ON public.communications
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = communications.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.created_by = auth.uid())
  ));

DROP POLICY IF EXISTS deals_select_via_lead ON public.deals;
CREATE POLICY deals_select_via_lead ON public.deals
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = deals.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.created_by = auth.uid())
  ));

DROP POLICY IF EXISTS events_insert_via_lead ON public.events;
CREATE POLICY events_insert_via_lead ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (lead_id IS NULL OR EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = events.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.created_by = auth.uid())
  ));

DROP POLICY IF EXISTS events_select_via_lead ON public.events;
CREATE POLICY events_select_via_lead ON public.events
  FOR SELECT TO authenticated
  USING (lead_id IS NULL OR EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = events.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.created_by = auth.uid())
  ));

DROP POLICY IF EXISTS lsh_insert_via_lead ON public.lead_status_history;
CREATE POLICY lsh_insert_via_lead ON public.lead_status_history
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_status_history.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.created_by = auth.uid())
  ));

DROP POLICY IF EXISTS lsh_select_via_lead ON public.lead_status_history;
CREATE POLICY lsh_select_via_lead ON public.lead_status_history
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_status_history.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.created_by = auth.uid())
  ));

DROP POLICY IF EXISTS tasks_insert_via_lead ON public.tasks;
CREATE POLICY tasks_insert_via_lead ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = tasks.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.created_by = auth.uid())
  ));

DROP POLICY IF EXISTS tasks_select_visible ON public.tasks;
CREATE POLICY tasks_select_visible ON public.tasks
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = tasks.lead_id
        AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid())
    )
  );
