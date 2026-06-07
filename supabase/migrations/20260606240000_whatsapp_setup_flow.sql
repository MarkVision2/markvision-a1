-- WhatsApp setup: optional n8n/bot forward URL + all-incoming default (ads_only off).

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS bot_webhook_url text;

ALTER TABLE public.whatsapp_config
  ALTER COLUMN ads_only SET DEFAULT false;

COMMENT ON COLUMN public.whatsapp_config.bot_webhook_url IS
  'Optional forward target (e.g. n8n bot). Green API webhook stays on greenapi-webhook; copies are POSTed here.';

DROP VIEW IF EXISTS public.whatsapp_config_safe;
CREATE VIEW public.whatsapp_config_safe
WITH (security_invoker = true) AS
SELECT
  id,
  user_id,
  project_id,
  id_instance,
  api_url,
  phone,
  connected,
  connected_at,
  display_name,
  webhook_url,
  bot_webhook_url,
  ads_only,
  updated_at,
  api_token_present,
  webhook_token_present
FROM public.whatsapp_config;

GRANT SELECT ON public.whatsapp_config_safe TO authenticated;

CREATE OR REPLACE FUNCTION public.save_whatsapp_bot_webhook(
  p_project_id uuid,
  p_bot_webhook_url text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.created_by = auth.uid())
    OR public.is_project_member(auth.uid(), p_project_id)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_url := NULLIF(btrim(p_bot_webhook_url), '');
  IF v_url IS NOT NULL AND v_url !~* '^https://[^?#]+' THEN
    RAISE EXCEPTION 'bot_webhook_url must use https';
  END IF;
  IF v_url IS NOT NULL AND lower(substring(v_url from '^https://([^/:]+)')) IN (
    'localhost', '127.0.0.1', '169.254.169.254', 'metadata.google.internal'
  ) THEN
    RAISE EXCEPTION 'bot_webhook_url host not allowed';
  END IF;

  UPDATE public.whatsapp_config
     SET bot_webhook_url = v_url,
         updated_at = now()
   WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp_config not found for project — bind Green API instance first';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_whatsapp_bot_webhook(uuid, text) TO authenticated;
