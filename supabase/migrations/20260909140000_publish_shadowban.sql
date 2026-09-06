-- Детекция теневого бана по просмотрам (ТЗ сети аккаунтов, п. 4.6; GAP-аудит п. 15).
--
-- Площадка не сообщает о теневом бане; единственный наблюдаемый признак — просмотры
-- новых постов аккаунта падают в разы при прежнем графике. Сравниваем последние
-- p_recent постов аккаунта с его же медианой по более ранним постам (одна и та же
-- контрольная точка d1, чтобы не сравнивать суточные просмотры с недельными).
-- Решение принимает publish-monitor (mode = shadow, крон раз в сутки): подозрение →
-- status = limited (планировщик и claim такие аккаунты не берут), просмотры вернулись
-- → status = active. Функция только считает и ничего не меняет.
CREATE OR REPLACE FUNCTION public.publish_shadowban_scan(
  p_recent integer DEFAULT 3,        -- сколько последних постов считаем «сейчас»
  p_min_baseline integer DEFAULT 5,  -- минимум более ранних постов для медианы
  p_drop numeric DEFAULT 0.3,        -- подозрение: сейчас < 30 % от медианы
  p_min_views integer DEFAULT 50     -- медиана ниже — данных для вывода нет
) RETURNS TABLE (
  account_id uuid,
  project_id uuid,
  account_name text,
  platform text,
  status text,
  last_error text,
  baseline_views numeric,
  recent_views numeric,
  ratio numeric,
  suspect boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d1 AS (
    SELECT m.account_id, m.job_id, greatest(m.views, m.reach)::numeric AS v, j.published_at
      FROM public.post_metrics m
      JOIN public.publish_jobs j ON j.id = m.job_id
     WHERE m.checkpoint = 'd1'
       AND j.published_at >= now() - interval '60 days'
  ),
  ranked AS (
    SELECT d1.*, row_number() OVER (PARTITION BY d1.account_id ORDER BY d1.published_at DESC) AS rn FROM d1
  ),
  agg AS (
    SELECT r.account_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.v) FILTER (WHERE r.rn > p_recent) AS baseline,
           count(*) FILTER (WHERE r.rn > p_recent)  AS n_base,
           avg(r.v) FILTER (WHERE r.rn <= p_recent) AS recent,
           count(*) FILTER (WHERE r.rn <= p_recent) AS n_recent
      FROM ranked r
     GROUP BY r.account_id
  )
  SELECT a.id, a.project_id, a.account_name, a.platform, a.status, a.last_error,
         round(g.baseline::numeric, 1),
         round(g.recent::numeric, 1),
         CASE WHEN g.baseline > 0 THEN round((g.recent / g.baseline)::numeric, 3) END,
         (g.baseline >= p_min_views AND g.recent < g.baseline * p_drop)
    FROM public.publish_accounts a
    JOIN agg g ON g.account_id = a.id
   WHERE a.status IN ('active', 'limited')
     AND g.n_base >= p_min_baseline
     AND g.n_recent >= p_recent;
$$;

COMMENT ON FUNCTION public.publish_shadowban_scan(integer, integer, numeric, integer) IS
  'Аккаунты с достаточной статистикой d1: медиана ранних постов, среднее последних, suspect = падение ниже p_drop.';

REVOKE ALL ON FUNCTION public.publish_shadowban_scan(integer, integer, numeric, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_shadowban_scan(integer, integer, numeric, integer) TO service_role;

-- Раз в сутки, после ночного сбора метрик (publish-metrics в 00:20 / 06:20 UTC).
SELECT cron.unschedule('publish-monitor-shadow-daily')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-monitor-shadow-daily');
SELECT cron.schedule(
  'publish-monitor-shadow-daily',
  '40 6 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('mode', 'shadow')
  );
  $$
);
