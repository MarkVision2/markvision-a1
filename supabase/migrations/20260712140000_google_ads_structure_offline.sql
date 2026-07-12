-- Google Ads: структура кампаний + офлайн-конверсии (CRM → Google).
--
-- 1) Структура кампаний (паритет с meta_campaigns / meta_campaign_daily):
--    google-ads-structure-sync тянет кампании и их дневную статистику.
-- 2) Офлайн-конверсии: google-ads-offline-conversions отгружает реальные
--    продажи/заявки из CRM обратно в Google Ads по gclid, чтобы алгоритм
--    оптимизировался на деньги, а не на клики.

-- === Структура кампаний ===
create table if not exists public.google_campaigns (
  id           uuid primary key default gen_random_uuid(),
  cabinet_id   uuid,
  project_id   uuid references public.projects(id) on delete cascade,
  customer_id  text,
  campaign_id  text not null unique,
  name         text,
  status       text,
  channel_type text,
  budget_micros bigint,
  last_synced_at timestamptz not null default now()
);

create table if not exists public.google_campaign_daily (
  id          uuid primary key default gen_random_uuid(),
  campaign_id text not null,
  cabinet_id  uuid,
  project_id  uuid references public.projects(id) on delete cascade,
  date        date not null,
  spend       numeric not null default 0,
  impressions integer not null default 0,
  clicks      integer not null default 0,
  leads       numeric not null default 0,
  revenue     numeric not null default 0,
  currency    text not null default 'KZT',
  synced_at   timestamptz not null default now(),
  unique (campaign_id, date)
);

create index if not exists idx_google_campaigns_project on public.google_campaigns(project_id);
create index if not exists idx_google_campaign_daily_project_date on public.google_campaign_daily(project_id, date);

-- RLS: члены проекта читают структуру своего проекта (для будущего UI);
-- пишет только service role (sync-функция).
alter table public.google_campaigns      enable row level security;
alter table public.google_campaign_daily enable row level security;

drop policy if exists google_campaigns_select on public.google_campaigns;
create policy google_campaigns_select on public.google_campaigns
  for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or user_can_access_project(project_id));

drop policy if exists google_campaign_daily_select on public.google_campaign_daily;
create policy google_campaign_daily_select on public.google_campaign_daily
  for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or user_can_access_project(project_id));

-- === Офлайн-конверсии ===
-- Resource name конверсионного действия из Google Ads
-- ("customers/{cid}/conversionActions/{id}") — задаётся на подключении проекта.
alter table public.google_ads_connections add column if not exists conversion_action_sale text;
alter table public.google_ads_connections add column if not exists conversion_action_lead text;

-- Журнал отгруженных конверсий — идемпотентность (одна продажа = одна отгрузка).
create table if not exists public.google_offline_conversions (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.projects(id) on delete cascade,
  lead_id         uuid,
  gclid           text,
  customer_id     text,
  action_type     text not null,           -- 'sale' | 'lead'
  conversion_time timestamptz,
  value           numeric,
  currency        text,
  status          text not null default 'uploaded',
  error           text,
  created_at      timestamptz not null default now(),
  unique (lead_id, action_type)
);
-- Только service role (offline-conversions функция).
alter table public.google_offline_conversions enable row level security;
