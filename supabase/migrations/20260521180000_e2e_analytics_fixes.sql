-- E2E АНАЛИТИКА: фиксы сквозной воронки от рекламы → CRM-этап → таблица показателей.
--
-- Цель: гарантировать, что любая заявка/диагностика/продажа корректно фиксируется
-- по каждому креативу и источнику, без дублей и без потерь.
--
-- Что исправляем:
--   1) on_lead_stage_change_attribution: не дублировать диагностику при движении
--      между разными is_diagnostic стадиями (scheduled → visit → paid считает 1 раз)
--   2) Триггер на UPDATE leads.diagnostic_amount: пересчитать CDI delta, если
--      сумма диагностики изменена после установки этапа.
--   3) Все триггеры используют Asia/Almaty (как view и cabinet_daily_insights).
--   4) Phone attribution: если у лида source='whatsapp', но появилась атрибуция
--      через phone_attribution (meta_ad_id) — пересчитываем source='meta'.
--   5) Расширяем meta_creative_crm_daily: добавляем crm_diagnostic_revenue
--      по креативу — чтобы видеть «выручку за диагностики» по каждому ad_id.
--   6) Cron meta-daily-sync: ежедневно в 00:30 UTC автоматически тянет расходы/
--      лиды/CPL с Meta API в cabinet_daily_insights.

-- =============================================================================
-- 1) on_lead_stage_change_attribution: дедуп per-lead, не per-stage_id
-- =============================================================================
CREATE OR REPLACE FUNCTION public.on_lead_stage_change_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_new_diag boolean;
  _is_old_diag boolean;
  _cab uuid;
  _date date;
  _exists boolean;
  _amount numeric;
BEGIN
  IF NEW.stage_id IS NULL OR NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT is_diagnostic INTO _is_new_diag FROM public.pipeline_stages WHERE id = NEW.stage_id;
  IF NOT COALESCE(_is_new_diag, false) THEN
    RETURN NEW;
  END IF;

  -- Если ПРЕДЫДУЩАЯ стадия тоже была диагностической — это движение ВНУТРИ диаг-воронки
  -- (scheduled → visit → paid). Не дублируем — диагностика уже зафиксирована.
  IF OLD.stage_id IS NOT NULL THEN
    SELECT is_diagnostic INTO _is_old_diag FROM public.pipeline_stages WHERE id = OLD.stage_id;
    IF COALESCE(_is_old_diag, false) THEN
      RETURN NEW;
    END IF;
  END IF;

  _cab := NEW.cabinet_id;
  IF _cab IS NULL THEN
    RETURN NEW;
  END IF;

  -- Используем Asia/Almaty, как в meta_creative_crm_daily и CDI — иначе диагностики
  -- ложатся на «вчера» в UTC, а лид/выручка на «сегодня» в Almaty, и цифры разъезжаются.
  _date := (now() AT TIME ZONE 'Asia/Almaty')::date;

  -- Per-lead идемпотентность: если у лида уже был событийный диагностик — не считаем
  SELECT EXISTS (
    SELECT 1 FROM public.events
    WHERE lead_id = NEW.id
      AND event_type = 'cabinet_attributed'
      AND payload->>'kind' = 'diagnostic'
  ) INTO _exists;
  IF _exists THEN
    RETURN NEW;
  END IF;

  _amount := COALESCE(NEW.diagnostic_amount, 0);

  PERFORM public.ensure_cdi_row(_cab, _date);
  UPDATE public.cabinet_daily_insights
     SET crm_diagnostics = crm_diagnostics + 1,
         crm_diagnostic_revenue = COALESCE(crm_diagnostic_revenue, 0) + _amount,
         synced_at = now()
   WHERE cabinet_id = _cab AND date = _date;

  INSERT INTO public.events (lead_id, event_type, payload)
  VALUES (NEW.id, 'cabinet_attributed',
    jsonb_build_object(
      'kind', 'diagnostic',
      'stage_id', NEW.stage_id,
      'cabinet_id', _cab,
      'date', _date,
      'amount', _amount
    ));

  RETURN NEW;
END;
$$;

-- =============================================================================
-- 2) Триггер на UPDATE leads.diagnostic_amount: пересчёт CDI delta
-- =============================================================================
CREATE OR REPLACE FUNCTION public.on_lead_diagnostic_amount_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event_id uuid;
  _event_date date;
  _event_amount numeric;
  _delta numeric;
  _cab uuid;
