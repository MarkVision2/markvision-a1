-- SSRF hardening: api_url on whatsapp_config must point to official Green API hosts only.

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
    RAISE EXCEPTION 'api_url must be a bare https origin without path, query, or credentials';
  END IF;

  v_host := lower(substring(v_trimmed from '^https://([^/:]+)'));
  IF v_host IS NULL OR v_host = '' THEN
    RAISE EXCEPTION 'Invalid api_url';
  END IF;

  IF v_host IN ('localhost', 'metadata.google.internal', '169.254.169.254')
     OR v_host ~ '^\d+\.\d+\.\d+\.\d+$'
     OR position(':' in v_host) > 0 THEN
    RAISE EXCEPTION 'api_url host not allowed';
  END IF;

  IF v_host IN ('api.green-api.com', 'api.greenapi.com')
     OR v_host ~ '^[a-z0-9-]+\.api\.greenapi\.com$' THEN
    RETURN v_trimmed;
  END IF;

  RAISE EXCEPTION 'api_url host not allowed';
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_validate_whatsapp_api_url()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.api_url IS NOT NULL AND btrim(NEW.api_url) <> '' THEN
    NEW.api_url := public.normalize_green_api_url(NEW.api_url);
  ELSE
    NEW.api_url := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_config_validate_api_url ON public.whatsapp_config;
CREATE TRIGGER whatsapp_config_validate_api_url
  BEFORE INSERT OR UPDATE OF api_url ON public.whatsapp_config
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_validate_whatsapp_api_url();

-- api_url only via validated RPC / trigger — not arbitrary client UPDATE
REVOKE UPDATE (api_url) ON public.whatsapp_config FROM PUBLIC, authenticated, anon;

CREATE OR REPLACE FUNCTION public.bind_whatsapp_to_project(
  p_project_id uuid,
  p_id_instance text,
  p_api_token text DEFAULT NULL,
  p_api_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_api_url text;
BEGIN
  IF p_project_id IS NULL OR p_id_instance IS NULL OR p_id_instance = '' THEN
    RAISE EXCEPTION 'project_id and id_instance are required';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.created_by = auth.uid())
    OR public.is_project_member(auth.uid(), p_project_id)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_api_url IS NOT NULL AND btrim(p_api_url) <> '' THEN
    v_api_url := public.normalize_green_api_url(p_api_url);
  ELSE
    v_api_url := NULL;
  END IF;

  SELECT id INTO v_existing_id
    FROM public.whatsapp_config
   WHERE project_id = p_project_id;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.whatsapp_config (user_id, project_id, id_instance, api_token, api_url, connected)
    VALUES (auth.uid(), p_project_id, p_id_instance, NULLIF(btrim(p_api_token), ''), v_api_url, false)
    RETURNING id INTO v_existing_id;
  ELSE
    UPDATE public.whatsapp_config
       SET id_instance = p_id_instance,
           user_id     = COALESCE(user_id, auth.uid()),
           api_token   = CASE WHEN p_api_token IS NOT NULL AND btrim(p_api_token) <> ''
                              THEN btrim(p_api_token) ELSE api_token END,
           api_url     = COALESCE(v_api_url, api_url),
           updated_at  = now()
     WHERE id = v_existing_id;
  END IF;

  RETURN v_existing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_green_api_url(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bind_whatsapp_to_project(uuid, text, text, text) TO authenticated;
