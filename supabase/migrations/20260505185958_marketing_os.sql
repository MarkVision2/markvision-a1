-- ============================================================
-- Marketing OS: расширение онбординга и артефакты команд
-- ============================================================

-- 1) Расширяем project_briefs (артефакт /onboarding)
ALTER TABLE public.project_briefs
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS research_depth text,
  ADD COLUMN IF NOT EXISTS price_model text,
  ADD COLUMN IF NOT EXISTS current_clients text,
  ADD COLUMN IF NOT EXISTS channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS direct_competitors text,
  ADD COLUMN IF NOT EXISTS indirect_competitors text,
  ADD COLUMN IF NOT EXISTS differentiator text,
  ADD COLUMN IF NOT EXISTS pains_raw text,
  ADD COLUMN IF NOT EXISTS segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS competitors jsonb,
  ADD COLUMN IF NOT EXISTS product_matrix jsonb,
  ADD COLUMN IF NOT EXISTS launch_scenarios jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recommended_scenario text;

-- 2) Артефакты остальных 4 команд (/creatives, /content, /site-brief, /site-build)
CREATE TABLE IF NOT EXISTS public.marketing_os_artifacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  command text NOT NULL CHECK (command IN ('creatives','content','site_brief','site_build')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
  markdown text,
  payload jsonb,
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_os_artifacts_project_command
  ON public.marketing_os_artifacts(project_id, command);

ALTER TABLE public.marketing_os_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketing_os_artifacts_select_authed" ON public.marketing_os_artifacts;
CREATE POLICY "marketing_os_artifacts_select_authed"
  ON public.marketing_os_artifacts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "marketing_os_artifacts_write_admin" ON public.marketing_os_artifacts;
CREATE POLICY "marketing_os_artifacts_write_admin"
  ON public.marketing_os_artifacts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS marketing_os_artifacts_set_updated_at ON public.marketing_os_artifacts;
CREATE TRIGGER marketing_os_artifacts_set_updated_at
  BEFORE UPDATE ON public.marketing_os_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
