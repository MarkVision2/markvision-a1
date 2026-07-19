-- Источник B-roll для очереди «Монтаж съёмки» (как у Reels-видео).
alter table public.montage_jobs
  add column if not exists broll_mode text not null default 'auto';

alter table public.montage_jobs
  add column if not exists asset_folder_ids jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'montage_jobs_broll_mode_check'
  ) then
    alter table public.montage_jobs
      add constraint montage_jobs_broll_mode_check
      check (broll_mode in ('auto', 'library', 'pexels', 'kie'));
  end if;
end $$;

comment on column public.montage_jobs.broll_mode is
  'Источник вставок: auto | library | pexels | kie (как Reels-видео).';
comment on column public.montage_jobs.asset_folder_ids is
  'UUID папок reels_asset_folders при broll_mode=library.';
