-- Витрина по каждому подключённому аккаунту для вкладки «Подключённые»
-- на странице «Публикации»: посты, показы/охват, вовлечение, подписчики,
-- статус и скоринг здоровья в одной строке.
--
-- Охват считается по ПОСЛЕДНЕЙ снятой контрольной точке каждого поста
-- (d7 > d3 > d1 > manual): точки кумулятивны, поэтому суммировать все подряд
-- значило бы посчитать один просмотр трижды.
CREATE OR REPLACE VIEW public.publish_account_metrics
WITH (security_invoker = true)
AS
WITH latest AS (
  SELECT DISTINCT ON (m.job_id)
         m.job_id, m.account_id, m.reach, m.views, m.likes, m.comments, m.shares, m.saves, m.captured_at
    FROM public.post_metrics m
   ORDER BY m.job_id,
            CASE m.checkpoint WHEN 'd7' THEN 4 WHEN 'd3' THEN 3 WHEN 'd1' THEN 2 ELSE 1 END DESC,
            m.captured_at DESC
),
agg AS (
  SELECT l.account_id,
         count(*)                     AS measured_posts,
         coalesce(sum(l.reach), 0)    AS reach,
         coalesce(sum(l.views), 0)    AS views,
         coalesce(sum(l.likes), 0)    AS likes,
         coalesce(sum(l.comments), 0) AS comments,
         coalesce(sum(l.shares), 0)   AS shares,
         coalesce(sum(l.saves), 0)    AS saves,
         max(l.captured_at)           AS metrics_updated_at
    FROM latest l
   GROUP BY l.account_id
)
SELECT
  a.id            AS account_id,
  a.project_id,
  a.platform,
  a.account_name,
  a.handle,
  a.status,
  a.publish_enabled,
  a.health_score,
  a.followers,
  a.group_id,
  a.last_post_at,
  a.token_expires_at,
  a.consecutive_errors,
  (SELECT count(*) FROM public.publish_jobs j
    WHERE j.account_id = a.id AND j.status = 'published')                                      AS posts_total,
  (SELECT count(*) FROM public.publish_jobs j
    WHERE j.account_id = a.id AND j.status = 'published'
      AND j.published_at >= now() - interval '30 days')                                        AS posts_30d,
  (SELECT count(*) FROM public.publish_jobs j
    WHERE j.account_id = a.id AND j.status IN ('pending', 'retry'))                            AS jobs_queued,
  (SELECT count(*) FROM public.publish_jobs j
    WHERE j.account_id = a.id AND j.status = 'failed'
      AND j.updated_at >= now() - interval '30 days')                                          AS failed_30d,
  coalesce(g.measured_posts, 0) AS measured_posts,
  coalesce(g.reach, 0)          AS reach,
  coalesce(g.views, 0)          AS views,
  coalesce(g.likes, 0)          AS likes,
  coalesce(g.comments, 0)       AS comments,
  coalesce(g.shares, 0)         AS shares,
  coalesce(g.saves, 0)          AS saves,
  -- ER по охвату: реакции / показы. NULL, когда показов ещё нет —
  -- ноль тут врал бы («вовлечения нет»), хотя метрик просто не сняли.
  CASE WHEN coalesce(g.reach, 0) > 0
       THEN round(100.0 * (g.likes + g.comments + g.shares + g.saves) / g.reach, 2)
  END AS er_percent,
  g.metrics_updated_at
FROM public.publish_accounts a
LEFT JOIN agg g ON g.account_id = a.id;

GRANT SELECT ON public.publish_account_metrics TO authenticated;

COMMENT ON VIEW public.publish_account_metrics IS
  'Строка на подключённый аккаунт: посты, охват/показы по последней контрольной точке, вовлечение, подписчики, статус и здоровье.';
