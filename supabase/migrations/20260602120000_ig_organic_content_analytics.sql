-- Instagram organic content analytics: short links, sales in stats, project-scoped writes.

-- 1) Short IDs for ig-organic-redirect (?c=<short_id>)
ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS short_id text;

CREATE OR REPLACE FUNCTION public.gen_codeword_short_id()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=', ''), 1, 10)
$$;

UPDATE public.instagram_codewords
   SET short_id = public.gen_codeword_short_id()
 WHERE short_id IS NULL;

-- Ensure uniqueness (retry collisions)
DO $$
DECLARE
  r record;
  v_new text;
BEGIN
  FOR r IN
    SELECT id FROM public.instagram_codewords c1
    WHERE EXISTS (
      SELECT 1 FROM public.instagram_codewords c2
      WHERE c2.short_id = c1.short_id AND c2.id <> c1.id
    )
  LOOP
    LOOP
      v_new := public.gen_codeword_short_id();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.instagram_codewords WHERE short_id = v_new
      );
    END LOOP;
    UPDATE public.instagram_codewords SET short_id = v_new WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.instagram_codewords
  ALTER COLUMN short_id SET NOT NULL,
  ALTER COLUMN short_id SET DEFAULT public.gen_codeword_short_id();

CREATE UNIQUE INDEX IF NOT EXISTS instagram_codewords_short_id_key
  ON public.instagram_codewords(short_id);

-- 2) Resolve short_id → codeword row (for edge / tooling)
CREATE OR REPLACE FUNCTION public.resolve_codeword_short(p_short_id text)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  codeword text,
  target_url text,
  reel_url text,
  active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.project_id, w.codeword, w.target_url, w.reel_url, w.active
    FROM public.instagram_codewords w
   WHERE w.short_id = p_short_id
     AND w.active = true
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.resolve_codeword_short(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_codeword_short(text) TO service_role;

-- 3) Project members can manage codewords (not only admin)
DROP POLICY IF EXISTS ig_codewords_write_admin ON public.instagram_codewords;
CREATE POLICY ig_codewords_insert_scoped ON public.instagram_codewords
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_project(project_id));

CREATE POLICY ig_codewords_update_scoped ON public.instagram_codewords
  FOR UPDATE TO authenticated
  USING (public.user_can_access_project(project_id))
  WITH CHECK (public.user_can_access_project(project_id));

CREATE POLICY ig_codewords_delete_scoped ON public.instagram_codewords
  FOR DELETE TO authenticated
  USING (public.user_can_access_project(project_id));

-- 4) Enriched stats: unique users, sales, revenue
CREATE OR REPLACE VIEW public.instagram_codeword_stats AS
SELECT
  w.id                                                          AS codeword_id,
  w.project_id,
  w.codeword,
  w.short_id,
  w.reel_url,
  w.thumbnail_url,
  w.active,
  COUNT(e.*) FILTER (WHERE e.event_type = 'codeword_dm')         AS codeword_dms,
  COUNT(DISTINCT e.username) FILTER (WHERE e.event_type = 'codeword_dm' AND e.username IS NOT NULL)
                                                                AS unique_users,
  COUNT(e.*) FILTER (WHERE e.event_type = 'link_click')          AS link_clicks,
  COUNT(e.*) FILTER (WHERE e.event_type = 'lead')                AS leads,
  COUNT(l.id) FILTER (WHERE e.event_type = 'lead' AND l.paid = true)
                                                                AS sales,
  COALESCE(SUM(l.amount) FILTER (WHERE e.event_type = 'lead' AND l.paid = true), 0)
                                                                AS revenue,
  MAX(e.occurred_at)                                             AS last_event_at
FROM public.instagram_codewords w
LEFT JOIN public.instagram_organic_events e ON e.codeword_id = w.id
LEFT JOIN public.leads l ON l.id = e.lead_id
GROUP BY w.id, w.project_id, w.codeword, w.short_id, w.reel_url, w.thumbnail_url, w.active;

COMMENT ON VIEW public.instagram_codeword_stats IS
  'Воронка по код-слову: DM → клики → лиды → продажи/выручка из CRM.';

-- 5) Daily trend per codeword (для графика на /analytics/content)
CREATE OR REPLACE VIEW public.instagram_reel_daily AS
SELECT
  e.project_id,
  e.codeword_id,
  e.codeword,
  e.date,
  COUNT(*) FILTER (WHERE e.event_type = 'codeword_dm')     AS codeword_dms,
  COUNT(*) FILTER (WHERE e.event_type = 'link_click')        AS link_clicks,
  COUNT(*) FILTER (WHERE e.event_type = 'lead')              AS leads
FROM public.instagram_organic_events e
WHERE e.project_id IS NOT NULL
  AND e.codeword_id IS NOT NULL
GROUP BY e.project_id, e.codeword_id, e.codeword, e.date;

COMMENT ON VIEW public.instagram_reel_daily IS
  'Дневная воронка Instagram organic по код-слову.';

ALTER VIEW public.instagram_codeword_stats SET (security_invoker = true);
ALTER VIEW public.instagram_reel_daily SET (security_invoker = true);
