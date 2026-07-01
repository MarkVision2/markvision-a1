
-- Fix search_path on log_stage_change
CREATE OR REPLACE FUNCTION public.log_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
  BEGIN
    IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      INSERT INTO public.events (lead_id, event_type, payload, actor_id, created_at)
      VALUES (NEW.id, 'stage_changed',
              jsonb_build_object('from', OLD.stage_id, 'to', NEW.stage_id),
              NULLIF(current_setting('app.user_id', true), '')::uuid, now());
    END IF;
    RETURN NEW;
  END; $function$;

-- Revoke column-level SELECT on sensitive token columns from anon/authenticated.
-- Edge functions use service_role and are unaffected.

REVOKE SELECT (api_token, webhook_token) ON public.whatsapp_config FROM authenticated;
REVOKE SELECT (api_token, webhook_token) ON public.whatsapp_config FROM anon;

REVOKE SELECT (page_access_token) ON public.instagram_accounts FROM authenticated;
REVOKE SELECT (page_access_token) ON public.instagram_accounts FROM anon;

REVOKE SELECT (meta_access_token, sipuni_token, cron_secret) ON public.automation_settings FROM authenticated;
REVOKE SELECT (meta_access_token, sipuni_token, cron_secret) ON public.automation_settings FROM anon;
