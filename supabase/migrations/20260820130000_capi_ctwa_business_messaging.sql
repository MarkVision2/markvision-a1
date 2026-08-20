-- CAPI без сайта: доносим ctwa_clid как доп.сигнал, не ломая существующее поведение.
--
-- Контекст: серверный CAPI уже работает без сайта — Meta привязывает WhatsApp-лида
-- к Click-to-WhatsApp рекламе по хешу телефона. business_messaging (официальный CTWA
-- action_source) НЕ применяем: Meta требует whatsapp_business_account_id или page_id,
-- которых нет при стеке на Green API (проверено — Graph API отклоняет такие события).
--
-- Что делаем: раскладываем click_id так, чтобы у WhatsApp-лида он ещё и уходил как
-- ctwa_clid (top-level поле user_data). action_source остаётся 'website' (Meta принимает).
-- fbc сохраняем как было — без регресса для веб-лидов. channel доносим на будущее.
CREATE OR REPLACE FUNCTION public.enqueue_capi_event(
  _lead_id uuid,
  _event_name text,
  _is_paid boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lead record;
  _currency text;
  _event_id text;
  _outbox_id uuid;
BEGIN
  IF _lead_id IS NULL OR _event_name IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _lead FROM public.leads WHERE id = _lead_id;
  IF _lead IS NULL THEN RETURN NULL; END IF;

  -- Currency: projects.currency хранит символ ('₸', '$') — конвертим в ISO для Meta.
  SELECT CASE
    WHEN p.currency IN ('₸', 'KZT') THEN 'KZT'
    WHEN p.currency IN ('$', 'USD') THEN 'USD'
    WHEN p.currency IN ('₽', 'RUB') THEN 'RUB'
    WHEN p.currency IN ('€', 'EUR') THEN 'EUR'
    ELSE COALESCE(p.currency, 'KZT')
  END INTO _currency FROM public.projects p WHERE p.id = _lead.project_id;

  _event_id := _lead.id::text || '-' || _event_name;

  INSERT INTO public.capi_outbox (
    lead_id, project_id, cabinet_id,
    event_name, event_id, event_time,
    meta_ad_id, meta_adset_id, meta_campaign_id,
    value, currency,
    raw_user_data,
    status
  ) VALUES (
    _lead.id, _lead.project_id, _lead.cabinet_id,
    _event_name, _event_id, now(),
    _lead.meta_ad_id, _lead.meta_adset_id, _lead.meta_campaign_id,
    CASE WHEN _is_paid THEN COALESCE(_lead.amount, 0) ELSE NULL END,
    COALESCE(_currency, 'KZT'),
    jsonb_build_object(
      'phone', _lead.phone,
      'email', _lead.email,
      'name', _lead.name,
      'channel', _lead.channel,
      'fbc', _lead.click_id,
      -- ctwa_clid — только для WhatsApp-лидов (там click_id и есть Click-to-WhatsApp id).
      'ctwa_clid', CASE WHEN _lead.channel = 'whatsapp' THEN _lead.click_id ELSE NULL END,
      'fbp', NULLIF(_lead.utm->>'fbp', ''),
      'external_id', _lead.id::text
    ),
    'pending'
  )
  ON CONFLICT (lead_id, event_name, event_id) DO NOTHING
  RETURNING id INTO _outbox_id;

  RETURN _outbox_id;
END;
$$;
