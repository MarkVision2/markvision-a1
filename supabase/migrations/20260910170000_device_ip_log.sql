-- Журнал адресов выхода облачных телефонов.
--
-- Смысл всей затеи с устройствами в том, что каждый аккаунт выходит со своего IP. У мобильного
-- прокси адрес меняется сам, но не по нашей команде: без журнала невозможно понять, сменился он
-- между сессиями или два телефона сейчас сидят на одном адресе — а именно это площадка и видит
-- как один источник (docs/PHONEGRID.md).
--
-- Пишется при каждой проверке сети из карточки устройства; хранит адрес, а не трафик.

create table if not exists public.device_ip_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  provider    text not null default 'phonegrid',
  phone_id    text not null,
  ip          text not null,
  country     text,
  city        text,
  isp         text,
  is_mobile   boolean,
  seen_at     timestamptz not null default now()
);

comment on table public.device_ip_log is
  'Адреса выхода облачных телефонов: по нему видно, сменился ли IP между сессиями и не сидят ли два телефона на одном.';

create index if not exists device_ip_log_phone_idx on public.device_ip_log (project_id, phone_id, seen_at desc);
create index if not exists device_ip_log_ip_idx on public.device_ip_log (project_id, ip, seen_at desc);

alter table public.device_ip_log enable row level security;

-- Читают участники проекта, пишет только service_role из edge-функции.
drop policy if exists device_ip_log_select on public.device_ip_log;
create policy device_ip_log_select on public.device_ip_log
  for select using (exists (select 1 from public.projects p where p.id = device_ip_log.project_id));
