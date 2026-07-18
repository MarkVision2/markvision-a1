-- Проектная библиотека B-roll для «Reels-видео».
create table if not exists public.reels_asset_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create table if not exists public.reels_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  folder_id uuid not null references public.reels_asset_folders(id) on delete cascade,
  name text not null,
  media_type text not null check (media_type in ('video', 'image')),
  storage_path text not null unique,
  public_url text not null,
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists reels_asset_folders_project_idx
  on public.reels_asset_folders (project_id, created_at desc);
create index if not exists reels_assets_folder_idx
  on public.reels_assets (folder_id, created_at desc);

alter table public.reels_asset_folders enable row level security;
alter table public.reels_assets enable row level security;

create policy reels_asset_folders_select on public.reels_asset_folders
  for select using (project_id in (select id from public.projects));
create policy reels_asset_folders_insert on public.reels_asset_folders
  for insert to authenticated
  with check (project_id in (select id from public.projects));
create policy reels_asset_folders_update on public.reels_asset_folders
  for update to authenticated
  using (project_id in (select id from public.projects))
  with check (project_id in (select id from public.projects));
create policy reels_asset_folders_delete on public.reels_asset_folders
  for delete to authenticated
  using (project_id in (select id from public.projects));

create policy reels_assets_select on public.reels_assets
  for select using (project_id in (select id from public.projects));
create policy reels_assets_insert on public.reels_assets
  for insert to authenticated
  with check (
    project_id in (select id from public.projects)
    and folder_id in (
      select id from public.reels_asset_folders f where f.project_id = reels_assets.project_id
    )
  );
create policy reels_assets_delete on public.reels_assets
  for delete to authenticated
  using (project_id in (select id from public.projects));

-- API-ключи никогда не доступны Data API пользователю: только service-role edge-функции.
create table if not exists public.reels_provider_credentials (
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null check (provider in ('pexels', 'kie')),
  encrypted_key text not null,
  key_hint text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (project_id, provider)
);
alter table public.reels_provider_credentials enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reels-assets',
  'reels-assets',
  true,
  47185920,
  array['video/mp4','video/quicktime','video/webm','image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- storage path: {project_id}/{folder_id}/{timestamp}-{filename}
create policy "reels-assets read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reels-assets'
    and (storage.foldername(name))[1]::uuid in (select id from public.projects)
  );
create policy "reels-assets insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reels-assets'
    and (storage.foldername(name))[1]::uuid in (select id from public.projects)
  );
create policy "reels-assets delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reels-assets'
    and (storage.foldername(name))[1]::uuid in (select id from public.projects)
  );
