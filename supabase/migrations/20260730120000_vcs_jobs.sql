-- Vertical Creative System (video-creative-system → Контент-завод).
-- Очередь заявок на вертикальные VoiceOver-креативы: заявка создаётся на сайте
-- (раздел Контент-завод → Видео → «Вертикальные креативы»), исполняется
-- Claude-сессией в репо video-creative-system (скилл/скрипты + scripts/vcs-worker.mjs),
-- результат публикуется в heygen_usage («AI монтаж → Готовые») и, по флагу,
-- уходит в Telegram проекта.
--
-- Инфраструктура общая с монтаж-конвейером: bucket `renders`, ключ воркера в
-- montage_settings.worker_key, привязка Telegram в telegram_links. Отдельная
-- только очередь vcs_jobs (и своя edge-функция vcs-worker).

create table if not exists public.vcs_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  created_by uuid default auth.uid(),
  -- queued → processing → rendering → done | failed | canceled
  status text not null default 'queued',
  -- человекочитаемый прогресс текущей стадии («озвучка», «рендер 40%»)
  progress text,
  -- текст озвучки/сценарий (вход разметки для агента)
  script text not null,
  -- настройки рендера БЕЗ ключей: { profile, voiceProvider, elevenVoice, speed,
  --   music, format, ... } — ключи провайдеров подставляет воркер из секретов
  config jsonb not null default '{}'::jsonb,
  notify_telegram boolean not null default true,
  result_video_url text,
  -- детали результата: { review_url, duration_sec, warnings, ... }
  result jsonb,
  error text,
  source text not null default 'web',
  session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at timestamptz
);

alter table public.vcs_jobs enable row level security;

-- Как montage_jobs / heygen_jobs: видимость через членство в проекте (RLS на projects).
create policy vcs_select on public.vcs_jobs
  for select using (project_id in (select id from public.projects));
create policy vcs_insert on public.vcs_jobs
  for insert to authenticated
  with check (project_id in (select id from public.projects));
create policy vcs_update on public.vcs_jobs
  for update to authenticated
  using (project_id in (select id from public.projects))
  with check (project_id in (select id from public.projects));

create index if not exists vcs_jobs_queue_idx on public.vcs_jobs (status, created_at);
create index if not exists vcs_jobs_project_idx on public.vcs_jobs (project_id, created_at desc);

-- Атомарный забор заявки (как claim_montage_job): FOR UPDATE SKIP LOCKED —
-- одну заявку берёт ровно один воркер; зависшие processing/rendering дольше
-- 3 часов возвращаются в очередь. Вызывается только service role из vcs-worker.
create or replace function public.claim_vcs_job()
returns setof public.vcs_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.vcs_jobs
     set status = 'queued',
         progress = 'возвращена в очередь после сбоя воркера',
         claimed_at = null,
         updated_at = now()
   where status in ('processing', 'rendering')
     and claimed_at < now() - interval '3 hours';

  return query
  update public.vcs_jobs vj
     set status = 'processing',
         progress = 'взято в работу',
         claimed_at = now(),
         updated_at = now()
   where vj.id = (
     select id from public.vcs_jobs
      where status = 'queued'
      order by created_at
      for update skip locked
      limit 1)
  returning vj.*;
end;
$$;

revoke all on function public.claim_vcs_job() from public;
revoke all on function public.claim_vcs_job() from anon;
revoke all on function public.claim_vcs_job() from authenticated;
