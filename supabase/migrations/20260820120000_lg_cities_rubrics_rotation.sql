-- Лидген: города-очередь («каждый день новый город») + направления (рубрики) галочками.
CREATE TABLE IF NOT EXISTS public.lg_cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  city text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 100,
  last_parsed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, city)
);
CREATE TABLE IF NOT EXISTS public.lg_rubrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  rubric text NOT NULL,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, rubric)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lg_cities, public.lg_rubrics TO authenticated;
GRANT ALL ON public.lg_cities, public.lg_rubrics TO service_role;
ALTER TABLE public.lg_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lg_rubrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lg_cities_sel ON public.lg_cities;
CREATE POLICY lg_cities_sel ON public.lg_cities FOR SELECT TO authenticated USING (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS lg_cities_wr ON public.lg_cities;
CREATE POLICY lg_cities_wr ON public.lg_cities FOR ALL TO authenticated USING (public.user_can_access_project(project_id) AND public.has_role(auth.uid(),'admin')) WITH CHECK (public.user_can_access_project(project_id) AND public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS lg_rubrics_sel ON public.lg_rubrics;
CREATE POLICY lg_rubrics_sel ON public.lg_rubrics FOR SELECT TO authenticated USING (public.user_can_access_project(project_id));
DROP POLICY IF EXISTS lg_rubrics_wr ON public.lg_rubrics;
CREATE POLICY lg_rubrics_wr ON public.lg_rubrics FOR ALL TO authenticated USING (public.user_can_access_project(project_id) AND public.has_role(auth.uid(),'admin')) WITH CHECK (public.user_can_access_project(project_id) AND public.has_role(auth.uid(),'admin'));

-- Следующие цели: наименее давно парсенные города × включённые рубрики (алиасы против неоднозначности project_id).
CREATE OR REPLACE FUNCTION public.lg_next_targets(p_project uuid, p_cities int DEFAULT 1, p_max_items int DEFAULT 120)
RETURNS TABLE(city text, rubric text, label text, project_id uuid, max_items int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cities text[];
BEGIN
  SELECT array_agg(c.city) INTO _cities FROM (
    SELECT lc.city FROM public.lg_cities lc
    WHERE lc.project_id = p_project AND lc.enabled
    ORDER BY lc.last_parsed_at NULLS FIRST, lc.sort, lc.city
    LIMIT GREATEST(p_cities, 1)
  ) c;
  IF _cities IS NULL THEN RETURN; END IF;
  UPDATE public.lg_cities lc SET last_parsed_at = now()
    WHERE lc.project_id = p_project AND lc.city = ANY(_cities);
  RETURN QUERY
    SELECT ci AS city, r.rubric, r.label, p_project AS project_id, p_max_items AS max_items
    FROM unnest(_cities) ci
    CROSS JOIN public.lg_rubrics r
    WHERE r.project_id = p_project AND r.enabled
    ORDER BY ci, r.sort;
END $$;
REVOKE EXECUTE ON FUNCTION public.lg_next_targets(uuid,int,int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lg_next_targets(uuid,int,int) TO authenticated, service_role;
