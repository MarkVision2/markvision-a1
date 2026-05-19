
-- 1) Fix overly-permissive project access. Drop the team_member_modules branch
--    that granted any team member access to any project.
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
  )
$function$;

-- 2) Convert the SECURITY DEFINER view to security_invoker so RLS of caller applies.
ALTER VIEW public.meta_creative_crm_daily SET (security_invoker = on);

-- 3) Revoke anon EXECUTE on SECURITY DEFINER functions in public schema.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, public', r.sig);
  END LOOP;
END $$;
