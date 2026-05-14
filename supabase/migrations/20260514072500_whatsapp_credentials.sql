-- Per-project Green API credentials.
-- Each project binds to its own Green API instance, so we store the
-- instance token + URL alongside id_instance. Without this, the proxy
-- couldn't authenticate calls to a per-project instance.

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS api_token text,
  ADD COLUMN IF NOT EXISTS api_url   text;

-- Recreate the bind RPC with token + url params.
-- Token/URL are optional on rebind — passing NULL keeps the existing value,
-- so the UI can update just the instance id without re-typing the token.
CREATE OR REPLACE FUNCTION public.bind_whatsapp_to_project(
  p_project_id  uuid,
  p_id_instance text,
  p_api_token   text DEFAULT NULL,
  p_api_url     text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
BEGIN
  IF p_project_id IS NULL OR p_id_instance IS NULL OR p_id_instance = '' THEN
    RAISE EXCEPTION 'project_id and id_instance are required';
  END IF;

  SELECT id INTO v_existing_id
    FROM public.whatsapp_config
   WHERE project_id = p_project_id;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.whatsapp_config (
      user_id, project_id, id_instance, api_token, api_url, connected
    ) VALUES (
      auth.uid(), p_project_id, p_id_instance,
      NULLIF(p_api_token, ''),
      NULLIF(p_api_url, ''),
      false
    )
    RETURNING id INTO v_existing_id;
  ELSE
    UPDATE public.whatsapp_config
       SET id_instance = p_id_instance,
           api_token   = COALESCE(NULLIF(p_api_token, ''), api_token),
           api_url     = COALESCE(NULLIF(p_api_url,   ''), api_url),
           user_id     = COALESCE(user_id, auth.uid()),
           updated_at  = now()
     WHERE id = v_existing_id;
  END IF;

  RETURN v_existing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bind_whatsapp_to_project(uuid, text, text, text)
  TO authenticated;

-- Drop the old 2-arg variant — the front-end always uses the new signature now.
DROP FUNCTION IF EXISTS public.bind_whatsapp_to_project(uuid, text);
