-- Радар идей: «X-фактор» поста — во сколько раз публикация обошла обычный
-- результат автора (как в viralex.ai: «обычно 5 932 — сейчас 40 400 560, ×6811»).
--
--   baseline_views / baseline_likes — медиана просмотров / лайков по другим
--                    публикациям того же автора в проекте (за 90 дней);
--   norm_views     — ожидаемые просмотры для аудитории автора: 3.75 · followers^0.68
--                    (степенная кривая, снятая с публичных данных viralex);
--   x_factor       — views / baseline_views (если просмотров нет — likes / baseline_likes;
--                    если у автора один пост — views / norm_views).
-- Оценка поста учитывает X-фактор бонусом до +15 (radar_post_score_v2).

ALTER TABLE public.radar_posts
  ADD COLUMN IF NOT EXISTS baseline_views numeric,
  ADD COLUMN IF NOT EXISTS baseline_likes numeric,
  ADD COLUMN IF NOT EXISTS norm_views numeric,
  ADD COLUMN IF NOT EXISTS x_factor numeric;

COMMENT ON COLUMN public.radar_posts.x_factor IS
  'Во сколько раз пост обошёл обычный результат автора (медиана его постов) или норму для его аудитории.';

CREATE INDEX IF NOT EXISTS radar_posts_author_idx
  ON public.radar_posts (project_id, platform, author_handle, published_at DESC);
CREATE INDEX IF NOT EXISTS radar_posts_xfactor_idx
  ON public.radar_posts (project_id, x_factor DESC NULLS LAST);

-- Ожидаемые просмотры по числу подписчиков.
CREATE OR REPLACE FUNCTION public.radar_norm_views(p_followers numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN coalesce(p_followers, 0) <= 0 THEN NULL
              ELSE round(3.75 * power(p_followers, 0.68)) END;
$$;

-- Оценка с учётом X-фактора: старая формула + бонус до 15 за превышение нормы автора.
CREATE OR REPLACE FUNCTION public.radar_post_score_v2(
  p_engagement_rate numeric,
  p_velocity numeric,
  p_llm_score numeric,
  p_x_factor numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(least(100,
    public.radar_post_score(p_engagement_rate, p_velocity, p_llm_score)
    + CASE WHEN coalesce(p_x_factor, 0) > 1
           THEN 15 * (1 - exp(-(p_x_factor - 1) / 3.0))
           ELSE 0 END), 1);
$$;

GRANT EXECUTE ON FUNCTION public.radar_norm_views(numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.radar_post_score_v2(numeric, numeric, numeric, numeric) TO authenticated, service_role;

-- Пересчёт всех постов автора (медианы меняются с каждым новым сбором).
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
       AND coalesce(r.published_at, r.created_at) >= now() - interval '90 days'
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

-- Пересчёт одного поста теперь идёт через автора (чтобы медианы были согласованы).
CREATE OR REPLACE FUNCTION public.radar_recompute_post(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.radar_posts%ROWTYPE;
  interactions numeric;
  hours numeric;
BEGIN
  SELECT * INTO r FROM public.radar_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.author_handle IS NOT NULL THEN
    PERFORM public.radar_recompute_author(r.project_id, r.platform, r.author_handle);
    RETURN;
  END IF;
  interactions :=
      coalesce((r.metrics->>'likes')::numeric, 0)
    + coalesce((r.metrics->>'comments')::numeric, 0)
    + coalesce((r.metrics->>'shares')::numeric, 0)
    + coalesce((r.metrics->>'saves')::numeric, 0);
  hours := greatest(extract(epoch FROM (coalesce(r.updated_at, now()) - coalesce(r.published_at, r.created_at))) / 3600.0, 1);
  UPDATE public.radar_posts
     SET engagement_rate = CASE WHEN coalesce(r.followers, 0) > 0 THEN interactions / r.followers ELSE NULL END,
         velocity = interactions / hours,
         norm_views = public.radar_norm_views(r.followers),
         x_factor = CASE WHEN coalesce((r.metrics->>'views')::numeric, 0) > 0 AND public.radar_norm_views(r.followers) > 0
                         THEN round((r.metrics->>'views')::numeric / public.radar_norm_views(r.followers), 2) END,
         score = public.radar_post_score_v2(
           CASE WHEN coalesce(r.followers, 0) > 0 THEN interactions / r.followers ELSE NULL END,
           interactions / hours,
           (r.analysis->>'score')::numeric,
           CASE WHEN coalesce((r.metrics->>'views')::numeric, 0) > 0 AND public.radar_norm_views(r.followers) > 0
                THEN (r.metrics->>'views')::numeric / public.radar_norm_views(r.followers) END
         )
   WHERE id = p_post_id;
END;
$$;

REVOKE ALL ON FUNCTION public.radar_recompute_author(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.radar_recompute_author(uuid, text, text) TO service_role;

-- Пересчитать уже собранное.
DO $$
DECLARE a record;
BEGIN
  FOR a IN SELECT DISTINCT project_id, platform, author_handle FROM public.radar_posts WHERE author_handle IS NOT NULL LOOP
    PERFORM public.radar_recompute_author(a.project_id, a.platform, a.author_handle);
  END LOOP;
END $$;

-- Витрина: посты под наблюдением и последний сбор — для строки статуса радара.
-- Колонки добавляются в середину, поэтому пересоздаём (CREATE OR REPLACE это запрещает).
DROP VIEW IF EXISTS public.radar_metrics;
CREATE VIEW public.radar_metrics
WITH (security_invoker = true)
AS
SELECT
  p.id AS project_id,
  (SELECT count(*) FROM public.radar_sources s WHERE s.project_id = p.id AND s.enabled) AS sources,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id) AS posts_total,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id
     AND r.created_at >= now() - interval '7 days') AS posts_7d,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id
     AND r.analysis_status IN ('pending', 'failed')) AS posts_unanalyzed,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id AND r.x_factor >= 2) AS posts_viral,
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id AND i.status = 'new') AS ideas_new,
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id AND i.status = 'used') AS ideas_used,
  (SELECT coalesce(sum(cost_usd), 0) FROM public.radar_runs rr WHERE rr.project_id = p.id
     AND rr.started_at >= date_trunc('month', now())) AS spent_month_usd,
  (SELECT max(rr.finished_at) FROM public.radar_runs rr WHERE rr.project_id = p.id AND rr.status = 'done') AS last_run_at
FROM public.projects p;

GRANT SELECT ON public.radar_metrics TO authenticated;
