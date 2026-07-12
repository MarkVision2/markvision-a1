-- Google Ads: подготовка БД к подключению рекламного кабинета через OAuth
-- (авторизация Google) — по образцу Meta (meta_oauth_states / *_pending_selections).
--
-- Модель источников трафика в системе:
--   * Meta (Facebook) — платный трафик (ad_cabinets.provider='facebook').
--   * Instagram — органика по код-словам (cf_* / instagram_organic_events).
--   * Google Ads — новый платный источник (ad_cabinets.provider='google').
--
-- Расходы/показы Google уже пишутся в cabinet_daily_insights (provider='google')
-- функциями google-ads-daily-sync / google-ads-intake. Здесь добавляем
-- per-project OAuth: хранение refresh-токена проекта и служебные таблицы потока.

-- 1) Одноразовый state для OAuth-редиректа (TTL проверяется в функции).
create table if not exists public.google_oauth_states (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null,
  return_url  text not null,
  created_at  timestamptz not null default now()
);

-- 2) Отложенный выбор аккаунта, если у Google-логина несколько customer-аккаунтов.
--    refresh_token живёт здесь до завершения выбора (google-oauth-finish).
create table if not exists public.google_oauth_pending_selections (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  user_id           uuid not null,
  refresh_token     text not null,
  login_customer_id text,
  google_email      text,
  accounts          jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now()
);

-- 3) Подключение Google Ads к проекту: refresh-токен + логин-аккаунт (менеджер).
--    Один проект = один Google-логин; под ним может быть несколько customer-
--    аккаунтов (кабинетов), каждый из которых — строка в ad_cabinets(provider='google').
create table if not exists public.google_ads_connections (
  project_id        uuid primary key references public.projects(id) on delete cascade,
  refresh_token     text not null,
  login_customer_id text,
  google_email      text,
  scope             text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- RLS: во всех трёх таблицах лежат токены/секреты. Браузер к ним не обращается —
-- только edge-функции под service role (service role обходит RLS). Включаем RLS
-- без политик = deny-all для anon/authenticated (как у cf_* и токен-таблиц).
alter table public.google_oauth_states             enable row level security;
alter table public.google_oauth_pending_selections enable row level security;
alter table public.google_ads_connections          enable row level security;

-- 4) Атрибуция лидов из Google (паритет с meta_* колонками leads).
--    gclid — Google Click Id, приходит с сайта; *_id — из структуры кабинета.
alter table public.leads add column if not exists gclid text;
alter table public.leads add column if not exists google_campaign_id text;
alter table public.leads add column if not exists google_ad_group_id text;
alter table public.leads add column if not exists google_ad_id text;

create index if not exists idx_leads_gclid on public.leads(gclid) where gclid is not null;
create index if not exists idx_google_oauth_states_created on public.google_oauth_states(created_at);
