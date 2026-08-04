-- Kill-switch: while WhatsApp Web session is not connected, do not create
-- WhatsApp CRM leads for that project. Stops zombie Baileys history loops
-- after logout / disconnect. Projects without a whatsapp_web_sessions row
-- (Green API only) are unaffected.

CREATE OR REPLACE FUNCTION public.wa_web_block_leads_when_disconnected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  st text;
BEGIN
  IF NEW.channel IS DISTINCT FROM 'whatsapp' THEN
    RETURN NEW;
  END IF;
  IF NEW.source IS DISTINCT FROM 'whatsapp' THEN
    RETURN NEW;
  END IF;
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.status INTO st
  FROM public.whatsapp_web_sessions s
  WHERE s.project_id = NEW.project_id;

  IF FOUND AND st IS DISTINCT FROM 'connected' THEN
    RAISE EXCEPTION 'wa_web_ingest_blocked: session status=% (history flood kill-switch)', st
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_web_block_leads_when_disconnected ON public.leads;
CREATE TRIGGER trg_wa_web_block_leads_when_disconnected
  BEFORE INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.wa_web_block_leads_when_disconnected();
