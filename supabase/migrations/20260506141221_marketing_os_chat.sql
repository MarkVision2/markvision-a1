-- ============================================================
-- Marketing OS chat — история диалога пользователя со стратегом
-- ============================================================

CREATE TABLE IF NOT EXISTS public.marketing_os_chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_os_chat_project_idx
  ON public.marketing_os_chat_messages(project_id, created_at);

ALTER TABLE public.marketing_os_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketing_os_chat_select_authed" ON public.marketing_os_chat_messages;
CREATE POLICY "marketing_os_chat_select_authed"
  ON public.marketing_os_chat_messages FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "marketing_os_chat_write_admin" ON public.marketing_os_chat_messages;
CREATE POLICY "marketing_os_chat_write_admin"
  ON public.marketing_os_chat_messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
