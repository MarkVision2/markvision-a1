-- Монтаж-конвейер (Montage pipeline → Контент-завод).
-- Очередь заявок на автомонтаж «говорящей головы»: заявка создаётся на сайте
-- (раздел Контент-завод → «Монтаж съёмки»), исполняется Claude-воркером в репо
-- (скилл montage-pipeline + scripts/montage-worker.mjs), результат публикуется
-- в heygen_usage («AI монтаж → Готовые») и, по флагу, уходит в Telegram.

create table if not exists public.montage_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  created_by uuid default auth.uid(),
  -- queued → processing → rendering → done | failed | canceled
  status text not null default 'queued',
  -- человекочитаемый прогресс текущей стадии («транскрибируем», «рендер 40%»)
  progress text,
  -- какие форматы нужны: ["16:9"], ["shorts"], ["16:9","shorts"]
  formats jsonb not null default '["16:9"]'::jsonb,
  shorts_count int,
  -- пожелания к монтажу: тема, стиль, что вырезать/подчеркнуть
  brief text,
  -- исходник (говорящая голова) в bucket montage-uploads
  source_url text not null,
  source_name text,
  notify_telegram boolean not null default true,
  result_video_url text,
  -- детали результата: { shorts: [urls], usage_refs: [...] }
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at timestamptz
);

alter table public.montage_jobs enable row level security;

-- Как heygen_jobs: видимость через членство в проекте (RLS на projects).
create policy mj_select on public.montage_jobs
  for select using (project_id in (select id from public.projects));
create policy mj_insert on public.montage_jobs
  for insert to authenticated
  with check (project_id in (select id from public.projects));
create policy mj_update on public.montage_jobs
  for update to authenticated
  using (project_id in (select id from public.projects))
  with check (project_id in (select id from public.projects));

create index if not exists montage_jobs_queue_idx on public.montage_jobs (status, created_at);
create index if not exists montage_jobs_project_idx on public.montage_jobs (project_id, created_at desc);

-- Ключ Claude-воркера (сравнивается в edge-функции montage-worker с заголовком
-- x-montage-key). RLS без политик: доступен только service role; значение
-- вставляется отдельно, не через миграцию.
create table if not exists public.montage_settings (
  id int primary key default 1 check (id = 1),
  worker_key text not null,
  updated_at timestamptz not null default now()
);
alter table public.montage_settings enable row level security;

-- Bucket для исходников монтажа (видео «говорящая голова»).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('montage-uploads', 'montage-uploads', true, null,
        array['video/mp4','video/quicktime','video/webm','video/x-matroska'])
on conflict (id) do nothing;

-- Политики storage в стиле бакета autopost: заливка из приложения, чтение публичное.
create policy "montage-uploads insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'montage-uploads');
create policy "montage-uploads update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'montage-uploads');
create policy "montage-uploads delete" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'montage-uploads');
create policy "montage-uploads read" on storage.objects
  for select using (bucket_id = 'montage-uploads');
