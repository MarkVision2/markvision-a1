-- Personal Assistant — schema (already applied to project zcsxzgigtsdoebtginfy)
-- Kept here as the source of truth for re-deploying or local dev.

-- Whitelist Telegram users -> auth.users
CREATE TABLE telegram_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_chat_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tasks (mirror of Google Calendar events for the frontend)
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  duration_minutes INT,
  google_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  raw_text TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_user_starts_idx ON tasks(user_id, starts_at);

-- Expense categories
CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#888888',
  icon TEXT,
  monthly_limit NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, slug)
);

-- Expenses
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'RUB',
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  description TEXT,
  raw_text TEXT,
  source TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expenses_user_occurred_idx ON expenses(user_id, occurred_at DESC);
CREATE INDEX expenses_user_category_idx ON expenses(user_id, category_id);

-- Financial goals
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'savings' CHECK (kind IN ('savings','spending_limit')),
  target_amount NUMERIC(12,2) NOT NULL,
  current_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'RUB',
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  target_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS — каждый видит только свои строки
ALTER TABLE telegram_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY own_tg_users ON telegram_users FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY own_tasks ON tasks FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY own_categories ON expense_categories FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY own_expenses ON expenses FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY own_goals ON goals FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RPC для n8n: получить user_id по Telegram chat_id (SECURITY DEFINER обходит RLS).
CREATE OR REPLACE FUNCTION get_user_by_chat_id(p_chat_id BIGINT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM telegram_users WHERE telegram_chat_id = p_chat_id LIMIT 1;
$$;

-- При регистрации нового пользователя — сразу создать дефолтные категории расходов.
CREATE OR REPLACE FUNCTION seed_default_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO expense_categories (user_id, name, slug, color, icon) VALUES
    (NEW.id, 'Еда', 'food', '#ef4444', 'utensils'),
    (NEW.id, 'Транспорт', 'transport', '#3b82f6', 'car'),
    (NEW.id, 'Развлечения', 'entertainment', '#a855f7', 'film'),
    (NEW.id, 'Быт', 'household', '#10b981', 'home'),
    (NEW.id, 'Одежда', 'clothing', '#f59e0b', 'shirt'),
    (NEW.id, 'Здоровье', 'health', '#ec4899', 'heart-pulse'),
    (NEW.id, 'Прочее', 'other', '#6b7280', 'circle-ellipsis');
  RETURN NEW;
END;
$$;

CREATE TRIGGER seed_categories_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION seed_default_categories();
