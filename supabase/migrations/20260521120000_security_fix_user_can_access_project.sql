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
-- per-project membership table.
--
-- ⚠️ ВНИМАНИЕ ПЕРЕД ПРИМЕНЕНИЕМ:
-- Эта миграция меняет логику доступа. Если в системе есть юзеры,
-- которым раньше давался доступ через team_member_modules, но в
-- project_members их нет — они потеряют доступ к проектам, в которых
-- работали. Перед применением:
--
--   1. Проверь, что project_members заполнена для всех активных юзеров:
--
--      SELECT u.id, u.email,
--             (SELECT COUNT(*) FROM project_members pm WHERE pm.user_id = u.id) AS pm_rows,
--             (SELECT COUNT(*) FROM team_member_modules tmm WHERE tmm.user_id = u.id) AS tmm_rows
--        FROM auth.users u
--       WHERE EXISTS (SELECT 1 FROM team_member_modules tmm WHERE tmm.user_id = u.id)
--          OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = u.id);
--
--   2. Для юзеров с tmm_rows > 0 и pm_rows = 0 — добавь их в project_members
--      с явным project_id (UI: Настройки → Команда).
--
--   3. Если в БД нет project_members — миграция её НЕ создаёт. Сначала
--      примени миграцию создания project_members, потом эту.
--
--   4. После применения убедись, что админ + создатель проекта + project_members
--      могут открыть свои проекты, а посторонний юзер — нет.
--
-- Если что-то непонятно — НЕ применяй автоматически. Откати, разберись.

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
