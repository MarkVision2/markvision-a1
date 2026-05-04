
CREATE TABLE public.project_briefs (
  project_id uuid PRIMARY KEY,
  niche text,
  audience text,
  product text,
  usp text,
  geo text,
  monthly_budget numeric DEFAULT 0,
  tone text,
  brief_md text,
  ai_primary_text text,
  ai_headline text,
  ai_cta text,
  ai_variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_briefs_select_authed"
  ON public.project_briefs FOR SELECT TO authenticated USING (true);

CREATE POLICY "project_briefs_write_admin"
  ON public.project_briefs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER project_briefs_set_updated_at
  BEFORE UPDATE ON public.project_briefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
