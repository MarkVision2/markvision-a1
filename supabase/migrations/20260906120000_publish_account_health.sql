-- Здоровье аккаунта становится проверяемым: когда аккаунт последний раз
-- проверяли у площадки и из чего сложилась оценка. Раньше health_score был
-- счётчиком (+1/−10), который ничего не проверял и у всех показывал 100.
ALTER TABLE public.publish_accounts
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS health_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.publish_accounts.last_checked_at IS
  'Последняя живая проверка токена у площадки (publish-monitor mode=health|tokens).';
COMMENT ON COLUMN public.publish_accounts.health_reasons IS
  'Из чего сложился health_score — список причин для подсказки в интерфейсе (_lib/publishHealth.ts).';

-- Витрина по аккаунтам получает те же поля. Пересоздаём целиком:
-- CREATE OR REPLACE VIEW не даёт добавить колонки в середину списка.
DROP VIEW IF EXISTS public.publish_account_metrics;
CREATE VIEW public.publish_account_metrics
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
  a.health_reasons,
  a.last_checked_at,
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
  CASE WHEN coalesce(g.reach, 0) > 0
       THEN round(100.0 * (g.likes + g.comments + g.shares + g.saves) / g.reach, 2)
  END AS er_percent,
  g.metrics_updated_at
FROM public.publish_accounts a
LEFT JOIN agg g ON g.account_id = a.id;

GRANT SELECT ON public.publish_account_metrics TO authenticated;

-- Проверка здоровья всей сети раз в 6 часов (суточная проверка токенов остаётся).
SELECT cron.unschedule('publish-monitor-health-6h')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-monitor-health-6h');
SELECT cron.schedule(
  'publish-monitor-health-6h',
  '40 */6 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('mode', 'health')
  );
  $$
);
