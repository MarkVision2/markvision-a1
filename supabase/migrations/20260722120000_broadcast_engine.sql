-- ============================================================
-- Движок рассылок (WhatsApp через Green API) — серверный фундамент.
--
-- Заменяет localStorage-хранилище рассылок (src/lib/broadcastStore.ts) на БД,
-- чтобы отправка шла серверным воркером по расписанию (pg_cron → edge
-- broadcast-worker), а не из открытой вкладки браузера. Статусы получателей
-- (отправлено/доставлено/прочитано/ответил) обновляет greenapi-webhook по
-- message_id.
--
-- Три таблицы:
--   broadcast_campaigns     — кампания (аудитория, текст, расписание, лимиты)
--   broadcast_recipients    — по строке на получателя со статусом и трекингом
--   broadcast_opt_outs      — отписавшиеся (стоп-слово): больше не трогаем
-- Плюс служебные счётчики антибана (per-project = per WhatsApp-номер):
--   broadcast_sender_daily  — сколько ушло за день (жёсткий дневной потолок)
--   broadcast_sender_state  — дата старта прогрева и флаг паузы (kill-switch)
--
-- Дефолты — режим «максимально осторожно» (минимальный риск блокировки номера).
-- RLS — как montage_jobs/heygen_jobs: видимость через членство в проекте.
-- ============================================================

-- ─── Кампании ────────────────────────────────────────────────────────────────
create table if not exists public.broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  created_by uuid default auth.uid(),
  name text not null default '',
  -- whatsapp | sms (sms пока не подключён — только whatsapp реально шлётся)
  channel text not null default 'whatsapp',
  -- crm | upload
  audience_source text not null default 'crm',
  -- снимок фильтра CRM: { stageKeys: [], sources: [] }
  crm_filter jsonb not null default '{"stageKeys":[],"sources":[]}'::jsonb,
  title text not null default '',
  message text not null default '',
  -- спинтакс-варианты текста для антибана (если пусто — берётся message)
  message_variants jsonb not null default '[]'::jsonb,
  -- now | scheduled
  schedule_mode text not null default 'now',
  scheduled_at timestamptz,
  -- draft → scheduled → sending → sent | partial | failed | paused | canceled
  status text not null default 'draft',

  -- ── Антибан (осторожные дефолты) ──
  -- Жёсткий дневной потолок сообщений на номер.
  daily_limit int not null default 120,
  -- Окно отправки в таймзоне кампании (часы 0–23). Вне окна очередь стоит.
  window_start_hour int not null default 10,
  window_end_hour int not null default 20,
  timezone text not null default 'Asia/Almaty',
  -- Разброс паузы между сообщениями (сек) — человекоподобный джиттер.
  min_gap_seconds int not null default 20,
  max_gap_seconds int not null default 90,
  -- Плавный прогрев нового номера (первый день — мало, дальше +30%/день).
  warmup_enabled boolean not null default true,

  -- Итоги: { total, queued, sent, delivered, read, replied, failed, optout }
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

alter table public.broadcast_campaigns enable row level security;

create policy bc_select on public.broadcast_campaigns
  for select using (project_id in (select id from public.projects));
create policy bc_insert on public.broadcast_campaigns
  for insert to authenticated
  with check (project_id in (select id from public.projects));
create policy bc_update on public.broadcast_campaigns
  for update to authenticated
  using (project_id in (select id from public.projects))
  with check (project_id in (select id from public.projects));
create policy bc_delete on public.broadcast_campaigns
  for delete to authenticated
  using (project_id in (select id from public.projects));

create index if not exists broadcast_campaigns_project_idx
  on public.broadcast_campaigns (project_id, created_at desc);
create index if not exists broadcast_campaigns_active_idx
  on public.broadcast_campaigns (status, scheduled_at)
  where status in ('scheduled', 'sending');

-- ─── Получатели ──────────────────────────────────────────────────────────────
create table if not exists public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.broadcast_campaigns(id) on delete cascade,
  project_id uuid not null,
  -- если получатель — лид CRM, ссылка на него (для «оставил заявку/купил»)
  lead_id uuid,
  name text not null default '',
  phone text not null,
  -- queued → sent → delivered → read → replied → converted
  --        ↘ failed | skipped_optout | canceled
  status text not null default 'queued',
  scheduled_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  clicked_at timestamptz,
  converted_at timestamptz,
  -- idMessage из Green API — по нему webhook апдейтит статус
  message_id text,
  error text,
  attempt int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- один номер — один раз на кампанию
  unique (campaign_id, phone)
);

