-- Живая статистика рассылок: realtime + чаще детектим вступления в группу.
-- UI подписан на broadcast_campaigns / broadcast_recipients, но таблицы
-- не были в supabase_realtime — цифры обновлялись только после F5.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'broadcast_campaigns'
  ) then
    execute 'alter publication supabase_realtime add table public.broadcast_campaigns';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'broadcast_recipients'
  ) then
    execute 'alter publication supabase_realtime add table public.broadcast_recipients';
  end if;
end $$;

-- Replica identity full не обязателен для * events, но помогает UPDATE payloads.
alter table public.broadcast_campaigns replica identity default;
alter table public.broadcast_recipients replica identity default;

-- Детект вступлений: каждые 2 минуты вместо 5.
select cron.unschedule('broadcast-group-sync-5min')
where exists (select 1 from cron.job where jobname = 'broadcast-group-sync-5min');

select cron.unschedule('broadcast-group-sync-2min')
where exists (select 1 from cron.job where jobname = 'broadcast-group-sync-2min');

select cron.schedule(
  'broadcast-group-sync-2min',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/broadcast-group-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-automation-key',(select cron_secret from public.automation_settings where id = true)),
    body    := jsonb_build_object('source','cron')
  );
  $$
);
