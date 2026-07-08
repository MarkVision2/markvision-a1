-- Ensure project deletion removes all dependent project data automatically.
-- This prevents FK failures like leads_pipeline_id_fkey when deleting a project.

CREATE OR REPLACE FUNCTION public.trg_projects_cleanup_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
BEGIN
  -- 1) Remove rows that block pipeline deletion.
  DELETE FROM public.leads
  WHERE project_id = OLD.id;

  DELETE FROM public.pipeline_stages ps
  USING public.pipelines p
  WHERE ps.pipeline_id = p.id
    AND p.project_id = OLD.id;

  DELETE FROM public.pipelines
  WHERE project_id = OLD.id;

  -- 2) Remove all remaining direct project-owned rows by project_id.
  -- Skip tables already handled above and the projects table itself.
  FOR t IN
    SELECT c.relname AS table_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'project_id'
      AND NOT a.attisdropped
      AND c.relname NOT IN ('projects', 'leads', 'pipelines')
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE project_id = $1', t.table_name)
    USING OLD.id;
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_cleanup_before_delete ON public.projects;
CREATE TRIGGER trg_projects_cleanup_before_delete
BEFORE DELETE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.trg_projects_cleanup_before_delete();
