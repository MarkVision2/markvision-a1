
ALTER TABLE public.lead_status_history ALTER COLUMN to_stage_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.on_lead_stage_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _from_key text;
  _to_key text;
  _to_is_diag boolean;
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    -- Skip logging when stage is being cleared (e.g. cascade SET NULL on project/pipeline delete)
    IF NEW.stage_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT key, is_diagnostic
      INTO _to_key, _to_is_diag
      FROM public.pipeline_stages
     WHERE id = NEW.stage_id;

    IF OLD.stage_id IS NOT NULL THEN
      SELECT key INTO _from_key FROM public.pipeline_stages WHERE id = OLD.stage_id;
    END IF;

    INSERT INTO public.lead_status_history (lead_id, from_stage_id, to_stage_id, changed_by)
    VALUES (NEW.id, OLD.stage_id, NEW.stage_id, auth.uid());

    INSERT INTO public.events (lead_id, event_type, payload, actor_id)
    VALUES (
      NEW.id,
      'stage_changed',
      jsonb_build_object(
        'from', OLD.stage_id,
        'to', NEW.stage_id,
        'from_key', _from_key,
        'to_key', _to_key,
        'to_is_diagnostic', COALESCE(_to_is_diag, false)
      ),
      auth.uid()
    );

    NEW.last_activity_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
