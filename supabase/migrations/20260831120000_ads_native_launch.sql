-- ============================================================
-- Нативный запуск рекламы: очередь заданий вместо проксирования в n8n.
--
-- Разбор — docs/ADS-LAUNCH-N8N-MIGRATION.md. Коротко: сейчас кампанию создаёт
-- внешний воркфлоу n8n, а наша edge-функция только пересылает ему форму и
-- вслепую ждёт ACK. Логика запуска живёт в чужом JSON, статус обновляется
-- лишь при полном успехе, а гонка параллельных запусков лечится случайной
-- задержкой.
--
-- Здесь появляется очередь заданий, которую разбирает edge-функция
-- ads-launch-worker по крону — тем же паттерном, что capi-outbox-worker.
-- ============================================================

-- ── 1. Очередь запусков ─────────────────────────────────────
-- Задание проходит по шагам, и результат каждого шага записывается ДО
-- перехода к следующему: повтор после сбоя не создаёт дублей в кабинете.
create table if not exists public.ad_launch_jobs (
  id               uuid primary key default gen_random_uuid(),
  -- Сквозной идентификатор запуска: он же в ad_campaigns.launch_id.
  launch_id        uuid not null unique,
  project_id       uuid references public.projects(id) on delete cascade,
  cabinet_id       uuid not null references public.ad_cabinets(id) on delete cascade,

  status           text not null default 'queued',
  step             text not null default 'resolve',
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  locked_at        timestamptz,

  -- Всё, что нужно воркеру: цель, бюджет, тексты, ссылки на медиа.
  request          jsonb not null default '{}'::jsonb,

  -- Результаты шагов.
  meta_image_hash  text,
  meta_video_id    text,
  meta_creative_id text,
  meta_campaign_id text,
  meta_adset_id    text,
  meta_ad_id       text,

  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz,

  constraint ad_launch_jobs_status_check
    check (status in ('queued','running','awaiting_video','success','error','cancelled'))
);

create index if not exists idx_ad_launch_jobs_pending
  on public.ad_launch_jobs (next_attempt_at)
  where status in ('queued','running','awaiting_video');

create index if not exists idx_ad_launch_jobs_project
  on public.ad_launch_jobs (project_id, created_at desc);

drop trigger if exists trg_ad_launch_jobs_updated on public.ad_launch_jobs;
create trigger trg_ad_launch_jobs_updated
  before update on public.ad_launch_jobs
  for each row execute function public.update_updated_at_column();

alter table public.ad_launch_jobs enable row level security;

-- Читают участники проекта; пишет только сервисная роль (edge-функции).
drop policy if exists ad_launch_jobs_select_scoped on public.ad_launch_jobs;
create policy ad_launch_jobs_select_scoped on public.ad_launch_jobs
  for select to authenticated
  using (public.user_can_access_project(project_id));

-- ── 2. Ключ консолидации кампаний ───────────────────────────
-- Все запуски одного кабинета за день с одной целью сходятся в одну кампанию.
-- Раньше это решалось поиском по имени с джиттером 0-8 c и четырьмя повторами;
-- теперь гарантию даёт первичный ключ: кто первым вставил строку, тот и создаёт
-- кампанию в Meta, остальные берут её id.
create table if not exists public.ad_campaign_groups (
  ad_account_id    text not null,
  date_key         date not null,
  goal             text not null,
  objective        text not null,
  meta_campaign_id text,
  claimed_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (ad_account_id, date_key, goal, objective)
);

drop trigger if exists trg_ad_campaign_groups_updated on public.ad_campaign_groups;
create trigger trg_ad_campaign_groups_updated
  before update on public.ad_campaign_groups
  for each row execute function public.update_updated_at_column();

alter table public.ad_campaign_groups enable row level security;
-- Служебная таблица: доступ только у сервисной роли, отдельных политик нет.

-- ── 3. Переключатель контура запуска ────────────────────────
-- false — старый путь через n8n, true — нативная очередь. Раскатываем
-- постепенно, чтобы можно было вернуться одной правкой настройки.
alter table public.automation_settings
  add column if not exists ads_launch_native boolean not null default false;

