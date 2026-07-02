
CREATE TABLE public.meta_tokens (
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

CREATE INDEX meta_tokens_project_idx ON public.meta_tokens(project_id);

GRANT SELECT (id, project_id, label, token_last4, is_active, last_validated_at, last_validation_status, created_by, created_at, updated_at) ON public.meta_tokens TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.meta_tokens TO authenticated;
GRANT ALL ON public.meta_tokens TO service_role;

ALTER TABLE public.meta_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meta_tokens_select_members"
ON public.meta_tokens FOR SELECT
TO authenticated
USING (public.user_can_access_project(project_id));

CREATE POLICY "meta_tokens_write_admin"
ON public.meta_tokens FOR ALL
TO authenticated
USING (public.user_can_access_project(project_id) AND public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.user_can_access_project(project_id) AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_meta_tokens_updated_at
BEFORE UPDATE ON public.meta_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
