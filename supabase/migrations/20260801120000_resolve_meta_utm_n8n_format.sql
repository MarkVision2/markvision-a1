-- n8n / zapoinovai кладут в leads.utm поля ad_id / campaign_id / adset_id / source,
-- а не стандартные content / campaign / term. Триггер их не видел → cabinet_id
-- оставался NULL → «Лиды CRM» на карточке кабинета = 0 при живых Meta-лидах.
--
-- Также: если ad_id нет, но utm.source указывает на Meta и у проекта ровно один
-- Meta-кабинет — привязываем к нему (иначе launch-лиды с лендинга невидимы в Ads).

CREATE OR REPLACE FUNCTION public.resolve_meta_ids_from_utm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_content text;
  v_campaign text;
  v_adset text;
  v_utm_source text;
  v_cab uuid;
  v_camp text;
  v_adset_id text;
  v_proj uuid;
  v_sole_cab uuid;
BEGIN
  -- MarkVision form: content/campaign/term · n8n/zapoinovai: ad_id/campaign_id/adset_id
  v_content := COALESCE(
    NULLIF(NEW.utm->>'content', ''),
    NULLIF(NEW.utm->>'ad_id', ''),
    NULLIF(NEW.utm->>'adid', '')
  );
  v_campaign := COALESCE(
    NULLIF(NEW.utm->>'campaign', ''),
    NULLIF(NEW.utm->>'campaign_id', ''),
    NULLIF(NEW.utm->>'cid', '')
  );
  v_adset := COALESCE(
    NULLIF(NEW.utm->>'term', ''),
    NULLIF(NEW.utm->>'adset_id', ''),
    NULLIF(NEW.utm->>'asid', '')
  );
  v_utm_source := lower(COALESCE(NULLIF(NEW.utm->>'source', ''), ''));

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

  IF NEW.meta_adset_id IS NULL AND v_adset IS NOT NULL AND v_adset ~ '^[0-9]{6,}$' THEN
    NEW.meta_adset_id := v_adset;
  END IF;

  IF NEW.meta_ad_id IS NOT NULL THEN
    SELECT mc.cabinet_id, mc.campaign_id, mc.adset_id, mc.project_id
      INTO v_cab, v_camp, v_adset_id, v_proj
      FROM public.meta_creatives mc
     WHERE mc.ad_id = NEW.meta_ad_id
     LIMIT 1;

    IF NEW.cabinet_id IS NULL AND v_cab IS NOT NULL THEN NEW.cabinet_id := v_cab; END IF;
    IF NEW.meta_campaign_id IS NULL AND v_camp IS NOT NULL THEN NEW.meta_campaign_id := v_camp; END IF;
    IF NEW.meta_adset_id IS NULL AND v_adset_id IS NOT NULL THEN NEW.meta_adset_id := v_adset_id; END IF;
    IF NEW.project_id IS NULL AND v_proj IS NOT NULL THEN NEW.project_id := v_proj; END IF;
  END IF;

  -- Fallback: Meta-трафик без ad_id (лендинг не прокинул cid) → единственный Meta-кабинет проекта
  IF NEW.cabinet_id IS NULL
     AND NEW.project_id IS NOT NULL
     AND (
       v_utm_source IN ('meta', 'facebook', 'instagram', 'fb', 'ig', 'an')
       OR lower(COALESCE(NEW.source, '')) IN ('meta', 'facebook', 'instagram')
     )
     AND lower(COALESCE(NEW.source, '')) NOT LIKE 'broadcast%'
  THEN
    SELECT ac.id INTO v_sole_cab
      FROM public.ad_cabinets ac
     WHERE ac.project_id = NEW.project_id
       AND lower(COALESCE(ac.provider, 'meta')) IN ('meta', 'facebook')
     GROUP BY ac.id
    HAVING (
      SELECT count(*)::int
        FROM public.ad_cabinets x
       WHERE x.project_id = NEW.project_id
         AND lower(COALESCE(x.provider, 'meta')) IN ('meta', 'facebook')
    ) = 1
     LIMIT 1;
    IF v_sole_cab IS NOT NULL THEN
      NEW.cabinet_id := v_sole_cab;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Бэкфилл: meta_ad_id из n8n-полей
UPDATE public.leads
   SET meta_ad_id = COALESCE(
     NULLIF(utm->>'ad_id', ''),
     NULLIF(utm->>'adid', ''),
     NULLIF(utm->>'content', '')
   )
 WHERE meta_ad_id IS NULL
   AND COALESCE(
     NULLIF(utm->>'ad_id', ''),
     NULLIF(utm->>'adid', ''),
     NULLIF(utm->>'content', '')
   ) ~ '^[0-9]{6,}$';

UPDATE public.leads
   SET meta_campaign_id = COALESCE(
     NULLIF(utm->>'campaign_id', ''),
     NULLIF(utm->>'cid', ''),
     NULLIF(utm->>'campaign', '')
   )
 WHERE meta_campaign_id IS NULL
   AND COALESCE(
     NULLIF(utm->>'campaign_id', ''),
     NULLIF(utm->>'cid', ''),
     NULLIF(utm->>'campaign', '')
   ) ~ '^[0-9]{6,}$';

UPDATE public.leads
   SET meta_adset_id = COALESCE(
     NULLIF(utm->>'adset_id', ''),
     NULLIF(utm->>'asid', ''),
     NULLIF(utm->>'term', '')
   )
 WHERE meta_adset_id IS NULL
   AND COALESCE(
     NULLIF(utm->>'adset_id', ''),
     NULLIF(utm->>'asid', ''),
     NULLIF(utm->>'term', '')
   ) ~ '^[0-9]{6,}$';

-- cabinet_id из creatives по meta_ad_id
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

-- Fallback: один Meta-кабинет на проект + utm.source=meta (без ad_id)
UPDATE public.leads l
   SET cabinet_id = sole.cab_id
  FROM (
    SELECT project_id, (array_agg(id))[1] AS cab_id
      FROM public.ad_cabinets
     WHERE lower(COALESCE(provider, 'meta')) IN ('meta', 'facebook')
     GROUP BY project_id
    HAVING count(*) = 1
  ) sole
 WHERE l.project_id = sole.project_id
   AND l.cabinet_id IS NULL
   AND COALESCE(l.is_personal, false) = false
   AND lower(COALESCE(l.source, '')) NOT LIKE 'broadcast%'
   AND (
     lower(COALESCE(l.utm->>'source', '')) IN ('meta', 'facebook', 'instagram', 'fb', 'ig', 'an')
     OR lower(COALESCE(l.source, '')) IN ('meta', 'facebook', 'instagram')
   );
