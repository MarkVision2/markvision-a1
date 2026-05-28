-- Migration: payment reminders для долгов
-- Применить после 02_finance.sql

-- Колонка next_payment_date — дата следующего ежемесячного платежа
ALTER TABLE debts
  ADD COLUMN IF NOT EXISTS next_payment_date DATE;

-- Колонка last_payment_reminder_sent_at — когда был отправлен последний ремайндер
-- (чтобы не спамить если cron запустился несколько раз)
ALTER TABLE debts
  ADD COLUMN IF NOT EXISTS last_payment_reminder_sent_at TIMESTAMPTZ;

-- Индекс для крон-запроса "за 3 дня до next_payment_date"
CREATE INDEX IF NOT EXISTS debts_next_payment_idx
  ON debts(next_payment_date)
  WHERE is_closed = false AND next_payment_date IS NOT NULL;

-- Функция: пересчёт next_payment_date после каждого debt_payment
-- (переносит на следующий месяц от текущего значения)
CREATE OR REPLACE FUNCTION advance_next_payment_date()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE debts
  SET next_payment_date = next_payment_date + INTERVAL '1 month'
  WHERE id = NEW.debt_id AND next_payment_date IS NOT NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_advance_next_payment_date ON debt_payments;
CREATE TRIGGER trg_advance_next_payment_date
  AFTER INSERT ON debt_payments
  FOR EACH ROW
  EXECUTE FUNCTION advance_next_payment_date();

-- Поставить начальное next_payment_date для существующих долгов
-- (день месяца = день создания долга, ближайшая будущая дата)
UPDATE debts
SET next_payment_date = (
  DATE_TRUNC('month', NOW())
  + INTERVAL '1 month'
  + (EXTRACT(DAY FROM created_at)::int - 1) * INTERVAL '1 day'
)::date
WHERE next_payment_date IS NULL AND is_closed = false;
