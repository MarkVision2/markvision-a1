
-- 1) instagram_accounts: restrict SELECT to admin only (members use instagram_accounts_safe view)
DROP POLICY IF EXISTS ig_accounts_select ON public.instagram_accounts;
CREATE POLICY ig_accounts_select ON public.instagram_accounts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 2) whatsapp_config: restrict SELECT to owner/admin (members use whatsapp_config_safe view)
DROP POLICY IF EXISTS wa_select ON public.whatsapp_config;
CREATE POLICY wa_select ON public.whatsapp_config
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

-- 3) AI ROP policies: scope to authenticated role
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN (
        'ai_rop_call_analyses','ai_rop_chat_analyses','ai_rop_content_ideas',
        'ai_rop_manager_scores','ai_rop_scripts','ai_rop_settings','ai_rop_trainer_sessions'
      )
      AND 'public' = ANY(roles)
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 4) profiles: add restrictive policy locking cross-user reads
DROP POLICY IF EXISTS profiles_restrict_cross_tenant ON public.profiles;
CREATE POLICY profiles_restrict_cross_tenant ON public.profiles
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
