-- Фикс 401 Unauthorized в cron meta-daily-sync-daily.
--
-- Проблема: cron слал заголовок `x-cron-key` со значением `cron_secret` из
-- automation_settings, но edge-функция проверяла env-переменную
-- META_SYNC_CRON_KEY. Если env не задана, проверка не проходила и функция
-- возвращала 401.
--
-- Решение: переключаем cron на `x-automation-key` (тот же заголовок, что
-- использует crm-automations). Edge-функция meta-daily-sync обновлена
-- параллельно — она теперь принимает оба варианта.

SELECT cron.unschedule('meta-daily-sync-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-daily-sync-daily');

SELECT cron.schedule(
  'meta-daily-sync-daily',
  '30 0 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://mekwfbqmsqiborjdrjxc.supabase.co/functions/v1/meta-daily-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := '{}'::jsonb
  );
  $$
);
