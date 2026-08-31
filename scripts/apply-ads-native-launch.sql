-- ============================================================
-- Нативный запуск рекламы: один файл для Supabase SQL Editor.
--
-- Зачем он нужен. В воркфлоу supabase-deploy шаг `supabase db push` пропускается
-- (секрет SUPABASE_DB_PASSWORD не задан), а запасной путь через Management API
-- отвечает HTTP 403 (error code 1010) — у токена нет права database_write.
-- Из-за этого миграции на прод не доезжают автоматически: edge-функции
-- выкатываются, а таблицы под них не появляются.
--
-- Пока это не починено, содержимое четырёх миграций собрано здесь одним куском.
-- Вставьте файл в SQL Editor проекта и выполните. Все операции идемпотентны
-- (create ... if not exists, create or replace, drop policy if exists),
-- повторный прогон безопасен.
--
-- Исходники, из которых собран файл (порядок важен):
--   supabase/migrations/20260831120000_ads_native_launch.sql
--   supabase/migrations/20260831130000_ads_optimizer.sql
--   supabase/migrations/20260831140000_ads_telegram_intake.sql
--   supabase/migrations/20260831150000_ads_site_launch_direct.sql
--
-- После выполнения запуск рекламы с сайта пойдёт напрямую в Meta
-- (automation_settings.ads_launch_native = true).
-- ============================================================


-- ===========================================================
-- Источник: supabase/migrations/20260831120000_ads_native_launch.sql
-- ===========================================================
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


-- ===========================================================
-- Источник: supabase/migrations/20260831130000_ads_optimizer.sql
-- ===========================================================
-- ============================================================
-- Ежедневная оптимизация рекламы своими силами: пороги в настройках проекта,
-- решение — в edge-функции ads-optimizer, расписание — в pg_cron.
--
-- До этого пауза убыточных кампаний и рост бюджета у победителей жили в ноде
-- n8n `Auto-Pause`, где все пороги были константами в коде: поменять лимит CPL
-- одному клиенту было нельзя, не задев остальных.
-- ============================================================

create table if not exists public.ads_optimizer_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  enabled boolean not null default true,

  -- Остановка убыточных.
  max_cpl                     numeric not null default 4,     -- $ за лид, 3 дня
  max_spend_no_lead           numeric not null default 15,    -- $ за 3 дня без лидов
  emergency_spend             numeric not null default 10,    -- $ за сегодня без лидов
  min_quality_score           integer not null default 45,
  quality_shield              integer not null default 70,    -- выше — высокий CPL прощаем
  grace_period_days           integer not null default 5,     -- защита новых кампаний

  -- Рост победителей.
  scale_min_score             integer not null default 75,
  scale_max_cpl               numeric not null default 2.5,
  scale_step                  numeric not null default 1.2,
  scale_cap_usd               numeric not null default 50,
  crm_scale_cap_usd           numeric not null default 100,   -- при оплатах в CRM
  scale_min_depth3_rate       integer not null default 30,

  -- Качество лидов по ai_score из CRM.
  qualified_ai_score_min      integer not null default 70,
  qualified_rate_min_pause    integer not null default 20,
  qualified_rate_min_scale    integer not null default 50,
  qualified_leads_min_for_pause integer not null default 5,

  -- Выгорание креатива (только предупреждение в отчёт).
  fatigue_frequency           numeric not null default 3.0,
  fatigue_frequency_soft      numeric not null default 2.0,
  fatigue_ctr_drop            numeric not null default 0.7,
  fatigue_min_impressions     integer not null default 1500,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_ads_optimizer_settings_updated on public.ads_optimizer_settings;
create trigger trg_ads_optimizer_settings_updated
  before update on public.ads_optimizer_settings
  for each row execute function public.update_updated_at_column();

alter table public.ads_optimizer_settings enable row level security;

-- Пороги видят участники проекта, меняет — админ.
drop policy if exists ads_optimizer_settings_select on public.ads_optimizer_settings;
create policy ads_optimizer_settings_select on public.ads_optimizer_settings
  for select to authenticated
  using (public.user_can_access_project(project_id));

drop policy if exists ads_optimizer_settings_write on public.ads_optimizer_settings;
create policy ads_optimizer_settings_write on public.ads_optimizer_settings
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ── Расписание ──────────────────────────────────────────────
-- Утро 10:00 и вечер 22:00 по Алматы (UTC+5) — как в n8n. Утренний прогон
-- только отчитывается, вечерний вносит изменения.
select cron.unschedule('ads-optimizer-morning')
where exists (select 1 from cron.job where jobname = 'ads-optimizer-morning');
select cron.unschedule('ads-optimizer-night')
where exists (select 1 from cron.job where jobname = 'ads-optimizer-night');

