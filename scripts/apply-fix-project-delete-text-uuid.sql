-- Apply on prod (szfgdruhlebfvcmlvxdk) via SQL Editor or:
--   psql "postgresql://postgres.szfgdruhlebfvcmlvxdk:$SUPABASE_DB_PASSWORD@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres" \
--     -f scripts/apply-fix-project-delete-text-uuid.sql
--
-- Symptom: cannot delete project → "operator does not exist: text = uuid"
-- Cause: cleanup trigger compared uuid OLD.id to text project_id columns
--        (legacy clony_results, broll_library, …).

CREATE OR REPLACE FUNCTION public.trg_projects_cleanup_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
BEGIN
  DELETE FROM public.leads
  WHERE project_id = OLD.id
     OR pipeline_id IN (SELECT id FROM public.pipelines WHERE project_id = OLD.id);

  DELETE FROM public.pipeline_stages ps
  USING public.pipelines p
  WHERE ps.pipeline_id = p.id
    AND p.project_id = OLD.id;

  DELETE FROM public.pipelines
  WHERE project_id = OLD.id;

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
