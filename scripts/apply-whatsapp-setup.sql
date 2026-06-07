-- Run in Supabase Dashboard → SQL Editor (project mekwfbqmsqiborjdrjxc)
-- Idempotent: safe to run multiple times.

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS bot_webhook_url text;

ALTER TABLE public.whatsapp_config
  ALTER COLUMN ads_only SET DEFAULT false;

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

-- Green API apiUrl SSRF hardening (if not applied yet)
CREATE OR REPLACE FUNCTION public.normalize_green_api_url(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_trimmed text;
  v_host text;
BEGIN
  IF p_url IS NULL OR btrim(p_url) = '' THEN
    RETURN NULL;
  END IF;
  v_trimmed := regexp_replace(btrim(p_url), '/+$', '');
  IF v_trimmed !~* '^https://[^/?#]+$' THEN
    RAISE EXCEPTION 'api_url must be a bare https origin';
  END IF;
  v_host := lower(substring(v_trimmed from '^https://([^/:]+)'));
  IF v_host IN ('api.green-api.com', 'api.greenapi.com')
     OR v_host ~ '^[a-z0-9-]+\.api\.greenapi\.com$' THEN
    RETURN v_trimmed;
  END IF;
  RAISE EXCEPTION 'api_url host not allowed';
END;
$$;

NOTIFY pgrst, 'reload schema';
