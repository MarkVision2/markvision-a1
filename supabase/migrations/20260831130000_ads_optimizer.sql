-- ============================================================
-- Ежедневная оптимизация рекламы своими силами: пороги в настройках проекта,
-- решение — в edge-функции ads-optimizer, расписание — в pg_cron.
--
-- До этого пауза убыточных кампаний и рост бюджета у победителей жили в ноде
-- n8n `Auto-Pause`, где все пороги были константами в коде: поменять лимит CPL
-- одному клиенту было нельзя, не задев остальных.
-- ============================================================

create table if not exists public.ads_optimizer_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  enabled boolean not null default true,

  -- Остановка убыточных.
  max_cpl                     numeric not null default 4,     -- $ за лид, 3 дня
  max_spend_no_lead           numeric not null default 15,    -- $ за 3 дня без лидов
  emergency_spend             numeric not null default 10,    -- $ за сегодня без лидов
  min_quality_score           integer not null default 45,
  quality_shield              integer not null default 70,    -- выше — высокий CPL прощаем
  grace_period_days           integer not null default 5,     -- защита новых кампаний

  -- Рост победителей.
  scale_min_score             integer not null default 75,
  scale_max_cpl               numeric not null default 2.5,
  scale_step                  numeric not null default 1.2,
  scale_cap_usd               numeric not null default 50,
  crm_scale_cap_usd           numeric not null default 100,   -- при оплатах в CRM
  scale_min_depth3_rate       integer not null default 30,

  -- Качество лидов по ai_score из CRM.
  qualified_ai_score_min      integer not null default 70,
  qualified_rate_min_pause    integer not null default 20,
  qualified_rate_min_scale    integer not null default 50,
  qualified_leads_min_for_pause integer not null default 5,

  -- Выгорание креатива (только предупреждение в отчёт).
  fatigue_frequency           numeric not null default 3.0,
  fatigue_frequency_soft      numeric not null default 2.0,
  fatigue_ctr_drop            numeric not null default 0.7,
  fatigue_min_impressions     integer not null default 1500,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_ads_optimizer_settings_updated on public.ads_optimizer_settings;
create trigger trg_ads_optimizer_settings_updated
  before update on public.ads_optimizer_settings
  for each row execute function public.update_updated_at_column();

alter table public.ads_optimizer_settings enable row level security;

-- Пороги видят участники проекта, меняет — админ.
drop policy if exists ads_optimizer_settings_select on public.ads_optimizer_settings;
create policy ads_optimizer_settings_select on public.ads_optimizer_settings
  for select to authenticated
  using (public.user_can_access_project(project_id));

drop policy if exists ads_optimizer_settings_write on public.ads_optimizer_settings;
create policy ads_optimizer_settings_write on public.ads_optimizer_settings
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ── Расписание ──────────────────────────────────────────────
-- Утро 10:00 и вечер 22:00 по Алматы (UTC+5) — как в n8n. Утренний прогон
-- только отчитывается, вечерний вносит изменения.
select cron.unschedule('ads-optimizer-morning')
where exists (select 1 from cron.job where jobname = 'ads-optimizer-morning');
select cron.unschedule('ads-optimizer-night')
where exists (select 1 from cron.job where jobname = 'ads-optimizer-night');

select cron.schedule(
  'ads-optimizer-morning',
  '0 5 * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ads-optimizer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := jsonb_build_object('mode', 'morning')
  );
  $$
);

select cron.schedule(
  'ads-optimizer-night',
  '0 17 * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ads-optimizer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := jsonb_build_object('mode', 'night')
  );
  $$
);
