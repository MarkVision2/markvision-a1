
ALTER TABLE public.cabinet_daily_insights
  ADD COLUMN IF NOT EXISTS crm_diagnostic_revenue numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_diagnostic_revenue numeric NOT NULL DEFAULT 0;

-- Триггер: при создании платной "diagnostic" сделки (deals.service_type='diagnostic'
-- и status='paid') добавляем сумму в CDI.crm_diagnostic_revenue идемпотентно.
CREATE OR REPLACE FUNCTION public.on_diagnostic_paid_attribution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cab uuid;
  _date date;
  _exists boolean;
BEGIN
  IF COALESCE(NEW.service_type, '') <> 'diagnostic' THEN RETURN NEW; END IF;
  IF NEW.status <> 'paid' THEN RETURN NEW; END IF;
  IF OLD.status = 'paid' AND COALESCE(OLD.service_type,'') = 'diagnostic' THEN RETURN NEW; END IF;

  SELECT cabinet_id INTO _cab FROM public.leads WHERE id = NEW.lead_id;
  IF _cab IS NULL THEN RETURN NEW; END IF;

  _date := COALESCE(NEW.paid_at, now())::date;

  SELECT EXISTS (
    SELECT 1 FROM public.events
    WHERE lead_id = NEW.lead_id
      AND event_type = 'cabinet_attributed'
      AND payload->>'kind' = 'diagnostic_paid'
      AND payload->>'deal_id' = NEW.id::text
  ) INTO _exists;
  IF _exists THEN RETURN NEW; END IF;

  PERFORM public.ensure_cdi_row(_cab, _date);
  UPDATE public.cabinet_daily_insights
     SET crm_diagnostic_revenue = crm_diagnostic_revenue + COALESCE(NEW.amount, 0),
         synced_at = now()
   WHERE cabinet_id = _cab AND date = _date;

  INSERT INTO public.events (lead_id, event_type, payload)
  VALUES (NEW.lead_id, 'cabinet_attributed',
    jsonb_build_object(
      'kind', 'diagnostic_paid',
      'deal_id', NEW.id,
      'amount', NEW.amount,
      'cabinet_id', _cab,
      'date', _date
    ));

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_diagnostic_paid_attribution ON public.deals;
CREATE TRIGGER trg_diagnostic_paid_attribution
AFTER INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.on_diagnostic_paid_attribution();

-- ВАЖНО: чтобы on_deal_paid_attribution не дублировал сумму диагностики
-- в crm_revenue (продажи), переопределяем — теперь продажи=только не-диагностика.
CREATE OR REPLACE FUNCTION public.on_deal_paid_attribution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cab uuid;
  _date date;
  _exists boolean;
BEGIN
  IF NEW.status <> 'paid' THEN RETURN NEW; END IF;
  IF OLD.status = 'paid' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.service_type, '') = 'diagnostic' THEN RETURN NEW; END IF;

  SELECT cabinet_id INTO _cab FROM public.leads WHERE id = NEW.lead_id;
  IF _cab IS NULL THEN RETURN NEW; END IF;

  _date := COALESCE(NEW.paid_at, now())::date;

  SELECT EXISTS (
    SELECT 1 FROM public.events
    WHERE lead_id = NEW.lead_id
      AND event_type = 'cabinet_attributed'
      AND payload->>'kind' = 'sale'
      AND payload->>'deal_id' = NEW.id::text
  ) INTO _exists;

  IF _exists THEN RETURN NEW; END IF;

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
$function$;
