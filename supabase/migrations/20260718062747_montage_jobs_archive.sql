-- Завершённые заявки можно убрать из интерфейса, не удаляя результаты и аудит.
alter table public.montage_jobs
  add column if not exists archived_at timestamptz;

create index if not exists montage_jobs_project_unarchived_idx
  on public.montage_jobs (project_id, created_at desc)
  where archived_at is null;
