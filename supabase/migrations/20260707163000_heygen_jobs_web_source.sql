-- Веб-генерации тоже кладём в очередь heygen_jobs (устойчиво к закрытию вкладки).
-- У веб-задач нет Telegram-чата → chat_id может быть NULL; источник отмечаем в source.
alter table public.heygen_jobs alter column chat_id drop not null;
alter table public.heygen_jobs add column if not exists source text not null default 'telegram';

-- Авторизованный пользователь может ставить задачу для своего проекта.
drop policy if exists hj_insert on public.heygen_jobs;
create policy hj_insert on public.heygen_jobs
  for insert to authenticated
  with check (project_id in (select id from public.projects));
