-- 1. Lock down sensitive credential columns on ad_cabinets
REVOKE SELECT (access_token, app_id, business_id, page_id, pixel_id)
  ON public.ad_cabinets FROM authenticated, anon;

-- 2. Lock down sensitive credential columns on whatsapp_config
REVOKE SELECT (api_token)
  ON public.whatsapp_config FROM authenticated, anon;

-- 3. Expand user_can_access_project to include team members with module access
CREATE OR REPLACE FUNCTION public.user_can_access_project(_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _project_id IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = _project_id AND p.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.team_member_modules tmm
      WHERE tmm.user_id = auth.uid()
    )
  )
$function$;