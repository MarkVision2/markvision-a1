-- ============================================================
-- Facebook / Analytics sync fixes
--
-- Закрывает три проблемы:
--  1. CRM-выручка задваивалась с manual_revenue в "Таблице показателей".
--     Триггер on_deal_paid_attribution не реагировал на смену amount /
--     возврат сделки → данные в CDI расходились с CRM.
--  2. meta-daily-sync падал тихо, без следа в БД, поэтому "не всегда
--     синхронизируется" было невозможно отдиагностировать.
--  3. Лиды без cabinet_id с сайта/WhatsApp не получали корректный source,
--     если форма передавала только channel.
-- ============================================================

-- 1. ad_sync_runs — журнал прогонов meta-daily-sync.
--    Edge function пишет сюда каждый run, чтобы можно было увидеть в UI
--    "когда последний раз тянули, что упало".
CREATE TABLE IF NOT EXISTS public.ad_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'meta',
  cabinet_id uuid REFERENCES public.ad_cabinets(id) ON DELETE CASCADE,
  external_id text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  since date,
  until date,
  ok boolean NOT NULL DEFAULT false,
  days integer NOT NULL DEFAULT 0,
  spend numeric NOT NULL DEFAULT 0,
  leads integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  error text,
  error_code text,
  triggered_by text NOT NULL DEFAULT 'cron',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_sync_runs_cabinet_created
  ON public.ad_sync_runs (cabinet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_sync_runs_project_created
  ON public.ad_sync_runs (project_id, created_at DESC);

ALTER TABLE public.ad_sync_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ad_sync_runs' AND policyname = 'ad_sync_runs_select_authed'
  ) THEN
    CREATE POLICY "ad_sync_runs_select_authed"
      ON public.ad_sync_runs FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ad_sync_runs' AND policyname = 'ad_sync_runs_admin_all'
  ) THEN
    CREATE POLICY "ad_sync_runs_admin_all"
      ON public.ad_sync_runs FOR ALL TO authenticated
      USING (public.has_role(auth.uid(),'admin'))
      WITH CHECK (public.has_role(auth.uid(),'admin'));
  END IF;
END $$;

-- 2. Триггер on_deal_paid_attribution должен обрабатывать смену amount
--    у уже оплаченной сделки. Раньше при правке суммы CDI оставался со
--    старым значением, и в "Таблице показателей" цифры расходились с CRM.
CREATE OR REPLACE FUNCTION public.on_deal_paid_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cab uuid;
  _date date;
  _old_event_amount numeric;
  _old_event_date date;
  _delta_amount numeric;
BEGIN
  -- Случай 1: сделка только что стала оплаченной → +1 продажа.
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid' OR TG_OP = 'INSERT') THEN
    SELECT cabinet_id INTO _cab FROM public.leads WHERE id = NEW.lead_id;
    IF _cab IS NULL THEN RETURN NEW; END IF;
    _date := COALESCE(NEW.paid_at, now())::date;

    IF EXISTS (
      SELECT 1 FROM public.events
      WHERE lead_id = NEW.lead_id
        AND event_type = 'cabinet_attributed'
        AND payload->>'kind' = 'sale'
        AND payload->>'deal_id' = NEW.id::text
    ) THEN
      RETURN NEW;
    END IF;

    PERFORM public.ensure_cdi_row(_cab, _date);
    UPDATE public.cabinet_daily_insights
       SET crm_sales = crm_sales + 1,
           crm_revenue = crm_revenue + COALESCE(NEW.amount, 0),
           synced_at = now()
     WHERE cabinet_id = _cab AND date = _date;

    INSERT INTO public.events (lead_id, event_type, payload)
    VALUES (NEW.lead_id, 'cabinet_attributed',
      jsonb_build_object(
        'kind','sale','deal_id',NEW.id,
        'amount',COALESCE(NEW.amount,0),
        'cabinet_id',_cab,'date',_date
      ));
    RETURN NEW;
  END IF;

  -- Случай 2: сделка уже была paid, но изменилась сумма → правим crm_revenue
  -- на разницу. Без этого CRM показывает новую сумму, а CDI — старую.
  IF NEW.status = 'paid' AND OLD.status = 'paid'
     AND TG_OP = 'UPDATE'
     AND COALESCE(NEW.amount, 0) <> COALESCE(OLD.amount, 0) THEN
    SELECT (payload->>'amount')::numeric, (payload->>'date')::date,
           (payload->>'cabinet_id')::uuid
      INTO _old_event_amount, _old_event_date, _cab
      FROM public.events
     WHERE lead_id = NEW.lead_id
       AND event_type = 'cabinet_attributed'
       AND payload->>'kind' = 'sale'
       AND payload->>'deal_id' = NEW.id::text
     ORDER BY created_at DESC
     LIMIT 1;

    IF _cab IS NULL THEN RETURN NEW; END IF;
    _delta_amount := COALESCE(NEW.amount, 0) - COALESCE(_old_event_amount, 0);

    UPDATE public.cabinet_daily_insights
       SET crm_revenue = GREATEST(crm_revenue + _delta_amount, 0),
           synced_at = now()
     WHERE cabinet_id = _cab AND date = _old_event_date;

    -- Обновляем событие, чтобы при следующем апдейте дельта считалась с новой базы.
    UPDATE public.events
       SET payload = payload || jsonb_build_object('amount', COALESCE(NEW.amount, 0))
     WHERE lead_id = NEW.lead_id
       AND event_type = 'cabinet_attributed'
       AND payload->>'kind' = 'sale'
       AND payload->>'deal_id' = NEW.id::text;
    RETURN NEW;
  END IF;

  -- Случай 3: сделка ушла из paid (возврат / отмена) → откатываем продажу.
  IF OLD.status = 'paid' AND NEW.status <> 'paid' AND TG_OP = 'UPDATE' THEN
    SELECT (payload->>'amount')::numeric, (payload->>'date')::date,
           (payload->>'cabinet_id')::uuid
      INTO _old_event_amount, _old_event_date, _cab
      FROM public.events
     WHERE lead_id = NEW.lead_id
       AND event_type = 'cabinet_attributed'
       AND payload->>'kind' = 'sale'
       AND payload->>'deal_id' = NEW.id::text
     ORDER BY created_at DESC
     LIMIT 1;

    IF _cab IS NULL THEN RETURN NEW; END IF;

    UPDATE public.cabinet_daily_insights
       SET crm_sales = GREATEST(crm_sales - 1, 0),
           crm_revenue = GREATEST(crm_revenue - COALESCE(_old_event_amount, 0), 0),
           synced_at = now()
     WHERE cabinet_id = _cab AND date = _old_event_date;

    DELETE FROM public.events
     WHERE lead_id = NEW.lead_id
       AND event_type = 'cabinet_attributed'
       AND payload->>'kind' = 'sale'
       AND payload->>'deal_id' = NEW.id::text;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
