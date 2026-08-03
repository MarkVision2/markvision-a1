-- Allow project members (not only platform admin) to create/update/delete
-- ad cabinets for their projects. Previously only ad_cabinets_write_admin
-- existed, so owners saw "cabinet added" failures / empty Supabase rows.
-- access_token stays unreadable for authenticated (column REVOKE).

-- 1) SELECT on base table for project access (secrets still column-revoked)
DROP POLICY IF EXISTS ad_cabinets_select_project ON public.ad_cabinets;
CREATE POLICY ad_cabinets_select_project ON public.ad_cabinets
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR created_by = auth.uid()
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
    )
  );

-- 2) INSERT / UPDATE / DELETE for project members
DROP POLICY IF EXISTS ad_cabinets_insert_project ON public.ad_cabinets;
CREATE POLICY ad_cabinets_insert_project ON public.ad_cabinets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
      AND (created_by IS NULL OR created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS ad_cabinets_update_project ON public.ad_cabinets;
CREATE POLICY ad_cabinets_update_project ON public.ad_cabinets
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR created_by = auth.uid()
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
    )
  );

DROP POLICY IF EXISTS ad_cabinets_delete_project ON public.ad_cabinets;
CREATE POLICY ad_cabinets_delete_project ON public.ad_cabinets
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR created_by = auth.uid()
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
    )
  );

-- 3) Safe view: include project members (not only project.created_by)
DROP VIEW IF EXISTS public.ad_cabinets_safe;
CREATE VIEW public.ad_cabinets_safe
WITH (security_invoker = false)
AS
SELECT
  id, project_id, created_by, created_at, updated_at,
  name, external_id, online, type, provider,
  currency, daily_budget, spend, leads, lead_cost, sales, revenue,
  city,
  ad_account_id,
  page_id,
  page_name,
  instagram_id,
  telegram_group_id,
  whatsapp_number,
  pixel_id,
  pixel_event,
  website_url,
  landing_url,
  utm_template,
  brief,
  campaign_objective, optimization_goal, lead_form_id,
  start_time, end_time, days_of_week, timezone,
  auto_launch_enabled, launch_hour,
  target_geo, target_age_min, target_age_max, target_gender,
  target_languages, target_interests, target_exclusions,
  creative_headline, creative_primary_text, creative_description, creative_cta,
  creative_media_urls
FROM public.ad_cabinets
WHERE
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR created_by = auth.uid()
  OR (
    project_id IS NOT NULL
    AND public.user_can_access_project(project_id)
  );

REVOKE ALL ON public.ad_cabinets_safe FROM PUBLIC, anon;
GRANT SELECT ON public.ad_cabinets_safe TO authenticated;

-- 4) meta_tokens: project members can insert/update tokens for their project
--    (OAuth + Ads UI need to store a fresh user token; was admin-only write)
DROP POLICY IF EXISTS meta_tokens_write_admin ON public.meta_tokens;
DROP POLICY IF EXISTS meta_tokens_write_project ON public.meta_tokens;
CREATE POLICY meta_tokens_write_project ON public.meta_tokens
  FOR ALL TO authenticated
  USING (public.user_can_access_project(project_id))
  WITH CHECK (public.user_can_access_project(project_id));
