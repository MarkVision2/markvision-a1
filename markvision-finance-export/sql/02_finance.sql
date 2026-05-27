-- ============================================================
-- Personal Assistant — Finance module (incomes, debts, goals++)
-- Запусти этот SQL в Dashboard → SQL Editor нового Supabase проекта
-- ОДНИМ блоком. Идемпотентно: IF NOT EXISTS / DROP IF EXISTS.
-- ============================================================

-- ====== INCOMES (доходы) ======
CREATE TABLE IF NOT EXISTS income_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#10b981',
  icon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, slug)
);

CREATE TABLE IF NOT EXISTS incomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'RUB',
  category_id UUID REFERENCES income_categories(id) ON DELETE SET NULL,
  client_name TEXT,                 -- "от кого" (имя клиента / компании)
  description TEXT,
  raw_text TEXT,
  source TEXT,                       -- 'telegram', 'manual', 'recurring'
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incomes_user_received_idx ON incomes(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS incomes_user_category_idx ON incomes(user_id, category_id);
CREATE INDEX IF NOT EXISTS incomes_user_client_idx ON incomes(user_id, client_name);

-- ====== DEBTS (кредиты / финансовые обязательства) ======
CREATE TABLE IF NOT EXISTS debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                          -- "Ипотека Сбер", "Кредит на машину"
  kind TEXT NOT NULL DEFAULT 'loan'
    CHECK (kind IN ('loan','credit_card','installment','personal','other')),
  initial_amount NUMERIC(14,2) NOT NULL CHECK (initial_amount > 0),
  current_balance NUMERIC(14,2) NOT NULL,      -- сколько осталось выплатить
  currency TEXT NOT NULL DEFAULT 'RUB',
  interest_rate NUMERIC(5,2),                  -- % годовых (опционально)
  monthly_payment NUMERIC(12,2),               -- ежемесячный обяз. платёж (опц.)
  start_date DATE,
  end_date DATE,                               -- плановая дата закрытия
  is_closed BOOLEAN NOT NULL DEFAULT false,
  closed_at TIMESTAMPTZ,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS debts_user_idx ON debts(user_id, is_closed);

CREATE TABLE IF NOT EXISTS debt_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  debt_id UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_text TEXT,
  source TEXT,                                 -- 'telegram', 'manual'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS debt_payments_user_paid_idx ON debt_payments(user_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS debt_payments_debt_idx ON debt_payments(debt_id);

-- Автоматически уменьшаем current_balance при добавлении платежа
CREATE OR REPLACE FUNCTION apply_debt_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE debts
    SET current_balance = GREATEST(0, current_balance - NEW.amount),
        is_closed       = (current_balance - NEW.amount) <= 0,
        closed_at       = CASE WHEN (current_balance - NEW.amount) <= 0 THEN now() ELSE closed_at END,
        updated_at      = now()
    WHERE id = NEW.debt_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS debt_payment_apply ON debt_payments;
CREATE TRIGGER debt_payment_apply
  AFTER INSERT ON debt_payments
  FOR EACH ROW EXECUTE FUNCTION apply_debt_payment();

-- Откат при удалении платежа
CREATE OR REPLACE FUNCTION revert_debt_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE debts
    SET current_balance = current_balance + OLD.amount,
        is_closed       = false,
        closed_at       = NULL,
        updated_at      = now()
    WHERE id = OLD.debt_id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS debt_payment_revert ON debt_payments;
CREATE TRIGGER debt_payment_revert
  AFTER DELETE ON debt_payments
  FOR EACH ROW EXECUTE FUNCTION revert_debt_payment();

-- ====== GOALS — расширяем существующую таблицу ======
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS icon TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#6366f1',
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Если в goals.kind ещё нет 'savings_target' / 'asset_purchase' — расширяем enum
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_kind_check;
ALTER TABLE goals ADD CONSTRAINT goals_kind_check
  CHECK (kind IN ('savings','spending_limit','asset_purchase','debt_payoff'));

-- Лог пополнений по цели (для аналитики и истории)
CREATE TABLE IF NOT EXISTS goal_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount <> 0),  -- + добавил, - снял
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  raw_text TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS goal_contributions_user_idx ON goal_contributions(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS goal_contributions_goal_idx ON goal_contributions(goal_id);

-- Обновлять current_amount при добавлении/удалении contribution
CREATE OR REPLACE FUNCTION apply_goal_contribution()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE goals SET current_amount = current_amount + NEW.amount, updated_at = now() WHERE id = NEW.goal_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE goals SET current_amount = current_amount - OLD.amount, updated_at = now() WHERE id = OLD.goal_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS goal_contribution_apply ON goal_contributions;
CREATE TRIGGER goal_contribution_apply
  AFTER INSERT OR DELETE ON goal_contributions
  FOR EACH ROW EXECUTE FUNCTION apply_goal_contribution();

-- ====== RLS на новых таблицах ======
ALTER TABLE income_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE incomes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY own_income_cats ON income_categories FOR ALL TO authenticated
  USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY own_incomes ON incomes FOR ALL TO authenticated
  USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY own_debts ON debts FOR ALL TO authenticated
  USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY own_debt_payments ON debt_payments FOR ALL TO authenticated
  USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY own_goal_contribs ON goal_contributions FOR ALL TO authenticated
  USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

-- ====== Сидим дефолтные категории доходов для существующих юзеров ======
INSERT INTO income_categories (user_id, name, slug, color, icon)
SELECT u.id, c.name, c.slug, c.color, c.icon
FROM auth.users u
CROSS JOIN (VALUES
  ('Клиент', 'client',  '#10b981', 'briefcase'),
  ('Зарплата','salary', '#3b82f6', 'wallet'),
  ('Подарок','gift',    '#f59e0b', 'gift'),
  ('Возврат','refund',  '#a855f7', 'undo-2'),
  ('Прочее', 'other',   '#6b7280', 'circle-ellipsis')
) AS c(name, slug, color, icon)
ON CONFLICT (user_id, slug) DO NOTHING;

-- И на будущее — автосид доходных категорий при регистрации
CREATE OR REPLACE FUNCTION seed_default_income_categories()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO income_categories (user_id, name, slug, color, icon) VALUES
    (NEW.id, 'Клиент',  'client',  '#10b981', 'briefcase'),
    (NEW.id, 'Зарплата','salary',  '#3b82f6', 'wallet'),
    (NEW.id, 'Подарок', 'gift',    '#f59e0b', 'gift'),
    (NEW.id, 'Возврат', 'refund',  '#a855f7', 'undo-2'),
    (NEW.id, 'Прочее',  'other',   '#6b7280', 'circle-ellipsis');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS seed_income_categories_on_signup ON auth.users;
CREATE TRIGGER seed_income_categories_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION seed_default_income_categories();

-- ====== Полезные view для дашборда ======

-- Месячный balance: доходы - расходы по месяцам за последние 12 мес
CREATE OR REPLACE VIEW monthly_balance AS
SELECT
  u.id AS user_id,
  to_char(d, 'YYYY-MM') AS month,
  COALESCE(SUM(i.amount), 0) AS income_total,
  COALESCE(SUM(e.amount), 0) AS expense_total,
  COALESCE(SUM(i.amount), 0) - COALESCE(SUM(e.amount), 0) AS balance
FROM auth.users u
CROSS JOIN generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') AS d
LEFT JOIN incomes  i ON i.user_id = u.id AND date_trunc('month', i.received_at) = d
LEFT JOIN expenses e ON e.user_id = u.id AND date_trunc('month', e.occurred_at) = d
GROUP BY u.id, d
ORDER BY u.id, d;

-- Сводка по кредитам: для дашборда
CREATE OR REPLACE VIEW debts_summary AS
SELECT
  user_id,
  COUNT(*) FILTER (WHERE NOT is_closed) AS active_count,
  COALESCE(SUM(current_balance) FILTER (WHERE NOT is_closed), 0) AS total_remaining,
  COALESCE(SUM(initial_amount) FILTER (WHERE NOT is_closed), 0) AS total_initial,
  COALESCE(SUM(monthly_payment) FILTER (WHERE NOT is_closed), 0) AS total_monthly
FROM debts
GROUP BY user_id;

GRANT SELECT ON monthly_balance, debts_summary TO authenticated;

-- ============================================================
-- ГОТОВО. Проверка:
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;
-- Должны быть: debts, debt_payments, expense_categories, expenses, goal_contributions,
-- goals, income_categories, incomes, tasks, telegram_users
-- ============================================================
