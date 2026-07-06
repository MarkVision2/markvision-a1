-- Ручные override для всех показателей таблицы метрик.
-- NULL = авто (Meta / CRM), число = явная корректировка за день.

ALTER TABLE public.cabinet_daily_insights
  ADD COLUMN IF NOT EXISTS manual_spend numeric,
  ADD COLUMN IF NOT EXISTS manual_leads integer;

ALTER TABLE public.rnp_daily
  ADD COLUMN IF NOT EXISTS manual_spend numeric,
  ADD COLUMN IF NOT EXISTS manual_leads integer,
  ADD COLUMN IF NOT EXISTS manual_crm_received integer,
  ADD COLUMN IF NOT EXISTS manual_qualified integer,
  ADD COLUMN IF NOT EXISTS manual_planned_visits integer,
  ADD COLUMN IF NOT EXISTS manual_conducted_visits integer,
  ADD COLUMN IF NOT EXISTS manual_diagnostics_paid integer,
  ADD COLUMN IF NOT EXISTS manual_diagnostics integer,
  ADD COLUMN IF NOT EXISTS manual_diagnostic_revenue numeric,
  ADD COLUMN IF NOT EXISTS manual_sales integer,
  ADD COLUMN IF NOT EXISTS manual_sales_revenue numeric,
  ADD COLUMN IF NOT EXISTS manual_cash numeric;
