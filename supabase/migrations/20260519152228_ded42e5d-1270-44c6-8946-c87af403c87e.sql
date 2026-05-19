DROP VIEW IF EXISTS public.ad_cabinets_safe;
CREATE VIEW public.ad_cabinets_safe WITH (security_invoker = true) AS
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
  has_role(auth.uid(), 'admin'::app_role)
  OR created_by = auth.uid()
  OR project_id IN (SELECT p.id FROM public.projects p WHERE p.created_by = auth.uid());

GRANT SELECT ON public.ad_cabinets_safe TO authenticated;