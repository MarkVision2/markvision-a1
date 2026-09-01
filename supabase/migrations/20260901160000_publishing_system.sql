-- ============================================================
-- Система автопубликации видео: очередь заданий на N аккаунтов.
--
-- Разбор — docs/PUBLISHING-SYSTEM.md. Коротко: существующий автопостинг
-- (cf_scheduled_posts + edge publisher) умеет один Instagram на проект и
-- один пост за раз. Здесь появляется контур «одно видео → пачка аккаунтов»:
-- аккаунты многих платформ, очередь заданий с дриппингом по времени,
-- журнал ответов API и статусы аккаунтов (истёк токен / лимит / ошибка).
--
-- Очередь разбирает edge-функция publish-worker по крону — тем же паттерном,
-- что ads-launch-worker и capi-outbox-worker. n8n остаётся оркестратором:
-- принимает готовое видео, генерит варианты текста, шлёт отчёты.
--
-- cf_scheduled_posts не трогаем: контент-план проекта продолжает работать
-- как работал, это отдельная дорога.
-- ============================================================

-- ── 1. Аккаунты площадок ────────────────────────────────────
-- Токены хранятся зашифрованными (AES-GCM, ключ PUBLISH_TOKEN_KEY в секретах
-- Supabase) — расшифровка живёт только в edge-функциях. Формат значения:
-- 'v1:<base64(iv|ciphertext)>'; строка без префикса читается как открытый
-- токен (так заезжают legacy-строки из instagram_accounts, см. п. 7).
create table if not exists public.publish_accounts (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  platform              text not null,

  -- Как аккаунт зовут у нас в панели и чем он представлен на площадке.
  account_name          text not null,
  handle                text,
  external_account_id   text not null,
  -- Instagram Graph API публикует от имени Facebook-страницы: page_id нужен,
  -- чтобы перевыпустить page-токен после reconnect без повторного выбора.
  fb_page_id            text,

  access_token_encrypted  text,
  refresh_token_encrypted text,
  token_expires_at        timestamptz,

  status                text not null default 'active',
  publish_enabled       boolean not null default true,

  -- Дневная норма постов: очередь не отдаст воркеру больше за календарные сутки.
  daily_limit           integer not null default 10,
  last_post_at          timestamptz,

  -- Счётчик подряд идущих ошибок — по нему publish-monitor гасит аккаунт.
  consecutive_errors    integer not null default 0,
  last_error            text,
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint publish_accounts_platform_check
    check (platform in ('instagram','tiktok','youtube','threads')),
  constraint publish_accounts_status_check
    check (status in ('active','token_expired','limited','error','disabled')),
  constraint publish_accounts_daily_limit_check
    check (daily_limit between 0 and 200),
  -- Один и тот же аккаунт площадки не заводится в проекте дважды.
  constraint publish_accounts_external_uniq
    unique (project_id, platform, external_account_id)
);

create index if not exists idx_publish_accounts_project
  on public.publish_accounts (project_id, platform);

create index if not exists idx_publish_accounts_ready
  on public.publish_accounts (platform)
  where status = 'active' and publish_enabled;

-- ── 2. Видео ────────────────────────────────────────────────
-- file_url — публичная ссылка, которую площадка скачает сама (Instagram и
-- TikTok тянут файл по URL, не принимают загрузку от нас). local_path нужен
-- ровно для YouTube: videos.insert грузит тело файла.
create table if not exists public.publish_videos (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,

  file_url       text not null,
  local_path     text,
  thumbnail_url  text,

  title          text,
  base_caption   text,
  -- Варианты текста под разные аккаунты (их пишет n8n через AI). Раскладку
  -- «вариант → аккаунт» делает create_jobs: i-й аккаунт получает i-й вариант.
  caption_variants jsonb not null default '[]'::jsonb,
  hashtags       text[] not null default '{}',
  language       text not null default 'ru',

  duration_sec   numeric,
  width          integer,
  height         integer,
  size_bytes     bigint,

  -- Откуда приехало видео: монтаж-конвейер, Reels-фабрика, руками, n8n.
  source         text not null default 'manual',
  source_ref     text,

  status         text not null default 'ready',
  error          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint publish_videos_status_check
    check (status in ('ready','queued','publishing','done','failed'))
);

