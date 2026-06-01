-- Strict per-user RLS. No admin override on data tables.
-- Admin operations (deleting users) must go through service_role or SECURITY DEFINER RPCs.

DO $$
DECLARE
  pol RECORD;
  tbl text;
  col_exists boolean;
  tables_to_fix text[] := ARRAY[
    'tasks','goals','expenses','incomes','debts','debt_payments','debt_reminders',
    'task_completions','subtasks','goal_contributions','categories',
    'expense_categories','income_categories','telegram_users'
  ];
BEGIN
  -- Enable AND force RLS on every user-scoped table.
  -- FORCE means even table owner / privileged roles must obey RLS
  -- (service_role still bypasses by design).
  FOREACH tbl IN ARRAY tables_to_fix LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=tbl) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;

  -- Drop ALL existing policies on these tables to avoid leftover loose policies.
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname='public' AND tablename = ANY(tables_to_fix)
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;

  -- Recreate STRICT policies: auth.uid() = user_id only. No admin override.
  FOREACH tbl IN ARRAY tables_to_fix LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=tbl) THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl AND column_name='user_id'
    ) INTO col_exists;

    IF col_exists THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
        tbl || '_own', tbl
      );
    ELSE
      -- Tables without user_id (shared lookup tables). Read-only for everyone.
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
        tbl || '_read', tbl
      );
    END IF;
  END LOOP;
END $$;

-- user_roles: each user can read their own role; only admins can manage roles.
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_roles_admin_all" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_self_read" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_own" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin" ON public.user_roles;
CREATE POLICY "user_roles_self_read" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_roles_admin_manage" ON public.user_roles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Audit: confirm RLS is forced and exactly the expected policies exist
SELECT json_build_object(
  'admins', (SELECT json_agg(user_id) FROM public.user_roles WHERE role = 'admin'),
  'tables', (
    SELECT json_agg(json_build_object(
      'table', t.tablename,
      'rls_enabled', t.rowsecurity,
      'rls_forced', (
        SELECT c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = t.tablename AND n.nspname = 'public'
      ),
      'policies', (
        SELECT json_agg(json_build_object(
          'name', p.policyname, 'cmd', p.cmd, 'using', p.qual, 'with_check', p.with_check
        ) ORDER BY p.policyname)
        FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = t.tablename
      )
    ) ORDER BY t.tablename)
    FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND t.tablename IN (
        'tasks','goals','expenses','incomes','debts','debt_payments',
        'task_completions','telegram_users','user_roles',
        'expense_categories','income_categories'
      )
  )
) AS audit;
