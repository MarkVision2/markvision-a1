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

select cron.unschedule('ads-telegram-media-cleanup')
where exists (select 1 from cron.job where jobname = 'ads-telegram-media-cleanup');

select cron.schedule(
  'ads-telegram-media-cleanup',
  '15 3 * * *',
  $$ select public.cleanup_ad_telegram_media(); $$
);
