-- Закрываем 9 public-таблиц без RLS (advisor: rls_disabled_in_public / sensitive_columns_exposed).
-- Все они — таблицы внешних воркеров (Clony/Reels Factory/бот на n8n). Фронтенд MarkVision и
-- edge-функции к ним не обращаются, а n8n ходит через service-role JWT (обходит RLS), поэтому
-- включение RLS автоматизацию не ломает. Таблицам без тенант-колонки политики не даём —
-- доступ только у service-role. Тенант-скоуп добавляем там, где есть project_id/user_id.

-- Clony (n8n) — без пользовательского тенанта: полный локдаун (только service-role).
alter table public.clony_requests enable row level security;
alter table public.clony_designs enable row level security;

-- Clony результаты — есть project_id: разрешаем чтение в рамках доступных проектов.
alter table public.clony_results enable row level security;
create policy clony_results_select on public.clony_results
  for select to authenticated
  using (project_id is null or project_id in (select id::text from public.projects));

-- Reels Factory (мёртвый воркер) — без тенанта: локдаун.
alter table public.content_jobs enable row level security;
alter table public.content_ideas enable row level security;
alter table public.content_projects enable row level security;

-- B-roll библиотека воркера — есть project_id.
alter table public.broll_library enable row level security;
create policy broll_library_select on public.broll_library
  for select to authenticated
  using (project_id is null or project_id in (select id::text from public.projects));

-- Брендбуки — привязаны к user_id.
alter table public.brand_templates enable row level security;
create policy brand_templates_owner on public.brand_templates
  for all to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

-- Таблица интересов бота (n8n) — без тенанта: локдаун.
alter table public.chat_interests enable row level security;
