-- 1) Mark qualifying stages as diagnostic across all pipelines
UPDATE public.pipeline_stages
   SET is_diagnostic = true
 WHERE key IN ('invoice','scheduled','visit','paid')
   AND is_diagnostic = false;

-- 2) Rebuild the creative→CRM view so it also counts leads.paid=true (without a deals row)
DROP VIEW IF EXISTS public.meta_creative_crm_daily;
CREATE VIEW public.meta_creative_crm_daily AS
WITH lead_days AS (
  SELECT
    l.meta_ad_id AS ad_id,
    l.project_id,
    (l.created_at AT TIME ZONE 'Asia/Almaty')::date AS date,
    COUNT(*)::int AS crm_leads,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.pipeline_stages ps
       WHERE ps.id = l.stage_id AND ps.is_diagnostic = true
    ))::int AS crm_qualified
  FROM public.leads l
  WHERE l.meta_ad_id IS NOT NULL
  GROUP BY l.meta_ad_id, l.project_id, ((l.created_at AT TIME ZONE 'Asia/Almaty')::date)
),
sale_rows AS (
  -- via deals
  SELECT
    l.meta_ad_id AS ad_id,
    l.project_id,
    (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'Asia/Almaty')::date AS date,
    1 AS crm_sales,
    COALESCE(d.amount, 0)::numeric AS crm_revenue
  FROM public.deals d
  JOIN public.leads l ON l.id = d.lead_id
  WHERE d.status = 'paid' AND l.meta_ad_id IS NOT NULL
  UNION ALL
  -- fallback: lead marked as paid without a deal row
  SELECT
    l.meta_ad_id,
    l.project_id,
    (COALESCE(l.paid_at, l.updated_at) AT TIME ZONE 'Asia/Almaty')::date,
    1,
    COALESCE(l.amount, 0)::numeric
  FROM public.leads l
  WHERE l.paid = true
    AND l.meta_ad_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.deals d2
       WHERE d2.lead_id = l.id AND d2.status = 'paid'
    )
),
sale_days AS (
  SELECT ad_id, project_id, date,
         SUM(crm_sales)::int AS crm_sales,
         SUM(crm_revenue)::numeric AS crm_revenue
    FROM sale_rows
   GROUP BY ad_id, project_id, date
)
SELECT
  COALESCE(ld.ad_id, sd.ad_id) AS ad_id,
  COALESCE(ld.project_id, sd.project_id) AS project_id,
  COALESCE(ld.date, sd.date) AS date,
  COALESCE(ld.crm_leads, 0) AS crm_leads,
  COALESCE(ld.crm_qualified, 0) AS crm_qualified,
  COALESCE(sd.crm_sales, 0) AS crm_sales,
  COALESCE(sd.crm_revenue, 0::numeric) AS crm_revenue
FROM lead_days ld
FULL JOIN sale_days sd
  ON ld.ad_id = sd.ad_id
 AND NOT ld.project_id IS DISTINCT FROM sd.project_id
 AND ld.date = sd.date;

GRANT SELECT ON public.meta_creative_crm_daily TO authenticated, anon;