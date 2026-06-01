
CREATE OR REPLACE FUNCTION public.get_creative_funnel(p_ad_id text, p_since date DEFAULT NULL::date, p_until date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_since date := COALESCE(p_since, (now() AT TIME ZONE 'Asia/Almaty')::date - 30);
  v_until date := COALESCE(p_until, (now() AT TIME ZONE 'Asia/Almaty')::date);
  v_pipeline uuid;
  v_stages jsonb;
  v_leads jsonb;
  v_total int;
  v_paid int;
  v_revenue numeric;
  v_diagnostics int;
  v_diag_revenue numeric;
  v_campaign_name text;
  v_destination_type text;
  v_objective text;
BEGIN
  IF p_ad_id IS NULL OR p_ad_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ad_id required');
  END IF;

  -- Dominant pipeline
  SELECT pipeline_id INTO v_pipeline
  FROM public.leads
  WHERE meta_ad_id = p_ad_id
    AND created_at::date BETWEEN v_since AND v_until
  GROUP BY pipeline_id
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  -- Campaign info via meta_creatives → meta_campaigns
  SELECT mcp.name, mcp.destination_type, mcp.objective
    INTO v_campaign_name, v_destination_type, v_objective
    FROM public.meta_creatives mc
    LEFT JOIN public.meta_campaigns mcp ON mcp.campaign_id = mc.campaign_id
   WHERE mc.ad_id = p_ad_id
   LIMIT 1;

  -- Stages with current counts
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

  -- Recent leads (up to 50) with stage title + key
  SELECT jsonb_agg(row) INTO v_leads FROM (
    SELECT jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'phone', l.phone,
      'created_at', l.created_at,
      'stage_id', l.stage_id,
      'stage_title', s.title,
      'stage_key', s.key,
      'is_terminal', s.is_terminal,
      'is_diagnostic', s.is_diagnostic,
      'paid', l.paid,
      'paid_at', l.paid_at,
      'amount', l.amount,
      'diagnostic_amount', l.diagnostic_amount,
      'source', l.source,
      'channel', l.channel
    ) AS row
    FROM public.leads l
    LEFT JOIN public.pipeline_stages s ON s.id = l.stage_id
    WHERE l.meta_ad_id = p_ad_id
      AND l.created_at::date BETWEEN v_since AND v_until
    ORDER BY l.created_at DESC
    LIMIT 50
  ) t;

  SELECT COUNT(*)::int INTO v_total
  FROM public.leads
  WHERE meta_ad_id = p_ad_id
    AND created_at::date BETWEEN v_since AND v_until;

  -- Diagnostics: лиды, попавшие в этапы is_diagnostic = true
  SELECT COUNT(*)::int INTO v_diagnostics
  FROM public.leads l
  JOIN public.pipeline_stages s ON s.id = l.stage_id
  WHERE l.meta_ad_id = p_ad_id
    AND l.created_at::date BETWEEN v_since AND v_until
    AND COALESCE(s.is_diagnostic, false) = true;

  SELECT COALESCE(SUM(l.diagnostic_amount), 0)::numeric INTO v_diag_revenue
  FROM public.leads l
  JOIN public.pipeline_stages s ON s.id = l.stage_id
  WHERE l.meta_ad_id = p_ad_id
    AND l.created_at::date BETWEEN v_since AND v_until
    AND COALESCE(s.is_diagnostic, false) = true;

  -- Paid: учитываем как deals.status='paid', так и leads.paid=true
  SELECT
    COUNT(DISTINCT lead_id)::int,
    COALESCE(SUM(amount), 0)::numeric
  INTO v_paid, v_revenue
  FROM (
    SELECT l.id AS lead_id, COALESCE(d.amount, l.amount, 0) AS amount
      FROM public.deals d
      JOIN public.leads l ON l.id = d.lead_id
     WHERE l.meta_ad_id = p_ad_id
       AND d.status = 'paid'
       AND COALESCE(d.paid_at, d.updated_at)::date BETWEEN v_since AND v_until
       AND COALESCE(d.service_type, '') <> 'diagnostic'
    UNION
    SELECT l.id AS lead_id, COALESCE(l.amount, 0) AS amount
      FROM public.leads l
     WHERE l.meta_ad_id = p_ad_id
       AND l.paid = true
       AND COALESCE(l.paid_at, l.updated_at)::date BETWEEN v_since AND v_until
  ) u;

  RETURN jsonb_build_object(
    'ok', true,
    'ad_id', p_ad_id,
    'since', v_since,
    'until', v_until,
    'pipeline_id', v_pipeline,
    'campaign_name', v_campaign_name,
    'destination_type', v_destination_type,
    'objective', v_objective,
    'stages', COALESCE(v_stages, '[]'::jsonb),
    'recent_leads', COALESCE(v_leads, '[]'::jsonb),
    'total_leads', v_total,
    'diagnostics', COALESCE(v_diagnostics, 0),
    'diagnostic_revenue', COALESCE(v_diag_revenue, 0),
    'paid_count', COALESCE(v_paid, 0),
    'revenue', COALESCE(v_revenue, 0)
  );
END;
$function$;
