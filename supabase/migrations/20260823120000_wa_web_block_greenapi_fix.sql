-- Fix kill-switch: do not block Green API WhatsApp leads when WA Web session
-- exists but is disconnected. Green API uses the same channel/source labels but
-- must keep creating leads; WA Web ingest is already guarded in wa-web-bridge.

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
    -- Project uses Green API — allow CRM leads while WA Web is offline.
    IF EXISTS (
      SELECT 1
      FROM public.whatsapp_config wc
      WHERE wc.project_id = NEW.project_id
        AND wc.id_instance IS NOT NULL
        AND NULLIF(TRIM(wc.id_instance::text), '') IS NOT NULL
    ) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'wa_web_ingest_blocked: session status=% (history flood kill-switch)', st
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill orphan leads that were routed into a project pipeline but lost project_id.
UPDATE public.leads l
   SET project_id = pl.project_id
  FROM public.pipelines pl
 WHERE pl.id = l.pipeline_id
   AND l.project_id IS NULL
   AND pl.project_id IS NOT NULL;
