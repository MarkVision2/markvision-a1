-- Удаляем старое расписание если было
SELECT cron.unschedule('crm-automations-every-10min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-automations-every-10min');

SELECT cron.schedule(
  'crm-automations-every-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://xwhfixsqhbkdnnxrryux.supabase.co/functions/v1/crm-automations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body := '{}'::jsonb
  );
  $$
);