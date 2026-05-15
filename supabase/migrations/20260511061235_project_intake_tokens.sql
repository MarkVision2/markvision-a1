-- Per-project intake webhook: secret token + project-scoped pipelines.
-- Each project has a single URL-safe token that is embedded in the lead-intake
-- webhook URL (`/functions/v1/lead-intake/t/<token>`). One token per project,
-- safe for several sites of the same client.

-- 1) URL-safe 16-char token generator (~96 bits of entropy).
CREATE OR REPLACE FUNCTION public.gen_intake_token()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT translate(encode(gen_random_bytes(12), 'base64'), '+/=', '-_x')
$$;

-- 2) projects.intake_token — unique secret, generated on insert, backfilled now.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS intake_token text;

UPDATE public.projects
   SET intake_token = public.gen_intake_token()
 WHERE intake_token IS NULL;

ALTER TABLE public.projects
  ALTER COLUMN intake_token SET NOT NULL,
  ALTER COLUMN intake_token SET DEFAULT public.gen_intake_token();

CREATE UNIQUE INDEX IF NOT EXISTS projects_intake_token_key
  ON public.projects(intake_token);

-- 3) pipelines.project_id — bind a pipeline to a project. NULL = legacy/global
--    pipeline (fallback when project has no pipeline of its own).
ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS project_id uuid
    REFERENCES public.projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS pipelines_project_id_idx
  ON public.pipelines(project_id);

-- A project has at most one default pipeline.
CREATE UNIQUE INDEX IF NOT EXISTS pipelines_one_default_per_project
  ON public.pipelines(project_id)
  WHERE is_default = true AND project_id IS NOT NULL;

-- 4) Resolve helper: given an intake token, return project_id or NULL.
CREATE OR REPLACE FUNCTION public.resolve_intake_project(p_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.projects WHERE intake_token = p_token LIMIT 1
$$;

-- 5) Rotate token (admin/owner only — RLS guards UPDATE on projects).
CREATE OR REPLACE FUNCTION public.rotate_project_intake_token(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_new text;
BEGIN
  v_new := public.gen_intake_token();
  UPDATE public.projects SET intake_token = v_new WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found or not allowed';
  END IF;
  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rotate_project_intake_token(uuid) TO authenticated;

-- 6) Lead phone dedupe is now scoped per-project. Index speeds up lookup.
CREATE INDEX IF NOT EXISTS leads_project_phone_idx
  ON public.leads(project_id, phone);
