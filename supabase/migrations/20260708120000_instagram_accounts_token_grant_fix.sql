-- page_access_token on instagram_accounts had regressed to being readable by
-- `authenticated` (a later broad GRANT must have overridden the original
-- lockdown from 20260606120000/20260701143133). Any project member could
-- read the raw Meta Page token straight off the base table, bypassing the
-- intended instagram_accounts_safe view. Re-assert the revoke.
REVOKE SELECT (page_access_token) ON public.instagram_accounts FROM authenticated, anon;
