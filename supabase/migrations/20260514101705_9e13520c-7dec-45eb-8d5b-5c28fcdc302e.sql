-- 1) Backfill meta_ad_id by matching utm.content to meta_creatives.name
UPDATE public.leads l
   SET meta_ad_id = mc.ad_id,
       meta_campaign_id = COALESCE(l.meta_campaign_id, mc.campaign_id),
       meta_adset_id = COALESCE(l.meta_adset_id, mc.adset_id)
  FROM public.meta_creatives mc
 WHERE l.meta_ad_id IS NULL
   AND l.utm ? 'content'
   AND mc.name = l.utm->>'content'
   AND (l.project_id = mc.project_id OR l.project_id IS NULL);

-- 2) Backfill meta_campaign_id by matching utm.campaign to meta_campaigns.name
UPDATE public.leads l
   SET meta_campaign_id = mcp.campaign_id
  FROM public.meta_campaigns mcp
 WHERE l.meta_campaign_id IS NULL
   AND l.utm ? 'campaign'
   AND mcp.name = l.utm->>'campaign'
   AND (l.project_id = mcp.project_id OR l.project_id IS NULL);

-- 3) Trigger: auto-resolve meta_ad_id / meta_campaign_id on lead insert/update
CREATE OR REPLACE FUNCTION public.resolve_meta_ids_from_utm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_content text;
  v_campaign text;
BEGIN
  v_content := NULLIF(NEW.utm->>'content', '');
  v_campaign := NULLIF(NEW.utm->>'campaign', '');

  IF NEW.meta_ad_id IS NULL AND v_content IS NOT NULL THEN
    -- numeric ad id
    IF v_content ~ '^[0-9]{6,}$' THEN
      NEW.meta_ad_id := v_content;
    ELSE
      SELECT mc.ad_id, COALESCE(NEW.meta_campaign_id, mc.campaign_id), COALESCE(NEW.meta_adset_id, mc.adset_id)
        INTO NEW.meta_ad_id, NEW.meta_campaign_id, NEW.meta_adset_id
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolve_meta_ids_from_utm ON public.leads;
CREATE TRIGGER trg_resolve_meta_ids_from_utm
BEFORE INSERT OR UPDATE OF utm, meta_ad_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.resolve_meta_ids_from_utm();