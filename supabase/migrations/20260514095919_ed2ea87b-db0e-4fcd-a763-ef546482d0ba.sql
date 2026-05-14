
-- 1. Сквозная атрибуция: добавляем поля meta_ad_id и связанные в leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_ad_id text,
  ADD COLUMN IF NOT EXISTS meta_adset_id text,
  ADD COLUMN IF NOT EXISTS meta_campaign_id text,
  ADD COLUMN IF NOT EXISTS click_id text;

CREATE INDEX IF NOT EXISTS idx_leads_meta_ad_id ON public.leads(meta_ad_id) WHERE meta_ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_meta_campaign_id ON public.leads(meta_campaign_id) WHERE meta_campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_click_id ON public.leads(click_id) WHERE click_id IS NOT NULL;

-- 2. Бэкфилл из utm.content (исторически туда клали ad_id для сайтовых лидов с шаблоном {{ad.id}})
UPDATE public.leads
   SET meta_ad_id = utm->>'content'
 WHERE meta_ad_id IS NULL
   AND utm ? 'content'
   AND (utm->>'content') ~ '^[0-9]{6,}$'
   AND COALESCE(utm->>'source','') IN ('meta','facebook','instagram','fb','ig');

UPDATE public.leads
   SET meta_campaign_id = utm->>'campaign'
 WHERE meta_campaign_id IS NULL
   AND utm ? 'campaign'
   AND (utm->>'campaign') ~ '^[0-9]{6,}$'
   AND COALESCE(utm->>'source','') IN ('meta','facebook','instagram','fb','ig');

-- 3. View сквозной аналитики по креативам (lead-level + sales-level)
CREATE OR REPLACE VIEW public.meta_creative_crm_daily AS
WITH lead_days AS (
  SELECT
    l.meta_ad_id AS ad_id,
    l.project_id,
    (l.created_at AT TIME ZONE 'Asia/Almaty')::date AS date,
    COUNT(*)::int AS crm_leads,
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.pipeline_stages ps
        WHERE ps.id = l.stage_id AND ps.is_diagnostic = true
      )
    )::int AS crm_qualified
  FROM public.leads l
  WHERE l.meta_ad_id IS NOT NULL
  GROUP BY l.meta_ad_id, l.project_id, (l.created_at AT TIME ZONE 'Asia/Almaty')::date
),
sale_days AS (
  SELECT
    l.meta_ad_id AS ad_id,
    l.project_id,
    (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'Asia/Almaty')::date AS date,
    COUNT(*)::int AS crm_sales,
    COALESCE(SUM(d.amount), 0)::numeric AS crm_revenue
  FROM public.deals d
  JOIN public.leads l ON l.id = d.lead_id
  WHERE d.status = 'paid' AND l.meta_ad_id IS NOT NULL
  GROUP BY l.meta_ad_id, l.project_id, (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'Asia/Almaty')::date
)
SELECT
  COALESCE(ld.ad_id, sd.ad_id) AS ad_id,
  COALESCE(ld.project_id, sd.project_id) AS project_id,
  COALESCE(ld.date, sd.date) AS date,
  COALESCE(ld.crm_leads, 0) AS crm_leads,
  COALESCE(ld.crm_qualified, 0) AS crm_qualified,
  COALESCE(sd.crm_sales, 0) AS crm_sales,
  COALESCE(sd.crm_revenue, 0) AS crm_revenue
FROM lead_days ld
FULL OUTER JOIN sale_days sd
  ON ld.ad_id = sd.ad_id AND ld.project_id IS NOT DISTINCT FROM sd.project_id AND ld.date = sd.date;

GRANT SELECT ON public.meta_creative_crm_daily TO authenticated;

-- 4. RPC: воронка по этапам для конкретного креатива
CREATE OR REPLACE FUNCTION public.get_creative_funnel(
  p_ad_id text,
  p_since date DEFAULT NULL,
  p_until date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since date := COALESCE(p_since, (now() AT TIME ZONE 'Asia/Almaty')::date - 30);
  v_until date := COALESCE(p_until, (now() AT TIME ZONE 'Asia/Almaty')::date);
  v_pipeline uuid;
  v_stages jsonb;
  v_leads jsonb;
  v_total int;
  v_paid int;
  v_revenue numeric;
BEGIN
  IF p_ad_id IS NULL OR p_ad_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ad_id required');
  END IF;

  -- Find dominant pipeline among leads on this creative
  SELECT pipeline_id INTO v_pipeline
  FROM public.leads
  WHERE meta_ad_id = p_ad_id
    AND created_at::date BETWEEN v_since AND v_until
  GROUP BY pipeline_id
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  -- Stages with count of leads currently sitting in them
  SELECT jsonb_agg(jsonb_build_object(
    'stage_id', s.id,
    'key', s.key,
    'title', s.title,
    'order_index', s.order_index,
    'is_terminal', s.is_terminal,
    'is_diagnostic', s.is_diagnostic,
    'count', COALESCE(c.cnt, 0)
  ) ORDER BY s.order_index)
  INTO v_stages
  FROM public.pipeline_stages s
  LEFT JOIN (
    SELECT stage_id, COUNT(*)::int AS cnt
    FROM public.leads
    WHERE meta_ad_id = p_ad_id
      AND created_at::date BETWEEN v_since AND v_until
    GROUP BY stage_id
  ) c ON c.stage_id = s.id
  WHERE v_pipeline IS NOT NULL AND s.pipeline_id = v_pipeline;

  -- Recent leads (last 10)
  SELECT jsonb_agg(row) INTO v_leads FROM (
    SELECT jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'phone', l.phone,
      'created_at', l.created_at,
      'stage_id', l.stage_id,
      'paid', l.paid,
      'amount', l.amount
    ) AS row
    FROM public.leads l
    WHERE l.meta_ad_id = p_ad_id
      AND l.created_at::date BETWEEN v_since AND v_until
    ORDER BY l.created_at DESC
    LIMIT 10
  ) t;

  SELECT COUNT(*)::int INTO v_total
  FROM public.leads
  WHERE meta_ad_id = p_ad_id
    AND created_at::date BETWEEN v_since AND v_until;

  SELECT COUNT(*)::int, COALESCE(SUM(d.amount), 0)::numeric INTO v_paid, v_revenue
  FROM public.deals d
  JOIN public.leads l ON l.id = d.lead_id
  WHERE l.meta_ad_id = p_ad_id
    AND d.status = 'paid'
    AND COALESCE(d.paid_at, d.updated_at)::date BETWEEN v_since AND v_until;

  RETURN jsonb_build_object(
    'ok', true,
    'ad_id', p_ad_id,
    'since', v_since,
    'until', v_until,
    'pipeline_id', v_pipeline,
    'stages', COALESCE(v_stages, '[]'::jsonb),
    'recent_leads', COALESCE(v_leads, '[]'::jsonb),
    'total_leads', v_total,
    'paid_count', COALESCE(v_paid, 0),
    'revenue', COALESCE(v_revenue, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_creative_funnel(text, date, date) TO authenticated;
