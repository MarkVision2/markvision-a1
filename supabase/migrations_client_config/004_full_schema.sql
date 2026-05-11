-- ════════════════════════════════════════════════════════════════════════
-- Полная схема нового Supabase (szfgdruhlebfvcmlvxdk)
-- Запускай ОДНОЙ командой в SQL Editor.
-- Идемпотентно — можно перезапускать.
-- ════════════════════════════════════════════════════════════════════════

-- 0. Снести черновую таблицу client_config (мы перешли на clients_config с "s")
drop table if exists public.client_config cascade;

-- 1. clients_config — главный справочник кабинетов/клиентов
create table if not exists public.clients_config (
  id                    uuid primary key,
  client_name           text not null,
  is_active             boolean not null default true,
  type                  text check (type in ('Личный','Агентский')),
  daily_budget          numeric,
  currency              text default 'KZT',
  city                  text,
  ad_account_id         text,
  page_id               text,
  page_name             text,
  instagram_id          text,
  whatsapp_number       text,
  waba_phone_number_id  text,
  telegram_group_id     text,
  pixel_id              text,
  pixel_event           text default 'Lead',
  website_url           text,
  brief                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists clients_config_ad_account_id_key on public.clients_config(ad_account_id) where ad_account_id is not null;
create unique index if not exists clients_config_waba_phone_id_key on public.clients_config(waba_phone_number_id) where waba_phone_number_id is not null;
create index if not exists clients_config_active_idx on public.clients_config(is_active);

-- 2. clients_secrets — секреты клиента (FK 1:1 на clients_config)
create table if not exists public.clients_secrets (
  client_id              uuid primary key references public.clients_config(id) on delete cascade,
  fb_token               text,
  wa_api_token           text,
  wa_instance_id         text,
  waba_phone_number_id   text,
  updated_at             timestamptz not null default now()
);

-- 3. leads_crm — основной CRM лидов
create table if not exists public.leads_crm (
  id                   uuid primary key default gen_random_uuid(),
  external_lead_id     text,
  lead_id              text,
  phone                text,
  click_id             text,
  fbclid               text,
  fbp                  text,
  fbc                  text,
  fb_ad_account_id     text,
  ad_account_id        text,
  event_id             text,
  event_source_url     text,
  source_url           text,
  client_user_agent    text,
  client_ip_address    text,
  utm_source           text,
  utm_medium           text,
  utm_campaign         text,
  utm_content          text,
  utm_term             text,
  ai_score             numeric,
  lead_score           numeric,
  status               text,
  capi_lead_sent_at    timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists leads_crm_external_lead_id_key on public.leads_crm(external_lead_id) where external_lead_id is not null;
create index if not exists leads_crm_phone_idx           on public.leads_crm(phone);
create index if not exists leads_crm_click_id_idx        on public.leads_crm(click_id);
create index if not exists leads_crm_fb_ad_account_idx   on public.leads_crm(fb_ad_account_id);
create index if not exists leads_crm_ad_account_idx      on public.leads_crm(ad_account_id);
create index if not exists leads_crm_created_at_idx      on public.leads_crm(created_at desc);

-- 4. leads — реестр лидов с подтверждением
create table if not exists public.leads (
  id                       uuid primary key default gen_random_uuid(),
  fb_ad_id                 text,
  fb_ad_account_id         text,
  analysis_date            date,
  ai_score                 numeric,
  score_label              text,
  status                   text,
  city_confirmed           boolean,
  service_confirmed        boolean,
  appointment_confirmed    boolean,
  confirmation_score       numeric,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists leads_fb_ad_id_idx          on public.leads(fb_ad_id);
create index if not exists leads_fb_ad_account_id_idx  on public.leads(fb_ad_account_id);
create index if not exists leads_analysis_date_idx     on public.leads(analysis_date);

-- 5. ad_conversations — анализ диалогов
create table if not exists public.ad_conversations (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   text,
  ad_account_id     text,
  analysis_date     date,
  payload           jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists ad_conversations_conv_idx       on public.ad_conversations(conversation_id);
create index if not exists ad_conversations_ad_account_idx on public.ad_conversations(ad_account_id);

-- 6. campaign_learnings — учёба по кампаниям/адсетам/объявлениям
create table if not exists public.campaign_learnings (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid,
  fb_campaign_id      text,
  fb_adset_id         text,
  fb_ad_id            text,
  quality_score       numeric,
  avg_cpl             numeric,
  days_active         integer,
  total_spend         numeric,
  total_leads         integer,
  cpl_trend           numeric,
  score_trend         numeric,
  depth_3_rate        numeric,
  is_paused           boolean default false,
  is_winner           boolean default false,
  status              text,
  ad_text             text,
  headline            text,
  targeting_json      jsonb,
  ice_breakers        jsonb,
  welcome_message     text,
  lesson_learned      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists campaign_learnings_project_idx       on public.campaign_learnings(project_id);
create index if not exists campaign_learnings_fb_campaign_idx   on public.campaign_learnings(fb_campaign_id);
create index if not exists campaign_learnings_fb_ad_idx         on public.campaign_learnings(fb_ad_id);

-- 7. scoring_insights — рекомендации
create table if not exists public.scoring_insights (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid,
  status                text default 'pending',
  insight_text          text,
  recommendation_type   text,
  impact_percent        numeric,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists scoring_insights_project_status_idx on public.scoring_insights(project_id, status);

-- 8. wa_clicks — клики WhatsApp Click-to-Chat
create table if not exists public.wa_clicks (
  id          uuid primary key default gen_random_uuid(),
  click_id    text unique,
  payload     jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 9. carousel_queue — очередь TG-каруселей
create table if not exists public.carousel_queue (
  id              uuid primary key default gen_random_uuid(),
  media_group_id  text,
  payload         jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists carousel_queue_media_group_idx on public.carousel_queue(media_group_id);

-- ════════════════════════════════════════════════════════════════════════
-- RLS — выключаем для ВСЕХ таблиц, потому что workflow ходит под service_role,
-- а сайт-фронт пишет только в clients_config через service_role-эквивалент.
-- Для clients_config + clients_secrets оставим RLS ON и откроем доступ
-- сервисной роли (по умолчанию service_role игнорирует RLS).
-- ════════════════════════════════════════════════════════════════════════

alter table public.clients_config       disable row level security;
alter table public.clients_secrets      disable row level security;
alter table public.leads_crm            disable row level security;
alter table public.leads                disable row level security;
alter table public.ad_conversations     disable row level security;
alter table public.campaign_learnings   disable row level security;
alter table public.scoring_insights     disable row level security;
alter table public.wa_clicks            disable row level security;
alter table public.carousel_queue       disable row level security;

-- ════════════════════════════════════════════════════════════════════════
-- Сид: Мир без границ
-- ════════════════════════════════════════════════════════════════════════

insert into public.clients_config (
  id, client_name, is_active, type, daily_budget, currency, city,
  ad_account_id, page_id, page_name, instagram_id,
  whatsapp_number, waba_phone_number_id, telegram_group_id,
  pixel_id, pixel_event, website_url, brief
) values (
  '13825a8f-d620-45dd-8fe4-abee1f9d224d'::uuid,
  'Мир без границ',
  true,
  'Личный',
  0,
  'KZT',
  'Алматы',
  'act_987225436848235',
  '386900038793389',
  null,
  '17841403668764729',
  '+77058870644',
  null,
  null,
  '1327704955903997',
  'Lead',
  'https://mir-bez-granic-almaty.lovable.app',
  null
)
on conflict (id) do update set
  client_name           = excluded.client_name,
  is_active             = excluded.is_active,
  type                  = excluded.type,
  daily_budget          = excluded.daily_budget,
  city                  = excluded.city,
  ad_account_id         = excluded.ad_account_id,
  page_id               = excluded.page_id,
  instagram_id          = excluded.instagram_id,
  whatsapp_number       = excluded.whatsapp_number,
  pixel_id              = excluded.pixel_id,
  pixel_event           = excluded.pixel_event,
  website_url           = excluded.website_url,
  updated_at            = now();

insert into public.clients_secrets (client_id, fb_token)
values (
  '13825a8f-d620-45dd-8fe4-abee1f9d224d'::uuid,
  'EAANaVrGsWLYBQx2zJZCYxaz16KSfXDHFwIZA5xuZACh8fXnWD1gHcu4YryOs5lCcydaQ0f0D0EhDteeIZBMpD99QBy2a5BEB6JULlKi81zgQIjqnXo46dixFo1NB0BdHo1wAQkJ1fwdiZAqtg5AY2DY8XLDDPIMsJJbUkkhtswZCt48Vw8WuU5Ml5es1X9egMK'
)
on conflict (client_id) do update set
  fb_token   = excluded.fb_token,
  updated_at = now();
