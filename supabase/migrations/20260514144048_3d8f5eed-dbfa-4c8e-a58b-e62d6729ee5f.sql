CREATE OR REPLACE FUNCTION public.resolve_meta_ids_from_utm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_content text;
  v_campaign text;
  v_cab uuid;
  v_camp text;
  v_adset text;
  v_proj uuid;
BEGIN
  v_content := NULLIF(NEW.utm->>'content', '');
  v_campaign := NULLIF(NEW.utm->>'campaign', '');

  IF NEW.meta_ad_id IS NULL AND v_content IS NOT NULL THEN
    IF v_content ~ '^[0-9]{6,}$' THEN
      NEW.meta_ad_id := v_content;
    ELSE
      SELECT mc.ad_id INTO NEW.meta_ad_id
        FROM public.meta_creatives mc
       WHERE mc.name = v_content
         AND (NEW.project_id IS NULL OR mc.project_id = NEW.project_id)
       LIMIT 1;
    END IF;
  END IF;

  IF NEW.meta_campaign_id IS NULL AND v_campaign IS NOT NULL THEN
    IF v_campaign ~ '^[0-9]{6,}$' THEN
      NEW.meta_campaign_id := v_campaign;
    ELSE
      SELECT mcp.campaign_id INTO NEW.meta_campaign_id
        FROM public.meta_campaigns mcp
       WHERE mcp.name = v_campaign
         AND (NEW.project_id IS NULL OR mcp.project_id = NEW.project_id)
       LIMIT 1;
    END IF;
  END IF;

  IF NEW.meta_ad_id IS NOT NULL THEN
    SELECT mc.cabinet_id, mc.campaign_id, mc.adset_id, mc.project_id
      INTO v_cab, v_camp, v_adset, v_proj
      FROM public.meta_creatives mc
     WHERE mc.ad_id = NEW.meta_ad_id
     LIMIT 1;

    IF NEW.cabinet_id IS NULL AND v_cab IS NOT NULL THEN NEW.cabinet_id := v_cab; END IF;
    IF NEW.meta_campaign_id IS NULL AND v_camp IS NOT NULL THEN NEW.meta_campaign_id := v_camp; END IF;
    IF NEW.meta_adset_id IS NULL AND v_adset IS NOT NULL THEN NEW.meta_adset_id := v_adset; END IF;
    IF NEW.project_id IS NULL AND v_proj IS NOT NULL THEN NEW.project_id := v_proj; END IF;
  END IF;

  RETURN NEW;
END;
$function$;

UPDATE public.leads l
   SET cabinet_id       = COALESCE(l.cabinet_id, mc.cabinet_id),
       meta_campaign_id = COALESCE(l.meta_campaign_id, mc.campaign_id),
       meta_adset_id    = COALESCE(l.meta_adset_id, mc.adset_id),
       project_id       = COALESCE(l.project_id, mc.project_id)
  FROM public.meta_creatives mc
 WHERE l.meta_ad_id = mc.ad_id
   AND l.meta_ad_id IS NOT NULL
   AND (
        (l.cabinet_id IS NULL       AND mc.cabinet_id IS NOT NULL)
     OR (l.meta_campaign_id IS NULL AND mc.campaign_id IS NOT NULL)
     OR (l.meta_adset_id IS NULL    AND mc.adset_id IS NOT NULL)
     OR (l.project_id IS NULL       AND mc.project_id IS NOT NULL)
   );

INSERT INTO public.cabinet_daily_insights (cabinet_id, external_id, project_id, date, crm_sales, crm_revenue, synced_at)
SELECT l.cabinet_id,
       COALESCE(ac.external_id, ''),
       l.project_id,
       (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'UTC')::date,
       COUNT(*)::int,
       COALESCE(SUM(d.amount), 0),
       now()
  FROM public.deals d
  JOIN public.leads l ON l.id = d.lead_id
  LEFT JOIN public.ad_cabinets ac ON ac.id = l.cabinet_id
 WHERE d.status = 'paid'
   AND l.cabinet_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.events e
      WHERE e.lead_id = l.id
        AND e.event_type = 'cabinet_attributed'
        AND e.payload->>'kind' = 'sale'
        AND e.payload->>'deal_id' = d.id::text
   )
 GROUP BY l.cabinet_id, ac.external_id, l.project_id, (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'UTC')::date
ON CONFLICT (cabinet_id, date) DO UPDATE
   SET crm_sales = public.cabinet_daily_insights.crm_sales + EXCLUDED.crm_sales,
       crm_revenue = public.cabinet_daily_insights.crm_revenue + EXCLUDED.crm_revenue,
       synced_at = now();

INSERT INTO public.events (lead_id, event_type, payload)
SELECT l.id,
       'cabinet_attributed',
       jsonb_build_object(
         'kind', 'sale',
         'deal_id', d.id,
         'amount', d.amount,
         'cabinet_id', l.cabinet_id,
         'date', (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'UTC')::date,
         'backfill', true
       )
  FROM public.deals d
  JOIN public.leads l ON l.id = d.lead_id
 WHERE d.status = 'paid'
   AND l.cabinet_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.events e
      WHERE e.lead_id = l.id
        AND e.event_type = 'cabinet_attributed'
        AND e.payload->>'kind' = 'sale'
        AND e.payload->>'deal_id' = d.id::text
   );