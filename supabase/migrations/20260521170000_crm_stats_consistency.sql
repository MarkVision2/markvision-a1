-- Цель: гарантировать целостность CRM-статистики и упростить отладку, когда
-- количество продаж/выручка не совпадают между CRM, Dashboard, Reports, Metrics.
--
-- Что добавляем:
--  1) view `crm_stats_health` — показывает расхождения CRM (источник правды)
--     и CDI (агрегат), плюс orphan-продажи (без cabinet_id).
--  2) RPC `reconcile_cdi_for_project(p_project_id, p_since)` — пересчитывает
--     crm_sales/crm_revenue в CDI заново из deals+leads. Идёт в обход триггеров,
--     поэтому покрывает все edge-cases (cabinet_id присвоен после оплаты,
--     leads.paid=true без deal, удалённые сделки и т.д.)
--  3) Триггер на UPDATE leads.cabinet_id — если у уже оплаченного лида
--     меняется cabinet_id, переносим продажу в правильный CDI-ряд.

-- =============================================================================
-- 1) View: расхождения между CRM и CDI
-- =============================================================================
DROP VIEW IF EXISTS public.crm_stats_health;
CREATE VIEW public.crm_stats_health WITH (security_invoker=true) AS
WITH crm_sales AS (
  SELECT
    l.project_id,
    l.cabinet_id,
    (COALESCE(l.paid_at, l.updated_at) AT TIME ZONE 'UTC')::date AS date,
    COUNT(*)::int AS crm_paid_leads,
    SUM(COALESCE(l.amount, 0))::numeric AS crm_paid_amount
  FROM public.leads l
  WHERE l.paid = true
    AND COALESCE(l.is_personal, false) = false
  GROUP BY l.project_id, l.cabinet_id, ((COALESCE(l.paid_at, l.updated_at) AT TIME ZONE 'UTC')::date)
),
cdi_sales AS (
  SELECT
    project_id,
    cabinet_id,
    date,
    COALESCE(SUM(crm_sales), 0)::int AS cdi_crm_sales,
    COALESCE(SUM(crm_revenue), 0)::numeric AS cdi_crm_revenue,
    COALESCE(SUM(manual_sales), 0)::int AS cdi_manual_sales,
    COALESCE(SUM(manual_revenue), 0)::numeric AS cdi_manual_revenue
  FROM public.cabinet_daily_insights
  GROUP BY project_id, cabinet_id, date
)
SELECT
  COALESCE(c.project_id, d.project_id) AS project_id,
  COALESCE(c.cabinet_id, d.cabinet_id) AS cabinet_id,
  COALESCE(c.date, d.date) AS date,
  COALESCE(c.crm_paid_leads, 0) AS crm_paid_leads,
  COALESCE(d.cdi_crm_sales, 0) AS cdi_crm_sales,
  COALESCE(d.cdi_manual_sales, 0) AS cdi_manual_sales,
  COALESCE(c.crm_paid_amount, 0) AS crm_paid_amount,
  COALESCE(d.cdi_crm_revenue, 0) AS cdi_crm_revenue,
  COALESCE(d.cdi_manual_revenue, 0) AS cdi_manual_revenue,
  -- delta показывает, на сколько CDI отстаёт от CRM (если >0 — есть потерянные продажи)
  COALESCE(c.crm_paid_leads, 0) - COALESCE(d.cdi_crm_sales, 0) AS sales_delta,
  COALESCE(c.crm_paid_amount, 0) - COALESCE(d.cdi_crm_revenue, 0) AS revenue_delta,
  -- помощь в диагностике: orphan = лид без cabinet_id, manual покрывает = manual_sales есть
  (c.cabinet_id IS NULL) AS is_orphan,
  (COALESCE(d.cdi_manual_sales, 0) > 0) AS has_manual_override
FROM crm_sales c
FULL OUTER JOIN cdi_sales d
  ON c.cabinet_id IS NOT DISTINCT FROM d.cabinet_id
 AND c.project_id IS NOT DISTINCT FROM d.project_id
 AND c.date = d.date;

GRANT SELECT ON public.crm_stats_health TO authenticated;

COMMENT ON VIEW public.crm_stats_health IS
  'Сравнение CRM (leads.paid=true) и CDI (cabinet_daily_insights.crm_sales). '
  'sales_delta > 0 означает потерянные в CDI продажи. is_orphan=true — лид '
  'без cabinet_id, его CDI-ряд отсутствует (используем orphan-логику в UI).';

