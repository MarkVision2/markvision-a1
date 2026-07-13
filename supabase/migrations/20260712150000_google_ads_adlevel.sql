-- Google Ads: уровень групп объявлений и объявлений (паритет с meta_creatives /
-- meta_creative_daily). Наполняет google-ads-structure-sync. Чтение под RLS
-- (члены проекта видят своё), запись — service role.

create table if not exists public.google_ad_groups (
  id           uuid primary key default gen_random_uuid(),
  ad_group_id  text not null unique,
  campaign_id  text,
  project_id   uuid references public.projects(id) on delete cascade,
  cabinet_id   uuid,
  name         text,
  status       text,
  last_synced_at timestamptz not null default now()
);

create table if not exists public.google_creatives (
  id           uuid primary key default gen_random_uuid(),
  ad_id        text not null unique,
  ad_group_id  text,
  campaign_id  text,
  project_id   uuid references public.projects(id) on delete cascade,
  cabinet_id   uuid,
  name         text,
  type         text,
  status       text,
  last_synced_at timestamptz not null default now()
);

create table if not exists public.google_creative_daily (
  id          uuid primary key default gen_random_uuid(),
  ad_id       text not null,
  ad_group_id text,
  campaign_id text,
  project_id  uuid references public.projects(id) on delete cascade,
  cabinet_id  uuid,
  date        date not null,
  spend       numeric not null default 0,
  impressions integer not null default 0,
  clicks      integer not null default 0,
  leads       numeric not null default 0,
  revenue     numeric not null default 0,
  currency    text not null default 'KZT',
  synced_at   timestamptz not null default now(),
  unique (ad_id, date)
);

create index if not exists idx_google_ad_groups_project on public.google_ad_groups(project_id);
create index if not exists idx_google_creatives_project on public.google_creatives(project_id);
create index if not exists idx_google_creative_daily_project_date on public.google_creative_daily(project_id, date);

alter table public.google_ad_groups      enable row level security;
alter table public.google_creatives      enable row level security;
alter table public.google_creative_daily enable row level security;

drop policy if exists google_ad_groups_select on public.google_ad_groups;
create policy google_ad_groups_select on public.google_ad_groups
  for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or user_can_access_project(project_id));

drop policy if exists google_creatives_select on public.google_creatives;
create policy google_creatives_select on public.google_creatives
  for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or user_can_access_project(project_id));

drop policy if exists google_creative_daily_select on public.google_creative_daily;
create policy google_creative_daily_select on public.google_creative_daily
  for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or user_can_access_project(project_id));
