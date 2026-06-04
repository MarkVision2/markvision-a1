CREATE OR REPLACE FUNCTION public.gen_intake_token()
RETURNS text
LANGUAGE sql
SET search_path TO 'public', 'extensions'
AS $$
  SELECT translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', '-_x')
$$;