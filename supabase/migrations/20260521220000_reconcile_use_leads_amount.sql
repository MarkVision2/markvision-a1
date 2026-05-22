-- Фикс reconcile_cdi_for_project: использовать leads.amount как источник правды
-- (не deals.amount), потому что в CRM пользователь правит сумму в карточке клиента,
-- а deals.amount остаётся со старым значением (запись сделки от moment'a оплаты).
--
-- Кейс пользователя: leads.amount = 800 000, deals.amount = 400 000 (старая запись).
-- Reconcile брал deals.amount и cdi.crm_revenue получалось 400k вместо 800k.

CREATE OR REPLACE FUNCTION public.reconcile_cdi_for_project(
  p_project_id uuid,
  p_since date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since date := COALESCE(p_since, (now() - interval '90 days')::date);
  v_rows_updated int := 0;
  v_orphan_paid int := 0;
  v_orphan_amount numeric := 0;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.user_can_access_project(p_project_id))
  THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Единый источник для amount — leads.amount (карточка клиента, актуальное значение).
  -- Раньше для deals брался d.amount, что приводило к рассинхрону, когда сумму
  -- меняли в CRM-карточке после оплаты — deals.amount оставалась прежней.
  WITH truth AS (
    SELECT l.cabinet_id, l.project_id,
      (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'UTC')::date AS date,
      COUNT(*)::int AS sales,
      SUM(COALESCE(l.amount, d.amount, 0))::numeric AS revenue
    FROM public.deals d
    JOIN public.leads l ON l.id = d.lead_id
    WHERE d.status = 'paid'
      AND l.cabinet_id IS NOT NULL
      AND l.project_id = p_project_id
      AND COALESCE(d.paid_at, d.updated_at)::date >= v_since
      AND COALESCE(d.service_type, '') <> 'diagnostic'
    GROUP BY l.cabinet_id, l.project_id, ((COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'UTC')::date)
    UNION ALL
    SELECT l.cabinet_id, l.project_id,
      (COALESCE(l.paid_at, l.updated_at) AT TIME ZONE 'UTC')::date AS date,
      COUNT(*)::int,
      SUM(COALESCE(l.amount, 0))::numeric
    FROM public.leads l
    WHERE l.paid = true
      AND l.cabinet_id IS NOT NULL
      AND l.project_id = p_project_id
      AND COALESCE(l.paid_at, l.updated_at)::date >= v_since
      AND COALESCE(l.is_personal, false) = false
      AND NOT EXISTS (
        SELECT 1 FROM public.deals d
        WHERE d.lead_id = l.id AND d.status = 'paid'
      )
    GROUP BY l.cabinet_id, l.project_id, ((COALESCE(l.paid_at, l.updated_at) AT TIME ZONE 'UTC')::date)
  ),
  truth_agg AS (
    SELECT cabinet_id, project_id, date,
           SUM(sales)::int AS sales,
           SUM(revenue)::numeric AS revenue
    FROM truth
    GROUP BY cabinet_id, project_id, date
  ),
  ensured AS (
    INSERT INTO public.cabinet_daily_insights (cabinet_id, external_id, project_id, date, crm_sales, crm_revenue, synced_at)
    SELECT t.cabinet_id,
           COALESCE(ac.external_id, ''),
           t.project_id,
           t.date,
           0, 0, now()
    FROM truth_agg t
    LEFT JOIN public.ad_cabinets ac ON ac.id = t.cabinet_id
    ON CONFLICT (cabinet_id, date) DO NOTHING
    RETURNING cabinet_id, date
  ),
  upserted AS (
    UPDATE public.cabinet_daily_insights cdi
       SET crm_sales = t.sales,
           crm_revenue = t.revenue,
           synced_at = now()
      FROM truth_agg t
     WHERE cdi.cabinet_id = t.cabinet_id
       AND cdi.date = t.date
       AND (cdi.crm_sales <> t.sales OR cdi.crm_revenue <> t.revenue)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rows_updated FROM upserted;

  SELECT COUNT(*), COALESCE(SUM(l.amount), 0)
    INTO v_orphan_paid, v_orphan_amount
    FROM public.leads l
   WHERE l.paid = true
     AND l.cabinet_id IS NULL
     AND l.project_id = p_project_id
     AND COALESCE(l.paid_at, l.updated_at)::date >= v_since
     AND COALESCE(l.is_personal, false) = false;

  RETURN jsonb_build_object(
    'ok', true,
    'since', v_since,
    'rows_updated', v_rows_updated,
    'orphan_paid_leads', v_orphan_paid,
    'orphan_revenue', v_orphan_amount
  );
END;
$$;
