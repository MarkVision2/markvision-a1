-- Project websites whitelist for client Supabase (szfgdruhlebfvcmlvxdk).
-- The frontend uses this table from Settings -> Domains to choose allowed
-- landing pages for campaign launches.

create table if not exists public.project_websites (
  id uuid primary key default gen_random_uuid(),
  ad_account_id text not null,
  url text not null,
  label text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_websites_ad_account_url_key
  on public.project_websites (ad_account_id, url);

create unique index if not exists project_websites_one_default_per_account
  on public.project_websites (ad_account_id)
  where is_default;

create index if not exists project_websites_ad_account_idx
  on public.project_websites (ad_account_id, created_at);

create or replace function public.touch_project_websites()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_project_websites
  on public.project_websites;
create trigger trg_touch_project_websites
  before update on public.project_websites
  for each row execute function public.touch_project_websites();

-- Client-config DB is used from the app with the publishable key.
-- Keep this table writable from the frontend like the existing settings tables.
alter table public.project_websites disable row level security;
