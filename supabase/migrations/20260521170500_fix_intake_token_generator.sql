-- Keep project creation independent from pgcrypto extension schema details.
-- Some deployed databases do not expose gen_random_bytes(integer) in search_path.
CREATE OR REPLACE FUNCTION public.gen_intake_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT substring(
    regexp_replace(
      md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text),
      '[^a-zA-Z0-9]',
      '',
      'g'
    ),
    1,
    16
  )
$$;
