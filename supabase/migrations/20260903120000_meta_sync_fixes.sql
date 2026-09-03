-- Meta-синхронизация: чинит две вещи.
--
-- 1) Cron-задачи meta-daily-sync / meta-structure-sync с мая всё ещё стучались
--    в старый проект mekwfbqmsqiborjdrjxc (Lovable). После переезда на szfg
--    ночная синхронизация не выполнялась вообще — данные появлялись только
--    когда пользователь жал «Получить статистику» в интерфейсе.
--
-- 2) Синк начал писать клики по ссылке (inline_link_clicks) и начатые переписки
--    отдельными колонками: по link_clicks Ads Manager считает CTR и CPC, а
--    messages показывает, сколько лидов пришло из переписок.

-- ---------- Колонки ----------

alter table public.cabinet_daily_insights
  add column if not exists link_clicks integer not null default 0,
  add column if not exists messages integer not null default 0;

comment on column public.cabinet_daily_insights.link_clicks is
  'Клики по ссылке (inline_link_clicks). По ним считаются CTR и CPC — как в Ads Manager.';
comment on column public.cabinet_daily_insights.messages is
  'Начатые переписки за день (входят в leads, не суммируются с ними повторно).';

alter table public.meta_campaign_daily
  add column if not exists link_clicks integer not null default 0;

alter table public.meta_creative_daily
  add column if not exists link_clicks integer not null default 0;

-- ---------- Cron на актуальный проект ----------

select cron.unschedule('meta-daily-sync-daily')
where exists (select 1 from cron.job where jobname = 'meta-daily-sync-daily');

select cron.schedule(
  'meta-daily-sync-daily',
  '30 0 * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/meta-daily-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := '{}'::jsonb
  );
  $$
);

select cron.unschedule('meta-structure-sync-daily')
where exists (select 1 from cron.job where jobname = 'meta-structure-sync-daily');

select cron.schedule(
  'meta-structure-sync-daily',
  '30 1 * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/meta-structure-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- google-ads-daily-sync ехал в том же старом файле — переводим тем же ключом.
select cron.unschedule('google-ads-daily-sync')
where exists (select 1 from cron.job where jobname = 'google-ads-daily-sync');

select cron.schedule(
  'google-ads-daily-sync',
  '15 1 * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/google-ads-daily-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := '{}'::jsonb
  );
  $$
);
