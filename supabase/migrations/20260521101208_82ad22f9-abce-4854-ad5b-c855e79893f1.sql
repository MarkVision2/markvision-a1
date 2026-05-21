
-- 1. wa_clicks: клики по WhatsApp-кнопкам сайта (pixel → leads bridge)
CREATE TABLE IF NOT EXISTS public.wa_clicks (
  click_id text PRIMARY KEY,
  project_id uuid,
  fbclid text,
  ctwa_clid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_url text,
  matched boolean NOT NULL DEFAULT false,
  matched_phone text,
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_clicks_phone ON public.wa_clicks(matched_phone) WHERE matched_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_clicks_fbclid ON public.wa_clicks(fbclid) WHERE fbclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_clicks_project ON public.wa_clicks(project_id, created_at DESC);

ALTER TABLE public.wa_clicks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_clicks_select ON public.wa_clicks;
CREATE POLICY wa_clicks_select ON public.wa_clicks FOR SELECT TO authenticated
  USING (project_id IS NULL OR public.user_can_access_project(project_id) OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS wa_clicks_admin_write ON public.wa_clicks;
CREATE POLICY wa_clicks_admin_write ON public.wa_clicks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. phone_attribution: «прилипает» креатив к телефону
CREATE TABLE IF NOT EXISTS public.phone_attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  project_id uuid,
  meta_ad_id text,
  meta_adset_id text,
  meta_campaign_id text,
  cabinet_id uuid,
  click_id text,
  source text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_phone_attribution ON public.phone_attribution(phone, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_phone_attribution_captured ON public.phone_attribution(captured_at DESC);

ALTER TABLE public.phone_attribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phone_attr_select ON public.phone_attribution;
CREATE POLICY phone_attr_select ON public.phone_attribution FOR SELECT TO authenticated
  USING (project_id IS NULL OR public.user_can_access_project(project_id) OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS phone_attr_admin_write ON public.phone_attribution;
CREATE POLICY phone_attr_admin_write ON public.phone_attribution FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Триггер: при появлении meta_ad_id у лида — сохраняем в phone_attribution
CREATE OR REPLACE FUNCTION public.trg_lead_capture_phone_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
BEGIN
  IF NEW.meta_ad_id IS NULL OR NEW.phone IS NULL THEN
    RETURN NEW;
  END IF;
  v_norm := public.normalize_phone(NEW.phone);
  IF v_norm = '' THEN RETURN NEW; END IF;

  INSERT INTO public.phone_attribution
    (phone, project_id, meta_ad_id, meta_adset_id, meta_campaign_id, cabinet_id, click_id, source, captured_at, updated_at)
  VALUES
    (v_norm, NEW.project_id, NEW.meta_ad_id, NEW.meta_adset_id, NEW.meta_campaign_id, NEW.cabinet_id, NEW.click_id, NEW.source, now(), now())
  ON CONFLICT (phone, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    meta_ad_id = COALESCE(EXCLUDED.meta_ad_id, public.phone_attribution.meta_ad_id),
    meta_adset_id = COALESCE(EXCLUDED.meta_adset_id, public.phone_attribution.meta_adset_id),
    meta_campaign_id = COALESCE(EXCLUDED.meta_campaign_id, public.phone_attribution.meta_campaign_id),
    cabinet_id = COALESCE(EXCLUDED.cabinet_id, public.phone_attribution.cabinet_id),
    click_id = COALESCE(EXCLUDED.click_id, public.phone_attribution.click_id),
    source = COALESCE(EXCLUDED.source, public.phone_attribution.source),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_capture_phone_attr ON public.leads;
CREATE TRIGGER trg_leads_capture_phone_attr
AFTER INSERT OR UPDATE OF meta_ad_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trg_lead_capture_phone_attribution();

-- 4. Backfill RPC: подтянуть meta_ad_id для существующих лидов из wa_clicks/phone_attribution
CREATE OR REPLACE FUNCTION public.backfill_lead_attribution(p_project_id uuid, p_since date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since date := COALESCE(p_since, (now() - interval '90 days')::date);
  v_total int := 0;
  v_via_attr int := 0;
  v_via_clicks int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.user_can_access_project(p_project_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- A) через phone_attribution: для лидов без meta_ad_id, у которых телефон уже атрибутирован
  WITH cand AS (
    SELECT l.id, pa.meta_ad_id, pa.meta_adset_id, pa.meta_campaign_id, pa.cabinet_id, pa.click_id
    FROM public.leads l
    JOIN public.phone_attribution pa
      ON pa.phone = public.normalize_phone(l.phone)
     AND (pa.project_id IS NULL OR pa.project_id = l.project_id)
    WHERE l.meta_ad_id IS NULL
      AND l.project_id = p_project_id
      AND l.created_at >= v_since
      AND pa.meta_ad_id IS NOT NULL
  )
  UPDATE public.leads l
     SET meta_ad_id = c.meta_ad_id,
         meta_adset_id = COALESCE(l.meta_adset_id, c.meta_adset_id),
         meta_campaign_id = COALESCE(l.meta_campaign_id, c.meta_campaign_id),
         cabinet_id = COALESCE(l.cabinet_id, c.cabinet_id),
         click_id = COALESCE(l.click_id, c.click_id),
         source = CASE WHEN l.source = 'whatsapp' THEN 'meta' ELSE l.source END
    FROM cand c
   WHERE l.id = c.id;
  GET DIAGNOSTICS v_via_attr = ROW_COUNT;

  -- B) через wa_clicks (matched_phone): сайт-пиксель зафиксировал клик до WA-сообщения
  WITH cand AS (
    SELECT DISTINCT ON (l.id) l.id, wc.utm_content AS meta_ad_id, wc.utm_term AS meta_adset_id,
           wc.utm_campaign AS meta_campaign_id, wc.click_id
    FROM public.leads l
    JOIN public.wa_clicks wc
      ON public.normalize_phone(wc.matched_phone) = public.normalize_phone(l.phone)
    WHERE l.meta_ad_id IS NULL
      AND l.project_id = p_project_id
      AND l.created_at >= v_since
      AND wc.utm_content ~ '^[0-9]{6,}$'
    ORDER BY l.id, wc.created_at DESC
  )
  UPDATE public.leads l
     SET meta_ad_id = c.meta_ad_id,
         meta_adset_id = COALESCE(l.meta_adset_id, c.meta_adset_id),
         meta_campaign_id = COALESCE(l.meta_campaign_id, c.meta_campaign_id),
         click_id = COALESCE(l.click_id, c.click_id),
         source = CASE WHEN l.source = 'whatsapp' THEN 'meta' ELSE l.source END
    FROM cand c
   WHERE l.id = c.id;
  GET DIAGNOSTICS v_via_clicks = ROW_COUNT;

  v_total := v_via_attr + v_via_clicks;
  RETURN jsonb_build_object('ok', true, 'attributed', v_total, 'via_phone_attribution', v_via_attr, 'via_wa_clicks', v_via_clicks);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.backfill_lead_attribution(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_lead_attribution(uuid, date) TO authenticated;

-- 5. Обновляем view meta_creative_crm_daily: учитываем атрибуцию по phone
DROP VIEW IF EXISTS public.meta_creative_crm_daily;
CREATE VIEW public.meta_creative_crm_daily WITH (security_invoker=true) AS
WITH attributed_leads AS (
  -- Прямая атрибуция через meta_ad_id
  SELECT l.id, l.meta_ad_id AS ad_id, l.project_id, l.cabinet_id, l.stage_id,
         l.created_at, l.paid, l.paid_at, l.updated_at, l.amount
  FROM public.leads l
  WHERE l.meta_ad_id IS NOT NULL
  UNION ALL
  -- Косвенная: лид без meta_ad_id, но телефон есть в phone_attribution
  SELECT l.id, pa.meta_ad_id AS ad_id, l.project_id, COALESCE(l.cabinet_id, pa.cabinet_id),
         l.stage_id, l.created_at, l.paid, l.paid_at, l.updated_at, l.amount
  FROM public.leads l
  JOIN public.phone_attribution pa
    ON pa.phone = public.normalize_phone(l.phone)
   AND (pa.project_id IS NULL OR pa.project_id = l.project_id)
  WHERE l.meta_ad_id IS NULL
    AND pa.meta_ad_id IS NOT NULL
),
lead_days AS (
  SELECT al.ad_id, al.project_id, al.cabinet_id,
         (al.created_at AT TIME ZONE 'Asia/Almaty')::date AS date,
         COUNT(*)::int AS crm_leads,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.pipeline_stages ps
           WHERE ps.id = al.stage_id AND ps.is_diagnostic = true
         ))::int AS crm_qualified
  FROM attributed_leads al
  GROUP BY al.ad_id, al.project_id, al.cabinet_id, ((al.created_at AT TIME ZONE 'Asia/Almaty')::date)
),
sale_rows AS (
  SELECT al.ad_id, al.project_id, al.cabinet_id,
         (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'Asia/Almaty')::date AS date,
         1 AS crm_sales, COALESCE(d.amount, 0)::numeric AS crm_revenue
  FROM public.deals d
  JOIN attributed_leads al ON al.id = d.lead_id
  WHERE d.status = 'paid'
  UNION ALL
  SELECT al.ad_id, al.project_id, al.cabinet_id,
         (COALESCE(al.paid_at, al.updated_at) AT TIME ZONE 'Asia/Almaty')::date,
         1, COALESCE(al.amount, 0)::numeric
  FROM attributed_leads al
  WHERE al.paid = true
    AND NOT EXISTS (
      SELECT 1 FROM public.deals d2
      WHERE d2.lead_id = al.id AND d2.status = 'paid'
    )
),
sale_days AS (
  SELECT ad_id, project_id, cabinet_id, date,
         SUM(crm_sales)::int AS crm_sales,
         SUM(crm_revenue)::numeric AS crm_revenue
  FROM sale_rows
  GROUP BY ad_id, project_id, cabinet_id, date
),
manual_overrides AS (
  SELECT cabinet_id, date,
         SUM(GREATEST(manual_revenue, 0))::numeric AS manual_revenue_total,
         SUM(GREATEST(manual_sales, 0))::int AS manual_sales_total
  FROM public.cabinet_daily_insights
  WHERE manual_revenue > 0 OR manual_sales > 0
  GROUP BY cabinet_id, date
)
SELECT
  COALESCE(ld.ad_id, sd.ad_id) AS ad_id,
  COALESCE(ld.project_id, sd.project_id) AS project_id,
  COALESCE(ld.cabinet_id, sd.cabinet_id) AS cabinet_id,
  COALESCE(ld.date, sd.date) AS date,
  COALESCE(ld.crm_leads, 0) AS crm_leads,
  COALESCE(ld.crm_qualified, 0) AS crm_qualified,
  CASE WHEN mo.manual_sales_total > 0 THEN mo.manual_sales_total
       ELSE COALESCE(sd.crm_sales, 0) END AS crm_sales,
  CASE WHEN mo.manual_revenue_total > 0 THEN mo.manual_revenue_total
       ELSE COALESCE(sd.crm_revenue, 0::numeric) END AS crm_revenue
FROM lead_days ld
FULL JOIN sale_days sd
  ON ld.ad_id = sd.ad_id
  AND ld.project_id IS NOT DISTINCT FROM sd.project_id
  AND ld.date = sd.date
LEFT JOIN manual_overrides mo
  ON mo.cabinet_id = COALESCE(ld.cabinet_id, sd.cabinet_id)
  AND mo.date = COALESCE(ld.date, sd.date);

GRANT SELECT ON public.meta_creative_crm_daily TO authenticated;

-- 6. Бэкфилл phone_attribution из уже существующих атрибутированных лидов
INSERT INTO public.phone_attribution (phone, project_id, meta_ad_id, meta_adset_id, meta_campaign_id, cabinet_id, click_id, source, captured_at, updated_at)
SELECT DISTINCT ON (public.normalize_phone(l.phone), l.project_id)
  public.normalize_phone(l.phone), l.project_id, l.meta_ad_id, l.meta_adset_id,
  l.meta_campaign_id, l.cabinet_id, l.click_id, l.source, l.created_at, now()
FROM public.leads l
WHERE l.meta_ad_id IS NOT NULL
  AND public.normalize_phone(l.phone) <> ''
ORDER BY public.normalize_phone(l.phone), l.project_id, l.created_at DESC
ON CONFLICT (phone, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
