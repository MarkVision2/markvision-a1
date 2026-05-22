-- Автоматическая обратная атрибуция лидов: если у лида нет meta_ad_id,
-- но его телефон уже есть в phone_attribution — подтягиваем meta_ad_id, чтобы
-- продажа корректно отображалась в Meta-кампаниях и креативах.
--
-- Без этого: paid лид через WhatsApp без UTM → meta_creative_crm_daily не видит его
-- → Цели рекламных кампаний Meta показывают ROMI -100%, креативы не видят оплат.

CREATE OR REPLACE FUNCTION public.trg_lead_autofill_meta_ad_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_attr record;
BEGIN
  -- Только если у лида ещё нет meta_ad_id и есть телефон
  IF NEW.meta_ad_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.phone IS NULL THEN RETURN NEW; END IF;

  v_norm := public.normalize_phone(NEW.phone);
  IF v_norm = '' THEN RETURN NEW; END IF;

  SELECT meta_ad_id, meta_adset_id, meta_campaign_id, cabinet_id, click_id
    INTO v_attr
    FROM public.phone_attribution
   WHERE phone = v_norm
     AND (project_id IS NULL OR project_id = NEW.project_id)
     AND meta_ad_id IS NOT NULL
   ORDER BY updated_at DESC
   LIMIT 1;

  IF v_attr IS NULL THEN RETURN NEW; END IF;

  NEW.meta_ad_id := v_attr.meta_ad_id;
  NEW.meta_adset_id := COALESCE(NEW.meta_adset_id, v_attr.meta_adset_id);
  NEW.meta_campaign_id := COALESCE(NEW.meta_campaign_id, v_attr.meta_campaign_id);
  NEW.cabinet_id := COALESCE(NEW.cabinet_id, v_attr.cabinet_id);
  NEW.click_id := COALESCE(NEW.click_id, v_attr.click_id);

  -- Если лид пришёл с whatsapp, но мы поняли что это Meta — обновляем источник
  IF NEW.source = 'whatsapp' THEN
    NEW.source := 'meta';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_autofill_meta_ad_id ON public.leads;
CREATE TRIGGER trg_leads_autofill_meta_ad_id
BEFORE INSERT OR UPDATE OF phone ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trg_lead_autofill_meta_ad_id();

-- =============================================================================
-- Одноразовый бэкфилл существующих лидов по phone_attribution.
-- Делаем за последние 180 дней, чтобы не трогать архив.
-- =============================================================================
DO $$
DECLARE
  v_updated int := 0;
BEGIN
  WITH cand AS (
    SELECT DISTINCT ON (l.id)
           l.id,
           pa.meta_ad_id,
           pa.meta_adset_id,
           pa.meta_campaign_id,
           pa.cabinet_id,
           pa.click_id
      FROM public.leads l
      JOIN public.phone_attribution pa
        ON pa.phone = public.normalize_phone(l.phone)
       AND (pa.project_id IS NULL OR pa.project_id = l.project_id)
     WHERE l.meta_ad_id IS NULL
       AND l.created_at >= (now() - interval '180 days')
       AND pa.meta_ad_id IS NOT NULL
     ORDER BY l.id, pa.updated_at DESC
  )
  UPDATE public.leads l
     SET meta_ad_id      = c.meta_ad_id,
         meta_adset_id   = COALESCE(l.meta_adset_id, c.meta_adset_id),
         meta_campaign_id = COALESCE(l.meta_campaign_id, c.meta_campaign_id),
         cabinet_id      = COALESCE(l.cabinet_id, c.cabinet_id),
         click_id        = COALESCE(l.click_id, c.click_id),
         source          = CASE WHEN l.source = 'whatsapp' THEN 'meta' ELSE l.source END
    FROM cand c
   WHERE l.id = c.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '[20260521190000] backfilled meta_ad_id for % leads via phone_attribution', v_updated;
END $$;