comment on column public.automation_settings.ads_launch_native is
  'true — запуск рекламы идёт через ad_launch_jobs + ads-launch-worker; false — проксируется в n8n';

-- ── 4. Крон разбора очереди ─────────────────────────────────
-- Ежеминутно, как capi-outbox-worker. Мгновенный пинок воркера делает сама
-- launch-campaign; крон нужен для шагов, которые ждут Meta (обработка видео),
-- и как страховка, если пинок не дошёл.
select cron.unschedule('ads-launch-worker-minutely')
where exists (select 1 from cron.job where jobname = 'ads-launch-worker-minutely');

select cron.schedule(
  'ads-launch-worker-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ads-launch-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := jsonb_build_object('batch_size', 5)
  );
  $$
);

-- ── 5. Атомарный забор заданий ──────────────────────────────
-- PostgREST не умеет FOR UPDATE SKIP LOCKED, поэтому забор делаем функцией:
-- два параллельных воркера никогда не возьмут одно задание. Аренда живёт
-- p_lock_timeout — если воркер умер, задание вернётся в работу само.
create or replace function public.claim_ad_launch_jobs(
  p_limit integer default 5,
  p_lock_timeout interval default '5 minutes'
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
        and next_attempt_at <= now()
        and (locked_at is null or locked_at < now() - p_lock_timeout)
      order by created_at
      for update skip locked
      limit greatest(1, p_limit)
   )
  returning j.*;
$$;

revoke all on function public.claim_ad_launch_jobs(integer, interval) from public, anon, authenticated;
-- Право выполнения выдаём явно: без него забор заданий сломался бы там, где
-- сервисная роль опиралась на грант для PUBLIC, который мы только что сняли.
grant execute on function public.claim_ad_launch_jobs(integer, interval) to service_role;

-- ── 6. Консолидация кампаний без гонки ──────────────────────
-- Возвращает id уже созданной кампании и признак «эта задача создаёт её сама».
-- Владельцем становится первый вставивший строку; остальные ждут, пока он
-- запишет id. Если владелец умер и за 10 минут id не появился — право
-- создания переходит следующему, иначе очередь встала бы навсегда.
create or replace function public.claim_ad_campaign_group(
  p_ad_account_id text,
  p_date_key date,
  p_goal text,
  p_objective text,
  p_job_id uuid
)
returns table (campaign_id text, is_owner boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ad_campaign_groups;
begin
  insert into public.ad_campaign_groups (ad_account_id, date_key, goal, objective, claimed_by)
  values (p_ad_account_id, p_date_key, p_goal, p_objective, p_job_id)
  on conflict (ad_account_id, date_key, goal, objective) do nothing;

  select * into v_row
    from public.ad_campaign_groups
   where ad_account_id = p_ad_account_id
     and date_key      = p_date_key
     and goal          = p_goal
     and objective     = p_objective
     for update;

  if v_row.meta_campaign_id is null
     and v_row.claimed_by is distinct from p_job_id
     and v_row.updated_at < now() - interval '10 minutes' then
    update public.ad_campaign_groups
       set claimed_by = p_job_id
     where ad_account_id = p_ad_account_id
       and date_key      = p_date_key
       and goal          = p_goal
       and objective     = p_objective
    returning * into v_row;
  end if;

  return query select v_row.meta_campaign_id, (v_row.claimed_by = p_job_id);
end;
$$;

revoke all on function public.claim_ad_campaign_group(text, date, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_ad_campaign_group(text, date, text, text, uuid)
  to service_role;

-- Владелец записывает созданную кампанию — с этого момента её берут все.
create or replace function public.set_ad_campaign_group_campaign(
  p_ad_account_id text,
  p_date_key date,
  p_goal text,
  p_objective text,
  p_campaign_id text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ad_campaign_groups
     set meta_campaign_id = p_campaign_id
   where ad_account_id = p_ad_account_id
     and date_key      = p_date_key
     and goal          = p_goal
     and objective     = p_objective;
$$;

revoke all on function public.set_ad_campaign_group_campaign(text, date, text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_ad_campaign_group_campaign(text, date, text, text, text)
  to service_role;