create index if not exists idx_publish_videos_project
  on public.publish_videos (project_id, created_at desc);

-- ── 3. Задания публикации ───────────────────────────────────
-- Одна строка = «это видео в этот аккаунт». Уникальность (video_id, account_id)
-- закрывает главный риск такой системы: повторный вызов create_jobs не
-- порождает второй пост в тот же аккаунт.
create table if not exists public.publish_jobs (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  video_id          uuid not null references public.publish_videos(id) on delete cascade,
  account_id        uuid not null references public.publish_accounts(id) on delete cascade,
  platform          text not null,

  caption           text,
  hashtags          text[] not null default '{}',

  scheduled_at      timestamptz not null default now(),
  status            text not null default 'pending',
  attempts          integer not null default 0,
  next_attempt_at   timestamptz not null default now(),
  locked_at         timestamptz,

  -- Идентификатор незавершённой загрузки на стороне площадки (IG creation_id,
  -- TikTok publish_id). Пишется ДО публикации: если воркер умер между
  -- «создали контейнер» и «опубликовали», следующий заход добьёт тот же
  -- контейнер, а не зальёт видео заново.
  container_id      text,

  external_post_id  text,
  external_post_url text,
  error_code        text,
  error_message     text,

  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint publish_jobs_status_check
    check (status in ('pending','processing','published','failed','retry','manual_review','cancelled')),
  constraint publish_jobs_platform_check
    check (platform in ('instagram','tiktok','youtube','threads')),
  constraint publish_jobs_unique_target
    unique (video_id, account_id)
);

create index if not exists idx_publish_jobs_due
  on public.publish_jobs (scheduled_at, next_attempt_at)
  where status in ('pending','retry','processing');

create index if not exists idx_publish_jobs_project
  on public.publish_jobs (project_id, created_at desc);

create index if not exists idx_publish_jobs_account_day
  on public.publish_jobs (account_id, published_at desc)
  where status = 'published';

-- ── 4. Журнал ───────────────────────────────────────────────
-- Сырой ответ площадки — единственный способ разобрать, почему Instagram
-- отдал 2207052 или TikTok отклонил видео. Храним как есть.
create table if not exists public.publish_logs (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid references public.publish_jobs(id) on delete cascade,
  account_id   uuid references public.publish_accounts(id) on delete set null,
  level        text not null default 'info',
  message      text not null,
  raw_response jsonb,
  created_at   timestamptz not null default now(),

  constraint publish_logs_level_check check (level in ('info','warning','error'))
);

create index if not exists idx_publish_logs_job
  on public.publish_logs (job_id, created_at desc);

-- ── 5. Группы аккаунтов ─────────────────────────────────────
-- «Залить во все клиники» = одна группа. publish_strategy определяет раскладку
-- по времени в create_jobs: all_at_once | drip | daily.
create table if not exists public.publish_account_groups (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  name             text not null,
  platform         text,
  account_ids      uuid[] not null default '{}',
  publish_strategy text not null default 'drip',
  -- Темп дриппинга: сколько публикаций в час раскладывает create_jobs.
  per_hour         integer not null default 10,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint publish_account_groups_strategy_check
    check (publish_strategy in ('all_at_once','drip','daily')),
  constraint publish_account_groups_platform_check
    check (platform is null or platform in ('instagram','tiktok','youtube','threads')),
  constraint publish_account_groups_per_hour_check
    check (per_hour between 1 and 120)
);

create index if not exists idx_publish_account_groups_project
  on public.publish_account_groups (project_id);

-- ── 6. updated_at ───────────────────────────────────────────
drop trigger if exists trg_publish_accounts_updated on public.publish_accounts;
create trigger trg_publish_accounts_updated
  before update on public.publish_accounts
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_publish_videos_updated on public.publish_videos;
create trigger trg_publish_videos_updated
  before update on public.publish_videos
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_publish_jobs_updated on public.publish_jobs;
create trigger trg_publish_jobs_updated
  before update on public.publish_jobs
  for each row execute function public.update_updated_at_column();

