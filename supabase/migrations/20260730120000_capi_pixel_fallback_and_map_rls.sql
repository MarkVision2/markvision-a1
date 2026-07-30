-- ============================================================
-- CAPI: надёжная доставка в Meta из настроек CRM
--
-- Проблемы (prod MarkVision AI, 2026-07-30):
--   1) Лиды WhatsApp часто без cabinet_id → worker: skipped
--      «No pixel_id/access_token…», хотя у проекта есть кабинет с Pixel.
--   2) crm_stage_map писал только global admin — владелец проекта
--      не мог сохранить карту этапов в UI.
--   3) skipped/failed не переотправлялись после починки кредов.
--   4) В seed не было Lead для статуса `new`.
--   5) fbc передавался сырым click_id (не формат fb.1.ts.fbclid).
-- ============================================================

-- 1) Глобальный seed: новый лид → Lead
INSERT INTO public.crm_stage_map (status_key, capi_event, is_paid, project_id)
SELECT 'new', 'Lead', false, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_stage_map
  WHERE status_key = 'new' AND project_id IS NULL
);

-- 2) RLS: участник проекта может править карту своего проекта
DROP POLICY IF EXISTS stage_map_project_write ON public.crm_stage_map;
CREATE POLICY stage_map_project_write ON public.crm_stage_map
  FOR ALL TO authenticated
  USING (
    project_id IS NOT NULL
    AND public.user_can_access_project(project_id)
  )
  WITH CHECK (
    project_id IS NOT NULL
    AND public.user_can_access_project(project_id)
  );

-- 3) enqueue: кабинет по умолчанию + нормальный fbc + deposit_amount
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
  _cabinet_id uuid;
  _fbc text;
  _value numeric;
BEGIN
  IF _lead_id IS NULL OR _event_name IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _lead FROM public.leads WHERE id = _lead_id;
  IF _lead IS NULL THEN RETURN NULL; END IF;

  SELECT CASE
    WHEN p.currency IN ('₸', 'KZT') THEN 'KZT'
    WHEN p.currency IN ('$', 'USD') THEN 'USD'
    WHEN p.currency IN ('₽', 'RUB') THEN 'RUB'
    WHEN p.currency IN ('€', 'EUR') THEN 'EUR'
    ELSE COALESCE(p.currency, 'KZT')
  END INTO _currency FROM public.projects p WHERE p.id = _lead.project_id;

  _cabinet_id := _lead.cabinet_id;
  IF _cabinet_id IS NULL AND _lead.project_id IS NOT NULL THEN
    SELECT c.id INTO _cabinet_id
    FROM public.ad_cabinets c
    WHERE c.project_id = _lead.project_id
      AND c.pixel_id IS NOT NULL
      AND btrim(c.pixel_id) <> ''
    ORDER BY c.created_at ASC
    LIMIT 1;
  END IF;

  -- Meta CAPI: fbc = fb.<subdomainIndex>.<creationTime>.<fbclid>
  IF _lead.click_id IS NOT NULL AND btrim(_lead.click_id) <> '' THEN
    IF _lead.click_id LIKE 'fb.%' THEN
      _fbc := _lead.click_id;
    ELSE
      _fbc := 'fb.1.' || (EXTRACT(EPOCH FROM COALESCE(_lead.created_at, now()))::bigint)::text
              || '.' || btrim(_lead.click_id);
    END IF;
  ELSE
    _fbc := NULL;
  END IF;

  IF _is_paid THEN
    _value := COALESCE(NULLIF(_lead.amount, 0), NULLIF(_lead.deposit_amount, 0), 0);
  ELSE
    _value := NULL;
  END IF;

  _event_id := _lead.id::text || '-' || _event_name;

  INSERT INTO public.capi_outbox (
    lead_id, project_id, cabinet_id,
    event_name, event_id, event_time,
    meta_ad_id, meta_adset_id, meta_campaign_id,
    value, currency,
    raw_user_data,
    status
  ) VALUES (
    _lead.id, _lead.project_id, _cabinet_id,
    _event_name, _event_id, now(),
    _lead.meta_ad_id, _lead.meta_adset_id, _lead.meta_campaign_id,
    _value,
    COALESCE(_currency, 'KZT'),
    jsonb_build_object(
      'phone', _lead.phone,
      'email', _lead.email,
      'name', _lead.name,
      'fbc', _fbc,
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

-- 4) RPC: переотправить skipped/failed после починки Pixel/токена
CREATE OR REPLACE FUNCTION public.requeue_capi_outbox(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id required';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(p_project_id)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.capi_outbox o
  SET
    status = 'pending',
    attempts = 0,
    last_error = NULL,
    -- подтянуть кабинет проекта, если в outbox его не было
    cabinet_id = COALESCE(
      o.cabinet_id,
      (
        SELECT c.id FROM public.ad_cabinets c
        WHERE c.project_id = o.project_id
          AND c.pixel_id IS NOT NULL AND btrim(c.pixel_id) <> ''
        ORDER BY c.created_at ASC
        LIMIT 1
      )
    )
  WHERE o.project_id = p_project_id
    AND o.status IN ('skipped', 'failed');

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.requeue_capi_outbox(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_capi_outbox(uuid) TO service_role;

-- 5) Одноразово вернуть в очередь пропуски из‑за отсутствия pixel/cabinet
UPDATE public.capi_outbox o
SET
  status = 'pending',
  attempts = 0,
  last_error = NULL,
  cabinet_id = COALESCE(
    o.cabinet_id,
    (
      SELECT c.id FROM public.ad_cabinets c
      WHERE c.project_id = o.project_id
        AND c.pixel_id IS NOT NULL AND btrim(c.pixel_id) <> ''
      ORDER BY c.created_at ASC
      LIMIT 1
    )
  )
WHERE o.status = 'skipped'
  AND o.last_error ILIKE 'No pixel_id/access_token%'
  AND o.created_at > now() - interval '30 days';
