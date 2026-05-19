
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS diagnostic_amount NUMERIC NOT NULL DEFAULT 0;

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
  _amount numeric;
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
