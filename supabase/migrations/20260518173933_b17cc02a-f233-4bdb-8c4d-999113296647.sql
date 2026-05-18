
-- 1. Align meta_creative_crm_daily date computation with cabinet_daily_insights (UTC date).
DROP VIEW IF EXISTS public.meta_creative_crm_daily;
CREATE VIEW public.meta_creative_crm_daily AS
WITH lead_days AS (
  SELECT
    l.meta_ad_id AS ad_id,
    l.project_id,
    (l.created_at AT TIME ZONE 'UTC')::date AS date,
    COUNT(*)::int AS crm_leads,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.pipeline_stages ps
      WHERE ps.id = l.stage_id AND ps.is_diagnostic = true
    ))::int AS crm_qualified
  FROM public.leads l
  WHERE l.meta_ad_id IS NOT NULL
  GROUP BY l.meta_ad_id, l.project_id, (l.created_at AT TIME ZONE 'UTC')::date
),
sale_rows AS (
  SELECT
    l.meta_ad_id AS ad_id,
    l.project_id,
    (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'UTC')::date AS date,
    1 AS crm_sales,
    COALESCE(d.amount, 0::numeric) AS crm_revenue
  FROM public.deals d
  JOIN public.leads l ON l.id = d.lead_id
  WHERE d.status = 'paid'::deal_status AND l.meta_ad_id IS NOT NULL
  UNION ALL
  SELECT
    l.meta_ad_id,
    l.project_id,
    (COALESCE(l.paid_at, l.updated_at) AT TIME ZONE 'UTC')::date,
    1,
    COALESCE(l.amount, 0::numeric)
  FROM public.leads l
  WHERE l.paid = true AND l.meta_ad_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.deals d2
      WHERE d2.lead_id = l.id AND d2.status = 'paid'::deal_status
    )
),
sale_days AS (
  SELECT ad_id, project_id, date,
    SUM(crm_sales)::int AS crm_sales,
    SUM(crm_revenue) AS crm_revenue
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
 AND NOT (ld.project_id IS DISTINCT FROM sd.project_id)
 AND ld.date = sd.date;

-- 2. Backfill cabinet_daily_insights from meta_creative_daily so dashboard totals
--    match per-creative totals on the same period (covers last 90 days).
INSERT INTO public.cabinet_daily_insights
  (cabinet_id, external_id, project_id, date, spend, impressions, clicks, leads, currency, synced_at)
SELECT
  mcd.cabinet_id,
  COALESCE(ac.external_id, ''),
  mcd.project_id,
  mcd.date,
  SUM(mcd.spend),
  SUM(mcd.impressions)::int,
  SUM(mcd.clicks)::int,
  SUM(mcd.leads)::int,
  'KZT',
  now()
FROM public.meta_creative_daily mcd
LEFT JOIN public.ad_cabinets ac ON ac.id = mcd.cabinet_id
WHERE mcd.cabinet_id IS NOT NULL
  AND mcd.date >= CURRENT_DATE - 90
GROUP BY mcd.cabinet_id, ac.external_id, mcd.project_id, mcd.date
ON CONFLICT (cabinet_id, date) DO UPDATE
  SET spend       = EXCLUDED.spend,
      impressions = EXCLUDED.impressions,
      clicks      = EXCLUDED.clicks,
      leads       = GREATEST(public.cabinet_daily_insights.leads, EXCLUDED.leads),
      synced_at   = now();
