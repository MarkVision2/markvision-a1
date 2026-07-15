
-- Restrict policies to authenticated role for defense-in-depth
ALTER POLICY phone_attr_select ON public.phone_attribution TO authenticated;
ALTER POLICY projects_select_owner_admin ON public.projects TO authenticated;
ALTER POLICY wa_clicks_select ON public.wa_clicks TO authenticated;