select cron.schedule(
  'ads-optimizer-morning',
  '0 5 * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ads-optimizer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := jsonb_build_object('mode', 'morning')
  );
  $$
);

select cron.schedule(
  'ads-optimizer-night',
  '0 17 * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ads-optimizer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := jsonb_build_object('mode', 'night')
  );
  $$
);


-- ===========================================================
-- Источник: supabase/migrations/20260831140000_ads_telegram_intake.sql
-- ===========================================================
-- ============================================================
-- Запуск рекламы из Telegram своими силами.
--
-- Последний кусок, который держал воркфлоу n8n живым: таргетолог кидает боту
-- фото/видео с подписью «на сайт, бюджет 30» — и кампания уходит в Meta.
-- Здесь появляются таблицы для сборки альбомов и белого списка доменов;
-- сам приём — edge-функция ads-telegram-intake, дальше работает та же
-- очередь ad_launch_jobs.
-- ============================================================

-- ── 1. Кадры альбома ────────────────────────────────────────
-- Telegram присылает альбом как несколько отдельных апдейтов с общим
-- media_group_id и без гарантии порядка. Складываем сюда, а очередь соберёт
-- карусель, отсортировав по message_id.
create table if not exists public.ad_telegram_media (
  id              uuid primary key default gen_random_uuid(),
  media_group_id  text not null,
  chat_id         text not null,
  message_id      bigint not null,
  cabinet_id      uuid references public.ad_cabinets(id) on delete cascade,
  meta_image_hash text,
  created_at      timestamptz not null default now(),
  unique (media_group_id, message_id)
);

create index if not exists idx_ad_telegram_media_group
  on public.ad_telegram_media (media_group_id, message_id);

alter table public.ad_telegram_media enable row level security;
-- Служебная таблица приёма: пишет и читает только сервисная роль.

-- ── 2. Альбом запускается один раз ──────────────────────────
-- Первый кадр альбома создаёт задание, остальные видят конфликт по этому
-- ключу и просто докладывают свой кадр. Без него альбом из пяти фото
-- породил бы пять кампаний.
alter table public.ad_launch_jobs
  add column if not exists telegram_media_group_id text;

create unique index if not exists idx_ad_launch_jobs_media_group
  on public.ad_launch_jobs (telegram_media_group_id)
  where telegram_media_group_id is not null;

-- ── 3. Разрешённые домены кабинета ──────────────────────────
-- Ссылку из подписи принимаем, только если её домен привязан к кабинету:
-- иначе случайная ссылка в тексте увела бы рекламный трафик на чужой сайт.
-- Пустой список = поведение как раньше, подписи доверяем.
create table if not exists public.ad_cabinet_websites (
  id         uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references public.ad_cabinets(id) on delete cascade,
  url        text not null,
  label      text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (cabinet_id, url)
);

create index if not exists idx_ad_cabinet_websites_cabinet
  on public.ad_cabinet_websites (cabinet_id);

alter table public.ad_cabinet_websites enable row level security;

drop policy if exists ad_cabinet_websites_select on public.ad_cabinet_websites;
create policy ad_cabinet_websites_select on public.ad_cabinet_websites
  for select to authenticated
  using (
    exists (
      select 1
        from public.ad_cabinets c
       where c.id = ad_cabinet_websites.cabinet_id
         and public.user_can_access_project(c.project_id)
    )
  );

drop policy if exists ad_cabinet_websites_write on public.ad_cabinet_websites;
create policy ad_cabinet_websites_write on public.ad_cabinet_websites
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ── 4. Уборка ───────────────────────────────────────────────
-- Кадры альбомов нужны минуты, а копятся вечно. Чистим раз в сутки.
create or replace function public.cleanup_ad_telegram_media()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.ad_telegram_media where created_at < now() - interval '2 days';
$$;

revoke all on function public.cleanup_ad_telegram_media() from public, anon, authenticated;
grant execute on function public.cleanup_ad_telegram_media() to service_role;

select cron.unschedule('ads-telegram-media-cleanup')
where exists (select 1 from cron.job where jobname = 'ads-telegram-media-cleanup');

select cron.schedule(
  'ads-telegram-media-cleanup',
  '15 3 * * *',
  $$ select public.cleanup_ad_telegram_media(); $$
);


-- ===========================================================
-- Источник: supabase/migrations/20260831150000_ads_site_launch_direct.sql
-- ===========================================================
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

