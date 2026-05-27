-- ============================================================
-- Personal Assistant — Tasks extensions
-- Запусти в Dashboard → SQL Editor нового Supabase проекта одним блоком.
-- Идемпотентно: можно прогнать повторно.
-- ============================================================

-- 1) Разрешаем NULL для starts_at (для задач-todo без точного времени)
ALTER TABLE tasks ALTER COLUMN starts_at DROP NOT NULL;

-- 2) Новые поля
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS due_date DATE,                      -- дата к которой нужно сделать (для todo)
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ,            -- когда отправлено напоминание за час
  ADD COLUMN IF NOT EXISTS is_todo BOOLEAN NOT NULL DEFAULT false; -- true = задача без времени (список «что подготовить»)

-- 3) Индексы для быстрых выборок
CREATE INDEX IF NOT EXISTS tasks_user_due_idx
  ON tasks(user_id, due_date)
  WHERE status = 'pending' AND is_todo = true;

CREATE INDEX IF NOT EXISTS tasks_reminder_pending_idx
  ON tasks(starts_at)
  WHERE status = 'pending' AND reminded_at IS NULL AND is_todo = false;

-- 4) Проверка: посмотреть структуру
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='tasks'
-- ORDER BY ordinal_position;
