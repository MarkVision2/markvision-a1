-- Cron-задача для meta-structure-sync.
-- Запускается ежедневно в 01:30 (UTC) — сразу после meta-daily-sync,
-- который тянет агрегаты по аккаунту. Эта задача доутягивает структуру
-- (кампании / креативы) + insights уровня campaign и ad за последние 14 дней.

SELECT cron.unschedule('meta-structure-sync-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-structure-sync-daily');

SELECT cron.schedule(
  'meta-structure-sync-daily',
  '30 1 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://mekwfbqmsqiborjdrjxc.supabase.co/functions/v1/meta-structure-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Google Ads — ежедневный pull.
SELECT cron.unschedule('google-ads-daily-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google-ads-daily-sync');

SELECT cron.schedule(
  'google-ads-daily-sync',
  '15 1 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://mekwfbqmsqiborjdrjxc.supabase.co/functions/v1/google-ads-daily-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := '{}'::jsonb
  );
  $$
);
