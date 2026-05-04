
-- 1. cabinet_id на лидах
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS cabinet_id uuid;
CREATE INDEX IF NOT EXISTS idx_leads_cabinet_id ON public.leads(cabinet_id);

-- 2. is_diagnostic у этапов воронки
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS is_diagnostic boolean NOT NULL DEFAULT false;

-- 3. CRM-поля в дневной статистике кабинетов
ALTER TABLE public.cabinet_daily_insights
  ADD COLUMN IF NOT EXISTS crm_diagnostics integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_diagnostics integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crm_sales integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crm_revenue numeric NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cabinet_daily_insights_cab_date
  ON public.cabinet_daily_insights(cabinet_id, date);

-- 4. Хелпер: гарантирует наличие строки cabinet_daily_insights для (cabinet_id, date)
CREATE OR REPLACE FUNCTION public.ensure_cdi_row(_cabinet_id uuid, _date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ext text;
  _project uuid;
BEGIN
  IF _cabinet_id IS NULL OR _date IS NULL THEN
    RETURN;
  END IF;
  SELECT external_id, project_id INTO _ext, _project
  FROM public.ad_cabinets WHERE id = _cabinet_id;
  INSERT INTO public.cabinet_daily_insights (cabinet_id, external_id, project_id, date)
  VALUES (_cabinet_id, COALESCE(_ext, ''), _project, _date)
  ON CONFLICT (cabinet_id, date) DO NOTHING;
END;
$$;

-- 5. Триггер: лид переходит в стадию-диагностику → +1 crm_diagnostics
CREATE OR REPLACE FUNCTION public.on_lead_stage_change_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_diag boolean;
  _cab uuid;
  _date date;
  _exists boolean;
BEGIN
  IF NEW.stage_id IS NULL OR NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT is_diagnostic INTO _is_diag FROM public.pipeline_stages WHERE id = NEW.stage_id;
  IF NOT COALESCE(_is_diag, false) THEN
    RETURN NEW;
  END IF;

  _cab := NEW.cabinet_id;
  IF _cab IS NULL THEN
    RETURN NEW;
  END IF;

  _date := (now() AT TIME ZONE 'UTC')::date;

  -- Идемпотентность: проверяем, что для этого лида и этой стадии диагностика уже не учтена
  SELECT EXISTS (
    SELECT 1 FROM public.events
    WHERE lead_id = NEW.id
      AND event_type = 'cabinet_attributed'
      AND payload->>'kind' = 'diagnostic'
      AND payload->>'stage_id' = NEW.stage_id::text
  ) INTO _exists;

  IF _exists THEN
    RETURN NEW;
  END IF;

  PERFORM public.ensure_cdi_row(_cab, _date);
  UPDATE public.cabinet_daily_insights
     SET crm_diagnostics = crm_diagnostics + 1,
         synced_at = now()
   WHERE cabinet_id = _cab AND date = _date;

  INSERT INTO public.events (lead_id, event_type, payload)
  VALUES (NEW.id, 'cabinet_attributed',
    jsonb_build_object(
      'kind', 'diagnostic',
      'stage_id', NEW.stage_id,
      'cabinet_id', _cab,
      'date', _date
    ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_stage_attribution ON public.leads;
CREATE TRIGGER leads_stage_attribution
AFTER UPDATE OF stage_id ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.on_lead_stage_change_attribution();

-- 6. Триггер: сделка стала paid → +1 crm_sales, + amount crm_revenue
CREATE OR REPLACE FUNCTION public.on_deal_paid_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cab uuid;
  _date date;
  _exists boolean;
BEGIN
  IF NEW.status <> 'paid' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'paid' THEN
    RETURN NEW;
  END IF;

  SELECT cabinet_id INTO _cab FROM public.leads WHERE id = NEW.lead_id;
  IF _cab IS NULL THEN
    RETURN NEW;
  END IF;

  _date := COALESCE(NEW.paid_at, now())::date;

  SELECT EXISTS (
    SELECT 1 FROM public.events
    WHERE lead_id = NEW.lead_id
      AND event_type = 'cabinet_attributed'
      AND payload->>'kind' = 'sale'
      AND payload->>'deal_id' = NEW.id::text
  ) INTO _exists;

  IF _exists THEN
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
      'kind', 'sale',
      'deal_id', NEW.id,
      'amount', NEW.amount,
      'cabinet_id', _cab,
      'date', _date
    ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_paid_attribution ON public.deals;
CREATE TRIGGER deals_paid_attribution
AFTER INSERT OR UPDATE OF status, paid_at, amount ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.on_deal_paid_attribution();

-- 7. Бэкфилл: пересчёт текущих данных
DO $$
DECLARE
  r record;
  _date date;
  _exists boolean;
BEGIN
  -- Бэкфилл диагностик: для каждого перехода в is_diagnostic стадию
  FOR r IN
    SELECT lsh.lead_id, lsh.to_stage_id AS stage_id, lsh.changed_at, l.cabinet_id
    FROM public.lead_status_history lsh
    JOIN public.pipeline_stages ps ON ps.id = lsh.to_stage_id
    JOIN public.leads l ON l.id = lsh.lead_id
    WHERE ps.is_diagnostic = true AND l.cabinet_id IS NOT NULL
    ORDER BY lsh.changed_at
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.events
      WHERE lead_id = r.lead_id
        AND event_type = 'cabinet_attributed'
        AND payload->>'kind' = 'diagnostic'
        AND payload->>'stage_id' = r.stage_id::text
    ) INTO _exists;
    IF _exists THEN CONTINUE; END IF;
    _date := r.changed_at::date;
    PERFORM public.ensure_cdi_row(r.cabinet_id, _date);
    UPDATE public.cabinet_daily_insights
       SET crm_diagnostics = crm_diagnostics + 1
     WHERE cabinet_id = r.cabinet_id AND date = _date;
    INSERT INTO public.events (lead_id, event_type, payload)
    VALUES (r.lead_id, 'cabinet_attributed',
      jsonb_build_object('kind','diagnostic','stage_id',r.stage_id,'cabinet_id',r.cabinet_id,'date',_date,'backfill',true));
  END LOOP;

  -- Бэкфилл продаж
  FOR r IN
    SELECT d.id AS deal_id, d.lead_id, d.amount, d.paid_at, l.cabinet_id
    FROM public.deals d
    JOIN public.leads l ON l.id = d.lead_id
    WHERE d.status = 'paid' AND l.cabinet_id IS NOT NULL
    ORDER BY d.paid_at
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.events
      WHERE lead_id = r.lead_id
        AND event_type = 'cabinet_attributed'
        AND payload->>'kind' = 'sale'
        AND payload->>'deal_id' = r.deal_id::text
    ) INTO _exists;
    IF _exists THEN CONTINUE; END IF;
    _date := COALESCE(r.paid_at, now())::date;
    PERFORM public.ensure_cdi_row(r.cabinet_id, _date);
    UPDATE public.cabinet_daily_insights
       SET crm_sales = crm_sales + 1,
           crm_revenue = crm_revenue + COALESCE(r.amount, 0)
     WHERE cabinet_id = r.cabinet_id AND date = _date;
    INSERT INTO public.events (lead_id, event_type, payload)
    VALUES (r.lead_id, 'cabinet_attributed',
      jsonb_build_object('kind','sale','deal_id',r.deal_id,'amount',r.amount,'cabinet_id',r.cabinet_id,'date',_date,'backfill',true));
  END LOOP;
END $$;

-- 8. Realtime для cabinet_daily_insights
ALTER TABLE public.cabinet_daily_insights REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cabinet_daily_insights'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cabinet_daily_insights';
  END IF;
END $$;
