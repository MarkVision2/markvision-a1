-- Cron: раз в 5 минут детектим реальные вступления в WhatsApp-группу
-- (broadcast-group-sync опрашивает getGroupData и проставляет joined_at).
-- Auth: заголовок x-automation-key = automation_settings.cron_secret.
select cron.unschedule('broadcast-group-sync-5min')
where exists (select 1 from cron.job where jobname = 'broadcast-group-sync-5min');

select cron.schedule(
  'broadcast-group-sync-5min',
  '*/5 * * * *',
  $CRON$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/broadcast-group-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-automation-key',(select cron_secret from public.automation_settings where id = true)),
    body    := jsonb_build_object('source','cron'));
  $CRON$
);
