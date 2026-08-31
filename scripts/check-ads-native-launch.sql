-- Проверка, что нативный запуск рекламы полностью развёрнут на проде.
-- Только чтение. Вставить в Supabase SQL Editor и выполнить целиком.
--
-- Что должно получиться:
--   tables    — 5 из 5
--   functions — 4 из 4
--   crons     — 4 из 4, все active
--   flag      — ads_launch_native = true
--   pg_net    — установлен
-- Любая строка со статусом ПРОБЛЕМА означает, что этот кусок не применился.

with expected_tables(name) as (
  values ('ad_launch_jobs'), ('ad_campaign_groups'), ('ad_telegram_media'),
         ('ad_cabinet_websites'), ('ads_optimizer_settings')
),
expected_functions(name) as (
  values ('claim_ad_launch_jobs'), ('claim_ad_campaign_group'),
         ('set_ad_campaign_group_campaign'), ('cleanup_ad_telegram_media')
),
expected_crons(name) as (
  values ('ads-launch-worker-minutely'), ('ads-optimizer-morning'),
         ('ads-optimizer-night'), ('ads-telegram-media-cleanup')
)
select 'tables' as check,
       count(*) filter (where t.tablename is not null) || ' / ' || count(*) as got,
       case when count(*) filter (where t.tablename is null) = 0 then 'ok' else 'ПРОБЛЕМА: ' ||
            string_agg(e.name, ', ') filter (where t.tablename is null) end as status
  from expected_tables e
  left join pg_tables t on t.schemaname = 'public' and t.tablename = e.name

union all
select 'functions',
       count(*) filter (where p.proname is not null) || ' / ' || count(*),
       case when count(*) filter (where p.proname is null) = 0 then 'ok' else 'ПРОБЛЕМА: ' ||
            string_agg(e.name, ', ') filter (where p.proname is null) end
  from expected_functions e
  left join pg_proc p
    on p.proname = e.name
   and p.pronamespace = 'public'::regnamespace

union all
select 'crons',
       count(*) filter (where c.jobname is not null) || ' / ' || count(*),
       case
         when count(*) filter (where c.jobname is null) > 0 then 'ПРОБЛЕМА: нет ' ||
              string_agg(e.name, ', ') filter (where c.jobname is null)
         when count(*) filter (where not c.active) > 0 then 'ПРОБЛЕМА: выключены ' ||
              string_agg(e.name, ', ') filter (where not c.active)
         else 'ok'
       end
  from expected_crons e
  left join cron.job c on c.jobname = e.name

union all
select 'flag',
       coalesce((select ads_launch_native::text from public.automation_settings where id = true), '(нет строки)'),
       case when (select ads_launch_native from public.automation_settings where id = true) then 'ok'
            else 'ПРОБЛЕМА: нативный запуск выключен, сайт уйдёт в n8n' end

union all
select 'pg_net',
       coalesce((select extversion from pg_extension where extname = 'pg_net'), '(нет)'),
       case when exists (select 1 from pg_extension where extname = 'pg_net') then 'ok'
            else 'ПРОБЛЕМА: кроны не смогут вызывать edge-функции' end

union all
-- Кроны ходят в edge-функции с заголовком x-automation-key из этого поля.
-- Пустое значение = вызовы отлетают по авторизации, очередь стоит.
select 'cron_secret',
       case when coalesce((select cron_secret from public.automation_settings where id = true), '') <> ''
            then 'задан' else '(пусто)' end,
       case when coalesce((select cron_secret from public.automation_settings where id = true), '') <> ''
            then 'ok' else 'ПРОБЛЕМА: кроны не пройдут авторизацию в edge-функциях' end;

-- Последние срабатывания крона воркера (пусто = крон ещё ни разу не отработал).
select jobname, status, start_time, left(coalesce(return_message, ''), 120) as message
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
 where j.jobname in ('ads-launch-worker-minutely', 'ads-optimizer-morning', 'ads-optimizer-night')
 order by start_time desc
 limit 10;

-- Очередь запусков: должна быть пустой или без застрявших error.
select status, count(*), max(created_at) as last_at
  from public.ad_launch_jobs
 group by status
 order by count(*) desc;
