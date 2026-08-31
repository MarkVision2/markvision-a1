-- ============================================================
-- Запуск с сайта идёт напрямую в Meta.
--
-- Раньше нативный контур жил за флагом и по умолчанию был выключен: мастер
-- отдавал запуск в n8n. Теперь наоборот — сайт всегда работает через свою
-- очередь и Graph API, а флаг остаётся только для аварийного отката.
--
-- Плюс забор конкретного задания: launch-campaign после постановки в очередь
-- сразу прогоняет воркер по этому launch_id, чтобы менеджер увидел готовую
-- кампанию в том же ответе, а не «принято, ждите».
-- ============================================================

-- ── 1. Нативный контур по умолчанию ─────────────────────────
alter table public.automation_settings
  alter column ads_launch_native set default true;

update public.automation_settings
   set ads_launch_native = true
 where id = true;

comment on column public.automation_settings.ads_launch_native is
  'true (по умолчанию) — запуск рекламы идёт напрямую в Meta через ad_launch_jobs + ads-launch-worker; false — аварийный откат на n8n';

-- ── 2. Адресный забор задания ───────────────────────────────
-- Сигнатура меняется, поэтому старую версию убираем явно: CREATE OR REPLACE
-- не умеет добавлять параметр.
drop function if exists public.claim_ad_launch_jobs(integer, interval);

create or replace function public.claim_ad_launch_jobs(
  p_limit integer default 5,
  p_lock_timeout interval default '5 minutes',
  p_launch_id uuid default null
)
returns setof public.ad_launch_jobs
language sql
security definer
set search_path = public
as $$
  update public.ad_launch_jobs j
     set locked_at = now(),
         attempts  = j.attempts + 1
   where j.id in (
     select id
       from public.ad_launch_jobs
      where status in ('queued','running','awaiting_video')
        -- Названное задание берём независимо от расписания повтора: его прямо
        -- сейчас ждёт человек в интерфейсе.
        and (p_launch_id is not null or next_attempt_at <= now())
        and (p_launch_id is null or launch_id = p_launch_id)
        and (locked_at is null or locked_at < now() - p_lock_timeout)
      order by created_at
      for update skip locked
      limit greatest(1, p_limit)
   )
  returning j.*;
$$;

revoke all on function public.claim_ad_launch_jobs(integer, interval, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_ad_launch_jobs(integer, interval, uuid)
  to service_role;
