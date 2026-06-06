-- Сохранение секретов automation_settings только через RPC (не прямой UPDATE с клиента).

REVOKE UPDATE (meta_access_token, sipuni_token) ON public.automation_settings FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.save_meta_access_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RAISE EXCEPTION 'token is required';
  END IF;
  UPDATE public.automation_settings
     SET meta_access_token = trim(p_token)
   WHERE id = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_settings row missing';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_sipuni_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RAISE EXCEPTION 'token is required';
  END IF;
  UPDATE public.automation_settings
     SET sipuni_token = trim(p_token)
   WHERE id = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_settings row missing';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_meta_access_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_sipuni_token(text) TO authenticated;
