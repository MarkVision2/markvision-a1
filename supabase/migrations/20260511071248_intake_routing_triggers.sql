-- Runtime safety nets that were applied manually via SQL Editor while the
-- deployed edge function was lagging behind the merged code. They are
-- idempotent — re-applying them is safe — and they keep the intake flow
-- working regardless of which edge function version is live.

-- 1) View that maps projects.intake_token → the shape the body-token
--    branch of the legacy edge function expects.
DROP VIEW IF EXISTS public.inbound_tokens;
CREATE VIEW public.inbound_tokens AS
SELECT
  p.intake_token AS token,
  NULL::uuid     AS client_id,
  p.id           AS project_id,
  true           AS is_active
FROM public.projects p
WHERE p.intake_token IS NOT NULL;

GRANT SELECT ON public.inbound_tokens TO authenticated, anon, service_role;

-- 2) BEFORE INSERT: if a lead arrives with NULL project_id but a
--    pipeline that belongs to a project, inherit project_id from the
--    pipeline. Runs first (alphabetically before *_route_*).
CREATE OR REPLACE FUNCTION public.trg_leads_fill_project_from_pipeline()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.project_id IS NULL AND NEW.pipeline_id IS NOT NULL THEN
    SELECT project_id INTO NEW.project_id
      FROM public.pipelines
     WHERE id = NEW.pipeline_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_fill_project_from_pipeline ON public.leads;
CREATE TRIGGER leads_fill_project_from_pipeline
BEFORE INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trg_leads_fill_project_from_pipeline();

-- 3) BEFORE INSERT: if a lead has a project_id but its pipeline does
--    not belong to that project, snap to the project's default
--    pipeline and its first stage («Новая»).
CREATE OR REPLACE FUNCTION public.trg_leads_route_to_project_pipeline()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_pipeline_id uuid;
  v_stage_id    uuid;
  v_pipe_proj   uuid;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.pipeline_id IS NOT NULL THEN
    SELECT project_id INTO v_pipe_proj
      FROM public.pipelines WHERE id = NEW.pipeline_id;
    IF v_pipe_proj = NEW.project_id THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE project_id = NEW.project_id AND is_default = true
   LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    SELECT id INTO v_pipeline_id
      FROM public.pipelines
     WHERE project_id = NEW.project_id
     ORDER BY created_at ASC
     LIMIT 1;
  END IF;

  IF v_pipeline_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_stage_id
    FROM public.pipeline_stages
   WHERE pipeline_id = v_pipeline_id
   ORDER BY order_index ASC
   LIMIT 1;

  IF v_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.pipeline_id := v_pipeline_id;
  NEW.stage_id    := v_stage_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_route_to_project_pipeline ON public.leads;
CREATE TRIGGER leads_route_to_project_pipeline
BEFORE INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trg_leads_route_to_project_pipeline();

-- 4) Backfill: previously inserted leads with NULL project_id that
--    were routed into per-project pipelines should now point at
--    the correct project.
UPDATE public.leads l
   SET project_id = pl.project_id
  FROM public.pipelines pl
 WHERE pl.id = l.pipeline_id
   AND l.project_id IS NULL
   AND pl.project_id IS NOT NULL;
