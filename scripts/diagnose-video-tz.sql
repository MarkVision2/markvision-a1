-- Диагностика ТЗ на видео (AI монтаж / HeyGen) для MarkVision AI.
-- Запустить в Supabase SQL Editor проекта szfgdruhlebfvcmlvxdk.
-- Ищем заявку с текстом про маркетинг / тишину.

-- 1) Очередь Video Agent (веб)
select
  id,
  status,
  delivered,
  source,
  created_at,
  updated_at,
  left(coalesce(script, ''), 200) as script,
  left(coalesce(montage_brief, ''), 200) as montage_brief,
  left(coalesce(error, ''), 300) as error,
  session_id,
  left(coalesce(video_url, ''), 120) as video_url
from public.heygen_jobs
where project_id = 'cceb9a86-687b-4417-9b4e-d106bd8cc79c'
order by created_at desc
limit 20;

-- 2) Поиск по тексту ТЗ
select
  id, status, delivered, created_at,
  left(coalesce(script, ''), 240) as script,
  left(coalesce(error, ''), 300) as error
from public.heygen_jobs
where script ilike '%маркетинг%'
   or montage_brief ilike '%маркетинг%'
   or script ilike '%тишина%'
   or montage_brief ilike '%тишина%'
   or script ilike '%клиент%'
order by created_at desc
limit 20;

-- 3) Готовые ролики в галерее
select id, mode, source, created_at, title, duration_sec, cost_usd,
       left(coalesce(video_url, ''), 120) as video_url,
       left(coalesce(description, ''), 160) as description
from public.heygen_usage
where project_id = 'cceb9a86-687b-4417-9b4e-d106bd8cc79c'
order by created_at desc
limit 15;

-- 4) Жив ли cron воркера
select jobid, jobname, schedule, active, command
from cron.job
where command ilike '%heygen-jobs-worker%';

-- 5) Reels / монтаж съёмки (на случай если ТЗ ушло туда)
select id, status, created_at, left(coalesce(error, ''), 200) as error,
       left(coalesce(script, ''), 200) as script
from public.reels_jobs
where project_id = 'cceb9a86-687b-4417-9b4e-d106bd8cc79c'
order by created_at desc limit 10;

select id, status, created_at, left(coalesce(error, ''), 200) as error,
       source_name, left(coalesce(brief, ''), 200) as brief
from public.montage_jobs
where project_id = 'cceb9a86-687b-4417-9b4e-d106bd8cc79c'
order by created_at desc limit 10;