alter table public.broadcast_recipients enable row level security;

create policy br_select on public.broadcast_recipients
  for select using (project_id in (select id from public.projects));
create policy br_insert on public.broadcast_recipients
  for insert to authenticated
  with check (project_id in (select id from public.projects));
create policy br_update on public.broadcast_recipients
  for update to authenticated
  using (project_id in (select id from public.projects))
  with check (project_id in (select id from public.projects));
create policy br_delete on public.broadcast_recipients
  for delete to authenticated
  using (project_id in (select id from public.projects));

-- Очередь воркера: следующий к отправке.
create index if not exists broadcast_recipients_queue_idx
  on public.broadcast_recipients (status, scheduled_at)
  where status = 'queued';
create index if not exists broadcast_recipients_campaign_idx
  on public.broadcast_recipients (campaign_id, status);
-- Матч webhook-статуса по message_id.
create index if not exists broadcast_recipients_msg_idx
  on public.broadcast_recipients (message_id)
  where message_id is not null;
-- Матч входящего ответа по телефону в рамках проекта.
create index if not exists broadcast_recipients_phone_idx
  on public.broadcast_recipients (project_id, phone, sent_at desc);

-- ─── Отписавшиеся (стоп-слово) ───────────────────────────────────────────────
create table if not exists public.broadcast_opt_outs (
  project_id uuid not null,
  phone text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (project_id, phone)
);

alter table public.broadcast_opt_outs enable row level security;

create policy bo_select on public.broadcast_opt_outs
  for select using (project_id in (select id from public.projects));
create policy bo_insert on public.broadcast_opt_outs
  for insert to authenticated
  with check (project_id in (select id from public.projects));
create policy bo_delete on public.broadcast_opt_outs
  for delete to authenticated
  using (project_id in (select id from public.projects));

-- ─── Служебные счётчики антибана (правит только service role из воркера) ──────
-- Сколько сообщений ушло с номера проекта за конкретный день (UTC-дата).
create table if not exists public.broadcast_sender_daily (
  project_id uuid not null,
  day date not null,
  sent int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (project_id, day)
);
alter table public.broadcast_sender_daily enable row level security;
-- Только чтение авторизованным (для UI-статистики); запись — service role.
create policy bsd_select on public.broadcast_sender_daily
  for select using (project_id in (select id from public.projects));

-- Состояние прогрева/паузы номера проекта.
create table if not exists public.broadcast_sender_state (
  project_id uuid primary key,
  warmup_started_on date,
  paused boolean not null default false,
  pause_reason text,
  updated_at timestamptz not null default now()
);
alter table public.broadcast_sender_state enable row level security;
create policy bss_select on public.broadcast_sender_state
  for select using (project_id in (select id from public.projects));
-- Снять паузу из UI (kill-switch reset) — членам проекта.
create policy bss_update on public.broadcast_sender_state
  for update to authenticated
  using (project_id in (select id from public.projects))
  with check (project_id in (select id from public.projects));
create policy bss_insert on public.broadcast_sender_state
  for insert to authenticated
  with check (project_id in (select id from public.projects));

-- Атомарный инкремент дневного счётчика (вызывает воркер под service role).
create or replace function public.broadcast_bump_daily(_project_id uuid, _n int default 1)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  _total int;
begin
  insert into public.broadcast_sender_daily (project_id, day, sent)
  values (_project_id, (now() at time zone 'utc')::date, _n)
  on conflict (project_id, day)
  do update set sent = public.broadcast_sender_daily.sent + _n,
                updated_at = now()
  returning sent into _total;
  return _total;
end;
$$;

-- ─── updated_at триггеры ─────────────────────────────────────────────────────
create trigger trg_broadcast_campaigns_updated
  before update on public.broadcast_campaigns
  for each row execute function public.update_updated_at_column();
create trigger trg_broadcast_recipients_updated
  before update on public.broadcast_recipients
  for each row execute function public.update_updated_at_column();

-- ─── Cron: раз в минуту прокачиваем очередь рассылок ─────────────────────────
-- Auth: заголовок x-automation-key = automation_settings.cron_secret
-- (тот же паттерн, что crm-automations и capi-outbox-worker).
select cron.unschedule('broadcast-worker-minutely')
where exists (select 1 from cron.job where jobname = 'broadcast-worker-minutely');

select cron.schedule(
  'broadcast-worker-minutely',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/broadcast-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)
    ),
    body    := jsonb_build_object('source', 'cron')
  );
  $$
);
