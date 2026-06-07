-- WhatsApp: api_token / webhook_token недоступны через PostgREST для клиентов.
-- Чтение — view whatsapp_config_safe; запись токенов — только RPC bind_whatsapp_to_project / service_role.

REVOKE SELECT (api_token, webhook_token) ON public.whatsapp_config FROM PUBLIC, authenticated, anon;
REVOKE INSERT (api_token, webhook_token) ON public.whatsapp_config FROM PUBLIC, authenticated, anon;
REVOKE UPDATE (api_token, webhook_token) ON public.whatsapp_config FROM PUBLIC, authenticated, anon;

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS api_token_present boolean
    GENERATED ALWAYS AS (api_token IS NOT NULL AND length(api_token) > 0) STORED,
  ADD COLUMN IF NOT EXISTS webhook_token_present boolean
    GENERATED ALWAYS AS (webhook_token IS NOT NULL AND length(webhook_token) > 0) STORED;

GRANT SELECT (api_token_present, webhook_token_present) ON public.whatsapp_config TO authenticated;

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
  ads_only,
  updated_at,
  api_token_present,
  webhook_token_present
FROM public.whatsapp_config;

COMMENT ON VIEW public.whatsapp_config_safe IS
  'Client-safe WhatsApp config (no api_token/webhook_token). Edge functions use service_role on base table.';

GRANT SELECT ON public.whatsapp_config_safe TO authenticated;

DROP POLICY IF EXISTS wa_select ON public.whatsapp_config;
DROP POLICY IF EXISTS "wa_select" ON public.whatsapp_config;
CREATE POLICY wa_select ON public.whatsapp_config
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR user_id = auth.uid()
    OR (project_id IS NOT NULL AND public.user_can_access_project(project_id))
  );

REVOKE ALL ON public.whatsapp_config FROM anon;
REVOKE ALL ON public.whatsapp_config FROM PUBLIC;
