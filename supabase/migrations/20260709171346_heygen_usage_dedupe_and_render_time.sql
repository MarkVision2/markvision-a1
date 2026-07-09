-- render_time_sec: сколько реально шла генерация (created_at задачи → момент доставки).
alter table public.heygen_usage add column if not exists render_time_sec numeric;

-- Убираем уже накопленные дубликаты (одна и та же готовая генерация была
-- вставлена дважды из-за повторной обработки задачи воркером без idempotency-защиты).
-- Оставляем самую раннюю запись на (project_id, ref_id).
delete from public.heygen_usage a
using public.heygen_usage b
where a.ref_id is not null
  and a.project_id = b.project_id
  and a.ref_id = b.ref_id
  and a.created_at > b.created_at;

-- Полноценный UNIQUE (не partial): NULL в ref_id по стандарту SQL не считается
-- равным другому NULL, так что старые/чужие строки без ref_id по-прежнему
-- разрешены — ограничение работает только там, где ref_id реально задан.
-- Это же поле служит ключом для upsert(...).onConflict("project_id,ref_id").
alter table public.heygen_usage
  add constraint heygen_usage_project_ref_unique unique (project_id, ref_id);
