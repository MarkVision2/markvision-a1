-- Радар идей: «обычно» автора считаем по последним 40 его постам, а не по
-- окну в 90 дней — у неактивных аккаунтов все собранные посты старше окна,
-- и X-фактор оставался пустым.
CREATE OR REPLACE FUNCTION public.radar_recompute_author(
  p_project_id uuid,
  p_platform text,
  p_author_handle text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
BEGIN
  IF p_author_handle IS NULL THEN RETURN 0; END IF;
  WITH posts AS (
    SELECT r.id,
           coalesce((r.metrics->>'views')::numeric, 0) AS views,
           coalesce((r.metrics->>'likes')::numeric, 0) AS likes,
           coalesce((r.metrics->>'likes')::numeric, 0)
             + coalesce((r.metrics->>'comments')::numeric, 0)
             + coalesce((r.metrics->>'shares')::numeric, 0)
             + coalesce((r.metrics->>'saves')::numeric, 0) AS interactions,
           r.followers,
           r.published_at, r.created_at, r.updated_at,
           (r.analysis->>'score')::numeric AS llm
      FROM public.radar_posts r
     WHERE r.project_id = p_project_id
       AND r.platform = p_platform
       AND r.author_handle = p_author_handle
     ORDER BY coalesce(r.published_at, r.created_at) DESC
     LIMIT 40
  ),
  base AS (
    SELECT p.id,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.views)
              FROM posts o WHERE o.id <> p.id AND o.views > 0)::numeric AS med_views,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.likes)
              FROM posts o WHERE o.id <> p.id AND o.likes > 0)::numeric AS med_likes
      FROM posts p
  ),
  calc AS (
    SELECT p.id, p.views, p.likes, p.interactions, p.followers, p.llm,
           b.med_views, b.med_likes,
           public.radar_norm_views(p.followers) AS norm,
           greatest(extract(epoch FROM (coalesce(p.updated_at, now()) - coalesce(p.published_at, p.created_at))) / 3600.0, 1) AS hours
      FROM posts p JOIN base b ON b.id = p.id
  ),
  final AS (
    SELECT c.id, c.med_views, c.med_likes, c.norm,
           CASE WHEN coalesce(c.followers, 0) > 0 THEN c.interactions / c.followers END AS er,
           c.interactions / c.hours AS velocity,
           c.llm,
           CASE
             WHEN c.views > 0 AND coalesce(c.med_views, 0) > 0 THEN c.views / c.med_views
             WHEN c.views > 0 AND coalesce(c.norm, 0) > 0 THEN c.views / c.norm
             WHEN c.likes > 0 AND coalesce(c.med_likes, 0) > 0 THEN c.likes / c.med_likes
             ELSE NULL
           END AS xf
      FROM calc c
  )
  UPDATE public.radar_posts r
     SET baseline_views = f.med_views,
         baseline_likes = f.med_likes,
         norm_views = f.norm,
         x_factor = CASE WHEN f.xf IS NULL THEN NULL ELSE round(f.xf::numeric, 2) END,
         engagement_rate = f.er,
         velocity = f.velocity,
         score = public.radar_post_score_v2(f.er, f.velocity, f.llm, f.xf)
    FROM final f
   WHERE r.id = f.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

DO $$
DECLARE a record;
BEGIN
  FOR a IN SELECT DISTINCT project_id, platform, author_handle FROM public.radar_posts WHERE author_handle IS NOT NULL LOOP
    PERFORM public.radar_recompute_author(a.project_id, a.platform, a.author_handle);
  END LOOP;
END $$;