BEGIN
  -- Срабатываем только когда diagnostic_amount реально изменился
  IF NEW.diagnostic_amount IS NOT DISTINCT FROM OLD.diagnostic_amount THEN
    RETURN NEW;
  END IF;

  -- Ищем последнее событие 'diagnostic' для этого лида (там зафиксирована сумма и дата CDI)
  SELECT id, (payload->>'date')::date, COALESCE((payload->>'amount')::numeric, 0)
    INTO _event_id, _event_date, _event_amount
    FROM public.events
   WHERE lead_id = NEW.id
     AND event_type = 'cabinet_attributed'
     AND payload->>'kind' = 'diagnostic'
   ORDER BY created_at DESC
   LIMIT 1;

  -- Если диагностика ещё не была зафиксирована — нечего пересчитывать
  IF _event_id IS NULL THEN
    RETURN NEW;
  END IF;

  _cab := COALESCE(NEW.cabinet_id, (SELECT (payload->>'cabinet_id')::uuid FROM public.events WHERE id = _event_id));
  IF _cab IS NULL OR _event_date IS NULL THEN
    RETURN NEW;
  END IF;

  _delta := COALESCE(NEW.diagnostic_amount, 0) - _event_amount;
  IF _delta = 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.cabinet_daily_insights
     SET crm_diagnostic_revenue = GREATEST(COALESCE(crm_diagnostic_revenue, 0) + _delta, 0),
         synced_at = now()
   WHERE cabinet_id = _cab AND date = _event_date;

  -- Обновляем событие, чтобы дальнейшие правки не задвоились
  UPDATE public.events
     SET payload = payload || jsonb_build_object('amount', COALESCE(NEW.diagnostic_amount, 0))
   WHERE id = _event_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_diagnostic_amount_change ON public.leads;
CREATE TRIGGER trg_lead_diagnostic_amount_change
AFTER UPDATE OF diagnostic_amount ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.on_lead_diagnostic_amount_change();

-- =============================================================================
-- 3) Phone attribution: backfill source при появлении meta_ad_id
-- =============================================================================
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

  -- Backfill source у самого лида: если он пришёл с whatsapp, но мы установили
  -- meta_ad_id (т.е. реальный источник — Meta) — пересчитываем source. Без этого
  -- по каналам whatsapp получает заявки, которые на самом деле платные из рекламы.
  IF NEW.source = 'whatsapp' AND NEW.meta_ad_id IS NOT NULL THEN
    UPDATE public.leads SET source = 'meta' WHERE id = NEW.id AND source = 'whatsapp';
  END IF;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- 4) meta_creative_crm_daily v3: добавляем crm_diagnostics + crm_diagnostic_revenue
