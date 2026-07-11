-- Эксклюзивная привязка HeyGen-аватара к одному проекту: аватары в HeyGen
-- общие на весь аккаунт, а этот справочник позволяет закрепить конкретный
-- аватар только за одним проектом — тогда он перестаёт быть видимым в
-- остальных проектах (см. HeygenAvatarPicker на клиенте).
create table if not exists public.project_avatars (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  avatar_id text not null,
  kind text not null check (kind in ('avatar','talking_photo')),
  created_at timestamptz not null default now()
);

-- Один и тот же аватар не может быть закреплён больше чем за одним проектом
-- одновременно — назначение на новый проект автоматически "отбирает" его
-- у прежнего (upsert по этому ключу на клиенте).
create unique index if not exists project_avatars_avatar_unique on public.project_avatars (avatar_id, kind);

alter table public.project_avatars enable row level security;

-- Тот же паттерн, что и у heygen_defaults: project_id должен существовать
-- в projects, а RLS самой projects уже ограничивает видимость владельцем/
-- админом/участником — здесь ничего дополнительно дублировать не нужно.
create policy project_avatars_rw on public.project_avatars for all
  using (project_id in (select id from public.projects))
  with check (project_id in (select id from public.projects));
