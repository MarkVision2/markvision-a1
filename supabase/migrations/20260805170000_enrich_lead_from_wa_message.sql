-- Enrich WhatsApp CRM leads from first inbound message text (ref: / utm_* / Meta ids).
-- Safety net when edge ingest missed attribution (n8n/landing/CTWA prefill).

CREATE OR REPLACE FUNCTION public.enrich_lead_from_wa_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_text text;
  v_ref text;
  v_parts text[];
  v_tok text;
  v_nums text[] := ARRAY[]::text[];
  v_partner text;
  v_site text;
  v_utm jsonb := '{}'::jsonb;
  v_ad text;
  v_adset text;
  v_camp text;
  v_click text;
  v_utm_source text;
  v_utm_medium text;
  v_utm_campaign text;
  v_utm_content text;
  v_utm_term text;
  v_lead record;
  v_patch jsonb := '{}'::jsonb;
  v_cab uuid;
  i int;
BEGIN
  IF NEW.channel IS DISTINCT FROM 'whatsapp' THEN RETURN NEW; END IF;
  IF NEW.direction IS DISTINCT FROM 'in' THEN RETURN NEW; END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  v_text := coalesce(NEW.content, '');
  IF length(trim(v_text)) < 3 THEN RETURN NEW; END IF;
  -- Only enrich when message carries tracking markers
  IF v_text !~* 'ref\s*:' AND v_text !~* 'utm_source\s*=' AND v_text !~* 'utm_content\s*=' AND v_text !~* 'fbclid\s*=' THEN
    RETURN NEW;
  END IF;

  SELECT id, source, utm, meta_ad_id, meta_adset_id, meta_campaign_id, click_id, cabinet_id, project_id
    INTO v_lead
    FROM public.leads
   WHERE id = NEW.lead_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- ref:zapoinovai[.partner|.ids...]
  v_ref := (regexp_match(v_text, 'ref\s*:\s*([^\s\n]+)', 'i'))[1];
  IF v_ref IS NOT NULL THEN
    v_parts := string_to_array(v_ref, '.');
    IF lower(coalesce(v_parts[1], '')) = 'zapoinovai' THEN
      v_site := 'zapoinovai';
      v_utm := v_utm || jsonb_build_object('site', 'zapoinovai');
      i := 2;
    ELSE
      i := 1;
    END IF;
    WHILE i <= coalesce(array_length(v_parts, 1), 0) LOOP
      v_tok := trim(v_parts[i]);
      IF v_tok ~ '^[0-9]{6,}$' THEN
        v_nums := array_append(v_nums, v_tok);
      ELSIF v_partner IS NULL AND lower(v_tok) IN ('yuriy','dastan','nadi','astana_hub','hub','vit','vitalya','vitaly','виталя') THEN
        v_partner := CASE lower(v_tok)
          WHEN 'hub' THEN 'astana_hub'
          WHEN 'vit' THEN 'виталя'
          WHEN 'vitalya' THEN 'виталя'
          WHEN 'vitaly' THEN 'виталя'
          ELSE lower(v_tok)
        END;
      END IF;
      i := i + 1;
    END LOOP;
    IF array_length(v_nums, 1) >= 3 THEN
      v_camp := v_nums[array_length(v_nums, 1) - 2];
      v_adset := v_nums[array_length(v_nums, 1) - 1];
      v_ad := v_nums[array_length(v_nums, 1)];
    ELSIF array_length(v_nums, 1) = 2 THEN
      v_adset := v_nums[1];
      v_ad := v_nums[2];
    ELSIF array_length(v_nums, 1) = 1 THEN
      v_ad := v_nums[1];
    END IF;
  END IF;

  v_utm_source := (regexp_match(v_text, 'utm_source\s*=\s*([^\s&#\n]+)', 'i'))[1];
  v_utm_medium := (regexp_match(v_text, 'utm_medium\s*=\s*([^\s&#\n]+)', 'i'))[1];
  v_utm_campaign := (regexp_match(v_text, 'utm_campaign\s*=\s*([^\s&#\n]+)', 'i'))[1];
  v_utm_content := (regexp_match(v_text, 'utm_content\s*=\s*([^\s&#\n]+)', 'i'))[1];
  v_utm_term := (regexp_match(v_text, 'utm_term\s*=\s*([^\s&#\n]+)', 'i'))[1];

  IF v_utm_source IS NOT NULL THEN
    v_utm := v_utm || jsonb_build_object('source', v_utm_source);
    IF v_partner IS NULL AND lower(v_utm_source) IN ('yuriy','dastan','nadi','astana_hub','vit','vitalya','виталя') THEN
      v_partner := CASE lower(v_utm_source)
        WHEN 'vit' THEN 'виталя'
        WHEN 'vitalya' THEN 'виталя'
        ELSE lower(v_utm_source)
      END;
    END IF;
  END IF;
  IF v_utm_medium IS NOT NULL THEN v_utm := v_utm || jsonb_build_object('medium', v_utm_medium); END IF;
  IF v_utm_campaign IS NOT NULL THEN
    v_utm := v_utm || jsonb_build_object('campaign', v_utm_campaign);
    IF v_camp IS NULL AND v_utm_campaign ~ '^[0-9]{6,}$' THEN v_camp := v_utm_campaign; END IF;
  END IF;
  IF v_utm_content IS NOT NULL THEN
    v_utm := v_utm || jsonb_build_object('content', v_utm_content);
    IF v_ad IS NULL THEN
      v_ad := (regexp_match(v_utm_content, '^([0-9]{6,})'))[1];
    END IF;
  END IF;
  IF v_utm_term IS NOT NULL THEN
    v_utm := v_utm || jsonb_build_object('term', v_utm_term);
    IF v_adset IS NULL AND v_utm_term ~ '^[0-9]{6,}$' THEN v_adset := v_utm_term; END IF;
  END IF;

  v_click := (regexp_match(v_text, '\[?#([a-zA-Z0-9_-]{4,32})\]?'))[1];
  IF v_click IS NULL THEN
    v_click := (regexp_match(v_text, 'fbclid\s*=\s*([^\s&#\n]+)', 'i'))[1];
  END IF;

  IF v_ad IS NOT NULL THEN
    v_utm := v_utm || jsonb_build_object('ad_id', v_ad);
  END IF;
  IF v_adset IS NOT NULL THEN
    v_utm := v_utm || jsonb_build_object('adset_id', v_adset);
  END IF;
  IF v_camp IS NOT NULL THEN
    v_utm := v_utm || jsonb_build_object('campaign_id', v_camp);
  END IF;
  IF (v_utm->>'source') IS NULL THEN
    IF v_partner IS NOT NULL THEN
      v_utm := v_utm || jsonb_build_object('source', v_partner);
    ELSIF v_ad IS NOT NULL OR v_site = 'zapoinovai' THEN
      v_utm := v_utm || jsonb_build_object('source', 'meta');
    END IF;
  END IF;

  -- Patch only empty attribution fields
  IF v_lead.meta_ad_id IS NULL AND v_ad IS NOT NULL THEN
    UPDATE public.leads SET
      meta_ad_id = v_ad,
      meta_adset_id = COALESCE(meta_adset_id, v_adset),
      meta_campaign_id = COALESCE(meta_campaign_id, v_camp),
      click_id = COALESCE(click_id, v_click),
      source = CASE
        WHEN lower(coalesce(source, '')) IN ('', 'whatsapp', 'wa', 'zapoinovai', 'site', 'web') AND v_ad IS NOT NULL THEN 'meta'
        WHEN lower(coalesce(source, '')) IN ('', 'whatsapp', 'wa') AND v_partner IS NOT NULL THEN v_partner
        WHEN lower(coalesce(source, '')) IN ('', 'whatsapp', 'wa') AND v_site = 'zapoinovai' THEN 'zapoinovai'
        ELSE source
      END,
      utm = COALESCE(utm, '{}'::jsonb) || v_utm,
      updated_at = now()
    WHERE id = v_lead.id;
  ELSIF v_utm <> '{}'::jsonb OR v_partner IS NOT NULL OR v_site IS NOT NULL OR v_click IS NOT NULL THEN
    UPDATE public.leads SET
      click_id = COALESCE(click_id, v_click),
      source = CASE
        WHEN lower(coalesce(source, '')) IN ('', 'whatsapp', 'wa') AND v_partner IS NOT NULL THEN v_partner
        WHEN lower(coalesce(source, '')) IN ('', 'whatsapp', 'wa') AND v_site = 'zapoinovai' THEN 'zapoinovai'
        ELSE source
      END,
      utm = COALESCE(utm, '{}'::jsonb) || v_utm,
      updated_at = now()
    WHERE id = v_lead.id
      AND (
        utm IS NULL
        OR utm = '{}'::jsonb
        OR lower(coalesce(source, '')) IN ('', 'whatsapp', 'wa')
        OR click_id IS NULL
      );
  END IF;

  -- Attach sole Meta cabinet when source looks like Meta and cabinet empty
  SELECT ac.id INTO v_cab
    FROM public.ad_cabinets ac
   WHERE ac.project_id = v_lead.project_id
     AND lower(COALESCE(ac.provider, 'meta')) IN ('meta', 'facebook')
   GROUP BY ac.id
  HAVING (
    SELECT count(*)::int FROM public.ad_cabinets x
     WHERE x.project_id = v_lead.project_id
       AND lower(COALESCE(x.provider, 'meta')) IN ('meta', 'facebook')
  ) = 1
   LIMIT 1;

  IF v_cab IS NOT NULL THEN
    UPDATE public.leads
       SET cabinet_id = COALESCE(cabinet_id, v_cab)
     WHERE id = v_lead.id
       AND cabinet_id IS NULL
       AND (
         meta_ad_id IS NOT NULL
         OR lower(COALESCE(utm->>'source', '')) IN ('meta', 'facebook', 'instagram', 'fb', 'ig', 'an')
         OR lower(COALESCE(source, '')) IN ('meta', 'facebook', 'instagram', 'zapoinovai')
       );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enrich_lead_from_wa_message ON public.communications;
CREATE TRIGGER trg_enrich_lead_from_wa_message
AFTER INSERT ON public.communications
FOR EACH ROW
EXECUTE FUNCTION public.enrich_lead_from_wa_message();
