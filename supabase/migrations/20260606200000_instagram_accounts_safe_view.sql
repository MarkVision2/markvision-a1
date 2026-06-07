-- Instagram: page_access_token недоступен через PostgREST для non-admin.
-- Подход: column-level REVOKE + client view без секретного столбца.

REVOKE SELECT (page_access_token) ON public.instagram_accounts FROM PUBLIC, authenticated, anon;

ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS page_token_present boolean
    GENERATED ALWAYS AS (page_access_token IS NOT NULL AND length(page_access_token) > 0) STORED;

GRANT SELECT (page_token_present) ON public.instagram_accounts TO authenticated;

DROP VIEW IF EXISTS public.instagram_accounts_safe;
CREATE VIEW public.instagram_accounts_safe
WITH (security_invoker = true) AS
SELECT
  id,
  project_id,
  ig_user_id,
  username,
  name,
  profile_picture_url,
  page_id,
  page_name,
  page_token_present,
  followers_count,
  follows_count,
  media_count,
  active,
  last_sync_at,
  last_error,
  created_at,
  updated_at
FROM public.instagram_accounts;

COMMENT ON VIEW public.instagram_accounts_safe IS
  'Client-safe Instagram account row (no page_access_token). Use for PostgREST reads; edge functions use service_role on base table.';

GRANT SELECT ON public.instagram_accounts_safe TO authenticated;

DROP POLICY IF EXISTS ig_accounts_select ON public.instagram_accounts;
CREATE POLICY ig_accounts_select ON public.instagram_accounts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.user_can_access_project(project_id)
  );

-- Явно: anon/public не читают таблицу напрямую (только authenticated + service_role).
REVOKE ALL ON public.instagram_accounts FROM anon;
REVOKE ALL ON public.instagram_accounts FROM PUBLIC;
