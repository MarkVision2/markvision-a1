
-- 1) Recreate meta_creative_crm_daily with security_invoker=true
DROP VIEW IF EXISTS public.meta_creative_crm_daily;
CREATE VIEW public.meta_creative_crm_daily WITH (security_invoker=true) AS
WITH lead_days AS (
  SELECT l.meta_ad_id AS ad_id,
    l.project_id,
    ((l.created_at AT TIME ZONE 'Asia/Almaty'::text))::date AS date,
    (count(*))::integer AS crm_leads,
    (count(*) FILTER (WHERE (EXISTS ( SELECT 1
      FROM public.pipeline_stages ps
      WHERE ((ps.id = l.stage_id) AND (ps.is_diagnostic = true))))))::integer AS crm_qualified
  FROM public.leads l
  WHERE (l.meta_ad_id IS NOT NULL)
  GROUP BY l.meta_ad_id, l.project_id, (((l.created_at AT TIME ZONE 'Asia/Almaty'::text))::date)
), sale_rows AS (
  SELECT l.meta_ad_id AS ad_id,
    l.project_id,
    ((COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'Asia/Almaty'::text))::date AS date,
    1 AS crm_sales,
    COALESCE(d.amount, (0)::numeric) AS crm_revenue
  FROM (public.deals d JOIN public.leads l ON ((l.id = d.lead_id)))
  WHERE ((d.status = 'paid'::deal_status) AND (l.meta_ad_id IS NOT NULL))
  UNION ALL
  SELECT l.meta_ad_id,
    l.project_id,
    ((COALESCE(l.paid_at, l.updated_at) AT TIME ZONE 'Asia/Almaty'::text))::date,
    1,
    COALESCE(l.amount, (0)::numeric)
  FROM public.leads l
  WHERE ((l.paid = true) AND (l.meta_ad_id IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
    FROM public.deals d2
    WHERE ((d2.lead_id = l.id) AND (d2.status = 'paid'::deal_status))))))
), sale_days AS (
  SELECT sale_rows.ad_id, sale_rows.project_id, sale_rows.date,
    (sum(sale_rows.crm_sales))::integer AS crm_sales,
    sum(sale_rows.crm_revenue) AS crm_revenue
  FROM sale_rows
  GROUP BY sale_rows.ad_id, sale_rows.project_id, sale_rows.date
)
SELECT COALESCE(ld.ad_id, sd.ad_id) AS ad_id,
  COALESCE(ld.project_id, sd.project_id) AS project_id,
  COALESCE(ld.date, sd.date) AS date,
  COALESCE(ld.crm_leads, 0) AS crm_leads,
  COALESCE(ld.crm_qualified, 0) AS crm_qualified,
  COALESCE(sd.crm_sales, 0) AS crm_sales,
  COALESCE(sd.crm_revenue, (0)::numeric) AS crm_revenue
FROM (lead_days ld FULL JOIN sale_days sd ON
  (((ld.ad_id = sd.ad_id) AND (NOT (ld.project_id IS DISTINCT FROM sd.project_id)) AND (ld.date = sd.date))));

GRANT SELECT ON public.meta_creative_crm_daily TO authenticated, anon;

-- 2) Hide sensitive token columns from client-facing roles
REVOKE SELECT (access_token) ON public.ad_cabinets FROM authenticated, anon;
REVOKE SELECT (meta_access_token, sipuni_token, cron_secret) ON public.automation_settings FROM authenticated, anon;

-- 3) Revoke EXECUTE on SECURITY DEFINER functions from anon/PUBLIC
REVOKE EXECUTE ON FUNCTION public.get_creative_funnel(text, date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_meta_ids_from_utm() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_can_access_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_creative_funnel(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_project(uuid) TO authenticated;

-- 4) Storage: lock down creative-posters bucket
DROP POLICY IF EXISTS "Creative posters are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Authed can upload creative posters" ON storage.objects;
DROP POLICY IF EXISTS "Authed can update creative posters" ON storage.objects;

-- Bucket is public=true so files remain CDN-readable via direct URL.
-- Writes restricted to admins; uploads from the app go through the service-role edge function.
CREATE POLICY "Admins can upload creative posters"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'creative-posters' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update creative posters"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'creative-posters' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'creative-posters' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete creative posters"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'creative-posters' AND public.has_role(auth.uid(), 'admin'));
