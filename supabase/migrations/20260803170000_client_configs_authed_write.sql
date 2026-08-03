-- Restore authenticated write to client_configs (dual-write from Ads UI).
-- SELECT stays denied for anon/authenticated so access_token does not leak.
-- Service role (edge / n8n) bypasses RLS.

ALTER TABLE public.client_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_config insert anon" ON public.client_configs;
DROP POLICY IF EXISTS "client_config select anon" ON public.client_configs;
DROP POLICY IF EXISTS client_configs_insert_authed ON public.client_configs;
DROP POLICY IF EXISTS client_configs_update_authed ON public.client_configs;
DROP POLICY IF EXISTS client_configs_delete_authed ON public.client_configs;

CREATE POLICY client_configs_insert_authed ON public.client_configs
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY client_configs_update_authed ON public.client_configs
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY client_configs_delete_authed ON public.client_configs
  FOR DELETE TO authenticated
  USING (true);

GRANT INSERT, UPDATE, DELETE ON public.client_configs TO authenticated;