drop trigger if exists trg_publish_account_groups_updated on public.publish_account_groups;
create trigger trg_publish_account_groups_updated
  before update on public.publish_account_groups
  for each row execute function public.update_updated_at_column();

-- ── 7. Доступы ──────────────────────────────────────────────
-- Пишет только сервисная роль (edge-функции). Участники проекта читают.
alter table public.publish_accounts       enable row level security;
alter table public.publish_videos         enable row level security;
alter table public.publish_jobs           enable row level security;
alter table public.publish_logs           enable row level security;
alter table public.publish_account_groups enable row level security;

grant all on public.publish_accounts       to service_role;
grant all on public.publish_videos         to service_role;
grant all on public.publish_jobs           to service_role;
grant all on public.publish_logs           to service_role;
grant all on public.publish_account_groups to service_role;

-- Токены не отдаём клиенту даже участнику проекта: право SELECT выдаётся
-- поколоночно, шифротекст в список не входит. Фронт ходит во вью ниже.
revoke all on public.publish_accounts from authenticated;
grant select (
  id, project_id, platform, account_name, handle, external_account_id, fb_page_id,
  token_expires_at, status, publish_enabled, daily_limit, last_post_at,
  consecutive_errors, last_error, notes, created_at, updated_at
) on public.publish_accounts to authenticated;

grant select on public.publish_videos         to authenticated;
grant select on public.publish_jobs           to authenticated;
grant select on public.publish_logs           to authenticated;
grant select on public.publish_account_groups to authenticated;

drop policy if exists publish_accounts_select_scoped on public.publish_accounts;
create policy publish_accounts_select_scoped on public.publish_accounts
  for select to authenticated
  using (public.user_can_access_project(project_id));

drop policy if exists publish_videos_select_scoped on public.publish_videos;
create policy publish_videos_select_scoped on public.publish_videos
  for select to authenticated
  using (public.user_can_access_project(project_id));

drop policy if exists publish_jobs_select_scoped on public.publish_jobs;
create policy publish_jobs_select_scoped on public.publish_jobs
  for select to authenticated
  using (public.user_can_access_project(project_id));

drop policy if exists publish_account_groups_select_scoped on public.publish_account_groups;
create policy publish_account_groups_select_scoped on public.publish_account_groups
  for select to authenticated
  using (public.user_can_access_project(project_id));

-- Журнал виден через задание, к которому привязан.
drop policy if exists publish_logs_select_scoped on public.publish_logs;
create policy publish_logs_select_scoped on public.publish_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.publish_jobs j
       where j.id = publish_logs.job_id
         and public.user_can_access_project(j.project_id)
    )
  );

-- Безопасное вью для интерфейса: те же строки, но без колонок с токенами,
-- поэтому `select *` из фронта не упирается в поколоночные права.
create or replace view public.publish_accounts_safe
with (security_invoker = true) as
select id, project_id, platform, account_name, handle, external_account_id, fb_page_id,
       token_expires_at, status, publish_enabled, daily_limit, last_post_at,
       consecutive_errors, last_error, notes, created_at, updated_at
  from public.publish_accounts;

grant select on public.publish_accounts_safe to authenticated;

comment on view public.publish_accounts_safe is
  'publish_accounts без шифротекста токенов — представление для интерфейса.';

