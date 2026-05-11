-- Запусти это в SQL Editor проекта szfgdruhlebfvcmlvxdk
-- (Supabase Dashboard → SQL Editor → New query → вставить → Run)

create table if not exists public.client_config (
  cabinet_id        uuid primary key,
  name              text not null,
  type              text not null check (type in ('Личный','Агентский')),
  daily_budget      numeric,
  city              text,
  ad_account_id     text,
  page_id           text,
  page_name         text,
  instagram_id      text,
  access_token      text,
  telegram_group_id text,
  whatsapp_number   text,
  pixel_id          text,
  pixel_event       text,
  website_url       text,
  brief             text,
  created_at        timestamptz not null default now()
);

alter table public.client_config enable row level security;

-- Анонимная вставка (публикуемый ключ). Подкрути под свой security model.
drop policy if exists "client_config insert anon" on public.client_config;
create policy "client_config insert anon"
  on public.client_config for insert
  to anon, authenticated
  with check (true);

drop policy if exists "client_config select anon" on public.client_config;
create policy "client_config select anon"
  on public.client_config for select
  to anon, authenticated
  using (true);