-- =============================================================================
DROP VIEW IF EXISTS public.meta_creative_crm_daily;
CREATE VIEW public.meta_creative_crm_daily WITH (security_invoker=true) AS
WITH attributed_leads AS (
  SELECT l.id, l.meta_ad_id AS ad_id, l.project_id, l.cabinet_id, l.stage_id,
         l.created_at, l.paid, l.paid_at, l.updated_at, l.amount, l.diagnostic_amount
  FROM public.leads l
  WHERE l.meta_ad_id IS NOT NULL
  UNION ALL
  SELECT l.id, pa.meta_ad_id AS ad_id, l.project_id, COALESCE(l.cabinet_id, pa.cabinet_id),
         l.stage_id, l.created_at, l.paid, l.paid_at, l.updated_at, l.amount, l.diagnostic_amount
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
diagnostic_rows AS (
  -- Диагностики берём из событий cabinet_attributed (источник правды для триггеров),
  -- чтобы view-цифры 1:1 совпадали с CDI.crm_diagnostics.
  SELECT al.ad_id, al.project_id, al.cabinet_id,
         (e.created_at AT TIME ZONE 'Asia/Almaty')::date AS date,
         1 AS crm_diagnostics,
         COALESCE((e.payload->>'amount')::numeric, 0) AS crm_diagnostic_revenue
  FROM public.events e
  JOIN attributed_leads al ON al.id = e.lead_id
  WHERE e.event_type = 'cabinet_attributed'
    AND e.payload->>'kind' = 'diagnostic'
),
diagnostic_days AS (
  SELECT ad_id, project_id, cabinet_id, date,
         SUM(crm_diagnostics)::int AS crm_diagnostics,
         SUM(crm_diagnostic_revenue)::numeric AS crm_diagnostic_revenue
  FROM diagnostic_rows
  GROUP BY ad_id, project_id, cabinet_id, date
),
sale_rows AS (
  SELECT al.ad_id, al.project_id, al.cabinet_id,
         (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'Asia/Almaty')::date AS date,
         1 AS crm_sales, COALESCE(d.amount, 0)::numeric AS crm_revenue
  FROM public.deals d
  JOIN attributed_leads al ON al.id = d.lead_id
  WHERE d.status = 'paid' AND COALESCE(d.service_type, '') <> 'diagnostic'
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
  COALESCE(ld.ad_id, sd.ad_id, dd.ad_id) AS ad_id,
  COALESCE(ld.project_id, sd.project_id, dd.project_id) AS project_id,
  COALESCE(ld.cabinet_id, sd.cabinet_id, dd.cabinet_id) AS cabinet_id,
  COALESCE(ld.date, sd.date, dd.date) AS date,
  COALESCE(ld.crm_leads, 0) AS crm_leads,
  COALESCE(ld.crm_qualified, 0) AS crm_qualified,
  COALESCE(dd.crm_diagnostics, 0) AS crm_diagnostics,
  COALESCE(dd.crm_diagnostic_revenue, 0::numeric) AS crm_diagnostic_revenue,
  CASE WHEN mo.manual_sales_total > 0 THEN mo.manual_sales_total
       ELSE COALESCE(sd.crm_sales, 0) END AS crm_sales,
  CASE WHEN mo.manual_revenue_total > 0 THEN mo.manual_revenue_total
       ELSE COALESCE(sd.crm_revenue, 0::numeric) END AS crm_revenue
FROM lead_days ld
FULL JOIN sale_days sd
  ON ld.ad_id = sd.ad_id
  AND ld.project_id IS NOT DISTINCT FROM sd.project_id
  AND ld.date = sd.date
FULL JOIN diagnostic_days dd
  ON dd.ad_id = COALESCE(ld.ad_id, sd.ad_id)
  AND dd.project_id IS NOT DISTINCT FROM COALESCE(ld.project_id, sd.project_id)
  AND dd.date = COALESCE(ld.date, sd.date)
LEFT JOIN manual_overrides mo
  ON mo.cabinet_id = COALESCE(ld.cabinet_id, sd.cabinet_id, dd.cabinet_id)
  AND mo.date = COALESCE(ld.date, sd.date, dd.date);

GRANT SELECT ON public.meta_creative_crm_daily TO authenticated;

-- =============================================================================
-- 5) Cron для meta-daily-sync: ежедневная синхронизация расходов/лидов/CPL
-- =============================================================================
-- 00:30 UTC = 05:30 Almaty time — оптимально, чтобы к утру в Дашборде уже была
-- свежая вчерашняя статистика. meta-structure-sync запускается в 01:30 UTC ниже.
SELECT cron.unschedule('meta-daily-sync-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-daily-sync-daily');

SELECT cron.schedule(
  'meta-daily-sync-daily',
  '30 0 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://mekwfbqmsqiborjdrjxc.supabase.co/functions/v1/meta-daily-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- =============================================================================
-- 6) Бэкфилл диагностических событий: для существующих лидов в is_diagnostic
--    стадии, у которых нет события 'diagnostic' — создаём идемпотентно.
-- =============================================================================
DO $$
DECLARE
  r record;
  _date date;
  _exists boolean;
BEGIN
  FOR r IN
    SELECT lsh.lead_id,
           lsh.to_stage_id AS stage_id,
           lsh.changed_at,
           l.cabinet_id,
           COALESCE(l.diagnostic_amount, 0) AS amount,
           ROW_NUMBER() OVER (PARTITION BY lsh.lead_id ORDER BY lsh.changed_at) AS rn
    FROM public.lead_status_history lsh
    JOIN public.pipeline_stages ps ON ps.id = lsh.to_stage_id
    JOIN public.leads l ON l.id = lsh.lead_id
    LEFT JOIN public.pipeline_stages ps_from ON ps_from.id = lsh.from_stage_id
    WHERE ps.is_diagnostic = true
      AND COALESCE(ps_from.is_diagnostic, false) = false  -- ПЕРВЫЙ вход в диаг-воронку
      AND l.cabinet_id IS NOT NULL
    ORDER BY lsh.lead_id, lsh.changed_at
  LOOP
    IF r.rn > 1 THEN CONTINUE; END IF;  -- только первый вход на лида

    SELECT EXISTS (
      SELECT 1 FROM public.events
      WHERE lead_id = r.lead_id
        AND event_type = 'cabinet_attributed'
        AND payload->>'kind' = 'diagnostic'
    ) INTO _exists;
    IF _exists THEN CONTINUE; END IF;

    _date := (r.changed_at AT TIME ZONE 'Asia/Almaty')::date;
    INSERT INTO public.events (lead_id, event_type, payload)
    VALUES (r.lead_id, 'cabinet_attributed',
      jsonb_build_object('kind','diagnostic','stage_id',r.stage_id,'cabinet_id',r.cabinet_id,
                         'date',_date,'amount',r.amount,'backfill',true));
  END LOOP;
END $$;
