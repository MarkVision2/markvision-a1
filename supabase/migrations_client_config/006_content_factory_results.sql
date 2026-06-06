-- Content Factory: stream-back results from n8n -> frontend via Supabase Realtime.
--
-- Контракт:
--   n8n воркфлоу "Clony AI" (https://n8n.zapoinov.com/workflow/sWhNUAx8tFXU0O47)
--   ПОСЛЕ каждой готовой картинки/слайда делает INSERT в эту таблицу с
--   request_id, который пришёл в webhook payload. Фронт подписан на realtime
--   по request_id и сразу подменяет «в работе» на готовое изображение.

create table if not exists public.content_factory_results (
  id uuid primary key default gen_random_uuid(),
  -- идентификатор задачи. Совпадает с request_id из webhook payload.
  -- ОДНА задача = одна или несколько строк (по строке на каждый слайд/стиль).
  request_id text not null,
  -- индекс слайда в карусели / индекс стиля в батче. Для одиночного — 0.
  slide_index integer not null default 0,
  -- id и читаемое имя стиля из фронта (для match-а с карточкой).
  style_id text,
  style_label text,
  -- статус: queued (поставлено), ready (картинка есть), error (упало).
  status text not null default 'queued'
    check (status in ('queued', 'ready', 'error')),
  image_url text,
  -- сырые данные ответа из image-generator (для отладки).
  raw jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_content_factory_results_request_id
  on public.content_factory_results (request_id, slide_index);

create index if not exists idx_content_factory_results_created_at
  on public.content_factory_results (created_at desc);

-- updated_at автотриггер.
create or replace function public.touch_content_factory_results()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_content_factory_results
  on public.content_factory_results;
create trigger trg_touch_content_factory_results
  before update on public.content_factory_results
  for each row execute function public.touch_content_factory_results();

-- RLS: фронт ходит под anon-ключом. Разрешаем SELECT всем — request_id это
-- криптослучайный UUID, угадать его невозможно. INSERT/UPDATE — только
-- service_role (n8n использует service_role key).
alter table public.content_factory_results enable row level security;

drop policy if exists "anon can read by request_id"
  on public.content_factory_results;
create policy "anon can read by request_id"
  on public.content_factory_results
  for select
  using (true);

drop policy if exists "service_role full access"
  on public.content_factory_results;
create policy "service_role full access"
  on public.content_factory_results
  for all
  to service_role
  using (true)
  with check (true);

-- Включаем realtime publication (идемпотентно — повторный запуск не падает).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.content_factory_results;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
