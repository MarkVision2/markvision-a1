
-- meta_tokens: restrict SELECT of access_token to service_role only via column-level grants.
REVOKE SELECT ON public.meta_tokens FROM authenticated;
GRANT SELECT (id, project_id, label, token_last4, is_active, last_validated_at, last_validation_status, created_by, created_at, updated_at)
  ON public.meta_tokens TO authenticated;
-- Keep INSERT/UPDATE/DELETE grants intact so admin writes (including access_token) still work.
GRANT INSERT, UPDATE, DELETE ON public.meta_tokens TO authenticated;

-- whatsapp_config: hide api_token and webhook_token from client SELECT.
REVOKE SELECT ON public.whatsapp_config FROM authenticated;
GRANT SELECT (id, user_id, project_id, connected, phone, display_name, connected_at, updated_at, id_instance, api_url, ads_only, webhook_url, bot_webhook_url, api_token_present, webhook_token_present)
  ON public.whatsapp_config TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.whatsapp_config TO authenticated;