-- ── 8. Атомарный забор заданий ──────────────────────────────
-- PostgREST не умеет FOR UPDATE SKIP LOCKED, поэтому забор — функцией: два
-- параллельных воркера никогда не возьмут одно задание. Здесь же живут три
-- правила, из-за которых очередь и нужна:
--   * аренда: задание, забытое умершим воркером, возвращается в очередь;
--   * состояние аккаунта: гасим отбор по token_expired/limited/disabled;
--   * дневная норма: аккаунт не выйдет за daily_limit за календарные сутки.
create or replace function public.claim_publish_jobs(
  p_batch        integer  default 5,
  p_lock_timeout interval default interval '10 minutes'
)
returns setof public.publish_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Аренда истекла — вернуть в очередь, но не сбрасывать attempts и
  -- container_id: повтор добивает уже начатую загрузку.
  update public.publish_jobs
     set status = 'retry',
         locked_at = null,
         error_message = coalesce(error_message, 'воркер не завершил задание, повтор'),
         updated_at = now()
   where status = 'processing'
     and locked_at is not null
     and locked_at < now() - p_lock_timeout;

  return query
  update public.publish_jobs j
     set status = 'processing',
         attempts = j.attempts + 1,
         locked_at = now(),
         updated_at = now()
   where j.id in (
     select cand.id
       from public.publish_jobs cand
       join public.publish_accounts acc on acc.id = cand.account_id
      where cand.status in ('pending','retry')
        and cand.scheduled_at <= now()
        and cand.next_attempt_at <= now()
        and acc.publish_enabled
        and acc.status = 'active'
        and (
          acc.daily_limit = 0
          or (
            select count(*)
              from public.publish_jobs done
             where done.account_id = cand.account_id
               and done.status = 'published'
               and done.published_at >= date_trunc('day', now())
          ) < acc.daily_limit
        )
      order by cand.scheduled_at
      for update of cand skip locked
      limit greatest(p_batch, 1)
   )
  returning j.*;
end;
$$;

revoke all on function public.claim_publish_jobs(integer, interval) from public;
revoke all on function public.claim_publish_jobs(integer, interval) from anon;
revoke all on function public.claim_publish_jobs(integer, interval) from authenticated;

comment on function public.claim_publish_jobs(integer, interval) is
  'Атомарный забор заданий публикации воркером: аренда, статус аккаунта, дневная норма.';

-- ── 9. Переезд существующих Instagram-аккаунтов ─────────────
-- instagram_accounts держит по одному аккаунту на проект и токен открытым
-- текстом. Переносим их как есть — расшифровка в edge-функциях умеет читать
-- значение без префикса 'v1:'. После первого reconnect строка перезапишется
-- уже шифротекстом.
insert into public.publish_accounts (
  project_id, platform, account_name, handle, external_account_id,
  fb_page_id, access_token_encrypted, status, publish_enabled, notes
)
select ia.project_id,
       'instagram',
       coalesce(ia.name, ia.username, ia.page_name, 'Instagram'),
       ia.username,
       ia.ig_user_id,
       ia.page_id,
       ia.page_access_token,
       case when ia.active then 'active' else 'disabled' end,
       ia.active,
       'перенесено из instagram_accounts'
  from public.instagram_accounts ia
 where ia.ig_user_id is not null
   and ia.page_access_token is not null
on conflict (project_id, platform, external_account_id) do nothing;

-- ── 10. Кроны ───────────────────────────────────────────────
-- Очередь тикает ежеминутно, как ads-launch-worker: n8n остаётся оркестратором
-- заявок и отчётов, но разбор очереди не зависит от доступности n8n.
select cron.unschedule('publish-worker-minutely')
where exists (select 1 from cron.job where jobname = 'publish-worker-minutely');

select cron.schedule(
  'publish-worker-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := jsonb_build_object('batch_size', 5)
  );
  $$
);

-- Токены: раз в сутки в 06:00 UTC.
select cron.unschedule('publish-monitor-tokens-daily')
where exists (select 1 from cron.job where jobname = 'publish-monitor-tokens-daily');

select cron.schedule(
  'publish-monitor-tokens-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := jsonb_build_object('mode', 'tokens')
  );
  $$
);

-- Ошибки: каждые 15 минут.
select cron.unschedule('publish-monitor-errors-quarterly')
where exists (select 1 from cron.job where jobname = 'publish-monitor-errors-quarterly');

select cron.schedule(
  'publish-monitor-errors-quarterly',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := jsonb_build_object('mode', 'errors')
  );
  $$
);
