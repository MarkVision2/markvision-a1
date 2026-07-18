-- Скрытые из выбора HeyGen-аватары/голоса — НА ПРОЕКТ, с хранением на сервере.
-- Раньше скрытие жило только в localStorage браузера: при смене устройства,
-- очистке кэша или скрытии до выбора проекта («none») всё возвращалось.
create table if not exists public.heygen_hidden_items (
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('avatars','voices')),
  item_id text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, kind, item_id)
);

alter table public.heygen_hidden_items enable row level security;

-- Тот же паттерн, что project_avatars/heygen_defaults: видимость project_id
-- уже ограничена RLS таблицы projects.
drop policy if exists heygen_hidden_items_rw on public.heygen_hidden_items;
create policy heygen_hidden_items_rw on public.heygen_hidden_items for all
  using (project_id in (select id from public.projects))
  with check (project_id in (select id from public.projects));
