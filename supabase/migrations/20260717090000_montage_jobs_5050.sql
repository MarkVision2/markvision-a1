-- Монтаж 50/50: сплит-скрин (спикер в одной половине, запись экрана — в другой,
-- в важных моментах показа). Заявке добавляем режим и второй исходник.
alter table public.montage_jobs
  add column if not exists mode text not null default 'standard',   -- 'standard' | '5050'
  add column if not exists source2_url text,                        -- второе видео (запись экрана) в montage-uploads / R2
  add column if not exists source2_name text;
