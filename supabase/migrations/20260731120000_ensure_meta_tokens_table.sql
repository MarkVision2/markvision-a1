-- ============================================================
-- meta_tokens отсутствовала в проде (миграция 20260702 не применилась),
-- из‑за чего Настройки → Meta падали: «Could not find the table public.meta_tokens».
-- Идемпотентно создаём таблицу + финальные RLS/гранты.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.meta_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label text NOT NULL,
  access_token text NOT NULL,
  token_last4 text GENERATED ALWAYS AS (right(access_token, 4)) STORED,
  is_active boolean NOT NULL DEFAULT true,
  last_validated_at timestamptz,
  last_validation_status text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_tokens_project_idx ON public.meta_tokens(project_id);

ALTER TABLE public.meta_tokens ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_meta_tokens_updated_at ON public.meta_tokens;
CREATE TRIGGER update_meta_tokens_updated_at
BEFORE UPDATE ON public.meta_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Column-level: access_token не отдаём authenticated на SELECT
REVOKE ALL ON public.meta_tokens FROM authenticated;
GRANT SELECT (
  id, project_id, label, token_last4, is_active,
  last_validated_at, last_validation_status,
  created_by, created_at, updated_at
) ON public.meta_tokens TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.meta_tokens TO authenticated;
GRANT ALL ON public.meta_tokens TO service_role;

DROP POLICY IF EXISTS meta_tokens_select_members ON public.meta_tokens;
DROP POLICY IF EXISTS meta_tokens_select_admin ON public.meta_tokens;
DROP POLICY IF EXISTS meta_tokens_write_admin ON public.meta_tokens;

CREATE POLICY meta_tokens_select_admin ON public.meta_tokens
  FOR SELECT TO authenticated
  USING (
    public.user_can_access_project(project_id)
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY meta_tokens_write_admin ON public.meta_tokens
  FOR ALL TO authenticated
  USING (
    public.user_can_access_project(project_id)
    AND public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    public.user_can_access_project(project_id)
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- Если в automation_settings уже лежит токен, а в meta_tokens пусто —
-- положим его как «Системный» для MarkVision AI, чтобы UI не был пустым.
INSERT INTO public.meta_tokens (project_id, label, access_token, is_active)
SELECT
  'cceb9a86-687b-4417-9b4e-d106bd8cc79c'::uuid,
  'Системный (automation_settings)',
  a.meta_access_token,
  true
FROM public.automation_settings a
WHERE a.id = true
  AND a.meta_access_token IS NOT NULL
  AND btrim(a.meta_access_token) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.meta_tokens t
    WHERE t.project_id = 'cceb9a86-687b-4417-9b4e-d106bd8cc79c'
  );

NOTIFY pgrst, 'reload schema';
