
-- Normalize phone to digits only
CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(COALESCE(p, ''), '\D', '', 'g')
$$;

-- Functional index for fast lookup by digits
CREATE INDEX IF NOT EXISTS leads_phone_digits_idx
  ON public.leads (public.normalize_phone(phone));