-- =============================================================================
-- 2) Reconcile: пересчёт CDI для проекта за период
-- =============================================================================
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
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.user_can_access_project(p_project_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Считаем «правду» из leads+deals и переписываем crm_sales/crm_revenue в CDI.
  -- Manual override (manual_sales/manual_revenue) НЕ трогаем — пользовательский ввод.
  WITH truth AS (
    -- Источник 1: paid deals (приоритет, если есть)
    SELECT
      l.cabinet_id,
      l.project_id,
      (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'UTC')::date AS date,
      COUNT(*)::int AS sales,
      SUM(COALESCE(d.amount, 0))::numeric AS revenue
    FROM public.deals d
    JOIN public.leads l ON l.id = d.lead_id
    WHERE d.status = 'paid'
      AND l.cabinet_id IS NOT NULL
      AND l.project_id = p_project_id
      AND COALESCE(d.paid_at, d.updated_at)::date >= v_since
      AND COALESCE(d.service_type, '') <> 'diagnostic'
    GROUP BY l.cabinet_id, l.project_id, ((COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'UTC')::date)
    UNION ALL
    -- Источник 2: leads.paid=true без paid deal (fallback)
    SELECT
      l.cabinet_id,
      l.project_id,
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
    -- Создаём строки CDI, если их ещё нет
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

  -- Считаем orphan для информации (их в CDI нет принципиально — у них нет cabinet_id)
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
    'orphan_revenue', v_orphan_amount,
    'note', 'Orphan-продажи (без cabinet_id) не учитываются в CDI — они отображаются на Dashboard/Analytics/Reports/Metrics через UI-логику.'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_cdi_for_project(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_cdi_for_project(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.reconcile_cdi_for_project IS
  'Пересчитывает crm_sales/crm_revenue в cabinet_daily_insights для проекта за период '
  '(по умолчанию 90 дней). Используется, когда триггеры не сработали (например, '
  'cabinet_id назначен после оплаты, или произошёл откат деал-статуса).';

-- =============================================================================
-- 3) Триггер: если у оплаченного лида меняется cabinet_id — переносим CDI
-- =============================================================================
CREATE OR REPLACE FUNCTION public.on_lead_cabinet_change_reattribute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _date date;
  _amount numeric;
BEGIN
  -- Только если cabinet_id реально изменился
  IF NEW.cabinet_id IS NOT DISTINCT FROM OLD.cabinet_id THEN
    RETURN NEW;
  END IF;

  -- Если лид не оплачен — ничего не делаем
  IF NEW.paid IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  _amount := COALESCE(NEW.amount, 0);
  _date := COALESCE(NEW.paid_at, NEW.updated_at, now())::date;

  -- Из старого кабинета — вычитаем
  IF OLD.cabinet_id IS NOT NULL THEN
    UPDATE public.cabinet_daily_insights
       SET crm_sales = GREATEST(crm_sales - 1, 0),
           crm_revenue = GREATEST(crm_revenue - _amount, 0),
           synced_at = now()
     WHERE cabinet_id = OLD.cabinet_id AND date = _date;
  END IF;

  -- В новый — прибавляем (если задан)
  IF NEW.cabinet_id IS NOT NULL THEN
    PERFORM public.ensure_cdi_row(NEW.cabinet_id, _date);
    UPDATE public.cabinet_daily_insights
       SET crm_sales = crm_sales + 1,
           crm_revenue = crm_revenue + _amount,
           synced_at = now()
     WHERE cabinet_id = NEW.cabinet_id AND date = _date;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_cabinet_change_reattribute ON public.leads;
CREATE TRIGGER trg_lead_cabinet_change_reattribute
AFTER UPDATE OF cabinet_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.on_lead_cabinet_change_reattribute();

-- =============================================================================
-- 4) Триггер: если leads.paid поменялся напрямую (без deal-записи) — апдейтим CDI
-- =============================================================================
CREATE OR REPLACE FUNCTION public.on_lead_paid_change_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _date date;
  _amount numeric;
  _has_paid_deal boolean;
BEGIN
  -- Только реальные переходы paid: false → true
  IF NEW.paid IS NOT TRUE OR OLD.paid IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Если для лида уже есть paid deal — CDI обновит on_deal_paid_attribution, не дублируем
  SELECT EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.lead_id = NEW.id AND d.status = 'paid'
  ) INTO _has_paid_deal;
  IF _has_paid_deal THEN
    RETURN NEW;
  END IF;

  -- Лид без cabinet_id — orphan, в CDI не пишем (учитывается через UI)
  IF NEW.cabinet_id IS NULL THEN
    RETURN NEW;
  END IF;

  _amount := COALESCE(NEW.amount, 0);
  _date := COALESCE(NEW.paid_at, now())::date;

  PERFORM public.ensure_cdi_row(NEW.cabinet_id, _date);
  UPDATE public.cabinet_daily_insights
     SET crm_sales = crm_sales + 1,
         crm_revenue = crm_revenue + _amount,
         synced_at = now()
   WHERE cabinet_id = NEW.cabinet_id AND date = _date;

  INSERT INTO public.events (lead_id, event_type, payload)
  VALUES (NEW.id, 'cabinet_attributed',
    jsonb_build_object(
      'kind', 'sale',
      'source', 'leads_paid_trigger',
      'amount', _amount,
      'cabinet_id', NEW.cabinet_id,
      'date', _date
    ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_paid_change_attribution ON public.leads;
CREATE TRIGGER trg_lead_paid_change_attribution
AFTER UPDATE OF paid ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.on_lead_paid_change_attribution();
