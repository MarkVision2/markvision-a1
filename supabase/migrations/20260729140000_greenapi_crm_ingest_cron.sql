-- Catch-up CRM from Green API journals while n8n owns webhookUrl.
-- Does NOT call setSettings — avoids reclaim fight with bot watcher.
select cron.unschedule('greenapi-crm-ingest-2min')
where exists (select 1 from cron.job where jobname = 'greenapi-crm-ingest-2min');

select cron.schedule(
  'greenapi-crm-ingest-2min',
  '*/2 * * * *',
  $CRON$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/greenapi-crm-ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := jsonb_build_object('source', 'cron', 'minutes', 45)
  );
  $CRON$
);
