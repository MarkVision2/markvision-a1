-- 1) Views: enforce security_invoker so RLS of caller applies.
ALTER VIEW public.inbound_tokens           SET (security_invoker = true);
ALTER VIEW public.instagram_organic_daily  SET (security_invoker = true);
ALTER VIEW public.instagram_codeword_stats SET (security_invoker = true);
ALTER VIEW public.meta_campaign_overview   SET (security_invoker = true);
ALTER VIEW public.meta_creative_overview   SET (security_invoker = true);

-- 2) Functions missing search_path: pin to public.
ALTER FUNCTION public._normalize_act_id(text)                    SET search_path = public;
ALTER FUNCTION public.gen_intake_token()                          SET search_path = public;
ALTER FUNCTION public.trg_leads_fill_project_from_pipeline()      SET search_path = public;
ALTER FUNCTION public.trg_leads_route_to_project_pipeline()       SET search_path = public;

-- 3) Lock down SECURITY DEFINER functions from anon/public.
-- Revoke from PUBLIC and anon, keep authenticated where the function is
-- intentionally callable from the app. Trigger-only functions don't need
-- any EXECUTE grants — Postgres invokes them directly.

-- has_role: used inside RLS policies; needs authenticated execute (it's STABLE
-- and SECURITY DEFINER so RLS recursion doesn't happen).
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- ensure_project_pipeline: called from triggers and possibly from the app
-- when bootstrapping a project. Keep authenticated, drop anon.
REVOKE EXECUTE ON FUNCTION public.ensure_project_pipeline(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ensure_project_pipeline(uuid) TO authenticated;

-- resolve_intake_project: stays callable by service role (edge functions),
-- never by client. Drop public/anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.resolve_intake_project(text) FROM PUBLIC, anon, authenticated;

-- meta_structure_sync / _meta_get / _get_usd_kzt_rate / ensure_cdi_row:
-- privileged jobs invoked by cron / service role only.
REVOKE EXECUTE ON FUNCTION public.meta_structure_sync(date, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._meta_get(text)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._get_usd_kzt_rate(date)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_cdi_row(uuid, date)            FROM PUBLIC, anon, authenticated;

-- handle_new_user + the on_* / trg_* functions are TRIGGER functions only.
-- Strip every EXECUTE grant; triggers fire via the table, not via call.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_communication_inserted()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_deal_change()                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_lead_created()                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_lead_stage_change()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_lead_stage_change_attribution()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_deal_paid_attribution()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_projects_ensure_pipeline()          FROM PUBLIC, anon, authenticated;