-- Fix project delete blocked by leads_pipeline_id_fkey (ON DELETE RESTRICT).
-- pipelines.project_id cascades from projects; leads still pointing at those
-- pipelines with RESTRICT (or orphan project_id) abort the delete.

-- 1) Soften FKs so pipeline/stage removal cannot be blocked by leads.
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_pipeline_id_fkey;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_pipeline_id_fkey
  FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id)
  ON DELETE SET NULL;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_stage_id_fkey;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_stage_id_fkey
  FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id)
  ON DELETE SET NULL;

-- 2) Harden BEFORE DELETE cleanup: wipe leads by project_id OR by project's pipelines.
CREATE OR REPLACE FUNCTION public.trg_projects_cleanup_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
BEGIN
  -- Leads that belong to the project OR sit on its pipelines (orphans / null project_id).
  DELETE FROM public.leads
  WHERE project_id = OLD.id
     OR pipeline_id IN (SELECT id FROM public.pipelines WHERE project_id = OLD.id);

  DELETE FROM public.pipeline_stages ps
  USING public.pipelines p
  WHERE ps.pipeline_id = p.id
    AND p.project_id = OLD.id;

  DELETE FROM public.pipelines
  WHERE project_id = OLD.id;

  -- Remaining tables with project_id (except projects itself).
  -- Cast bind param to column type: some legacy tables store project_id as text
  -- (clony_results, broll_library) → uuid = text raises 42883.
  FOR t IN
    SELECT
      c.relname AS table_name,
      typ.typname AS typname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type typ ON typ.oid = a.atttypid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'project_id'
      AND NOT a.attisdropped
      AND c.relname NOT IN ('projects', 'leads', 'pipelines')
  LOOP
    BEGIN
      IF t.typname = 'uuid' THEN
        EXECUTE format('DELETE FROM public.%I WHERE project_id = $1', t.table_name)
          USING OLD.id;
      ELSIF t.typname IN ('text', 'varchar', 'bpchar', 'citext', 'name') THEN
        EXECUTE format('DELETE FROM public.%I WHERE project_id = $1', t.table_name)
          USING OLD.id::text;
      ELSE
        EXECUTE format(
          'DELETE FROM public.%I WHERE project_id::text = $1',
          t.table_name
        )
          USING OLD.id::text;
      END IF;
    EXCEPTION
      WHEN undefined_table THEN NULL;
      WHEN insufficient_privilege THEN NULL;
      WHEN undefined_function THEN NULL;
      WHEN datatype_mismatch THEN NULL;
    END;
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_cleanup_before_delete ON public.projects;
CREATE TRIGGER trg_projects_cleanup_before_delete
BEFORE DELETE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.trg_projects_cleanup_before_delete();

-- 3) Explicit RPC for UI (same cleanup path, clearer errors).
CREATE OR REPLACE FUNCTION public.delete_project_cascade(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND (
        p.created_by = v_uid
        OR public.has_role(v_uid, 'admin'::public.app_role)
        OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.project_id = p.id
            AND pm.user_id = v_uid
            AND pm.role IN ('owner', 'admin')
        )
      )
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'project not found or not allowed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND is_primary IS TRUE) THEN
    RAISE EXCEPTION 'cannot delete primary project';
  END IF;

  DELETE FROM public.projects WHERE id = p_project_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_project_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_project_cascade(uuid) TO authenticated;
