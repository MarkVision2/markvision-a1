-- Cron: трекинг вступлений по публичным /g/:slug invite-ссылкам
select cron.unschedule('group-invite-sync-5min')
where exists (select 1 from cron.job where jobname = 'group-invite-sync-5min');

select cron.schedule(
  'group-invite-sync-5min',
  '*/5 * * * *',
  $CRON$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/group-invite-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-automation-key',(select cron_secret from public.automation_settings where id = true)),
    body    := jsonb_build_object('source','cron'));
  $CRON$
);
