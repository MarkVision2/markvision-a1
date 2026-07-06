
-- instagram_accounts: add explicit admin-only INSERT/UPDATE/DELETE
CREATE POLICY ig_accounts_insert_admin ON public.instagram_accounts
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY ig_accounts_update_admin ON public.instagram_accounts
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY ig_accounts_delete_admin ON public.instagram_accounts
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- meta_tokens: restrict SELECT to admins only (was: any project member)
DROP POLICY IF EXISTS meta_tokens_select_members ON public.meta_tokens;

CREATE POLICY meta_tokens_select_admin ON public.meta_tokens
  FOR SELECT TO authenticated
  USING (user_can_access_project(project_id) AND has_role(auth.uid(), 'admin'::app_role));
