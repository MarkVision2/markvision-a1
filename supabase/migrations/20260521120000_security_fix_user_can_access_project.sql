-- SECURITY FIX: user_can_access_project granted access to ALL projects if
-- the user had ANY row in team_member_modules (no project_id filter).
--
-- Original function (from 20260518190813_9902036d):
--
--   OR EXISTS (
--     SELECT 1 FROM public.team_member_modules tmm
--     WHERE tmm.user_id = auth.uid()         -- ← no project filter!
--   )
--
-- team_member_modules schema is (user_id, module_key) — no project_id. So
-- having access to one project leaked access to every project in the database
-- through the 51+ RLS policies that call this function (leads,
-- communications, events, tasks, ai_rop_*, sipuni_cdr_log, etc.).
--
-- Fix: use project_members(project_id, user_id, role) which is the proper
-- per-project membership table. Falls back to module-level access only when
-- the user is explicitly a member of the *target* project.

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
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = auth.uid() AND pm.project_id = _project_id
    )
  )
$function$;

-- Function execution grants stay the same as set in 20260514142243.
-- (REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated.)
