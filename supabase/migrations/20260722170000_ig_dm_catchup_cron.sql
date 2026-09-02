-- Catch-up for Instagram Direct codewords when Meta drops inbound message webhooks.
-- Runs every minute; auth via x-automation-key = automation_settings.cron_secret.

select cron.unschedule('ig-dm-catchup-minutely')
where exists (select 1 from cron.job where jobname = 'ig-dm-catchup-minutely');

select cron.schedule(
  'ig-dm-catchup-minutely',
  '* * * * *',
  $CRON$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ig-dm-catchup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 55000
  );
  $CRON$
);
