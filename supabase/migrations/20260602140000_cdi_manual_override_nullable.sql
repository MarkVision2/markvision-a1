-- Ручные поля CDI: NULL = нет override (берём CRM), число = явная правка на день.
-- Раньше DEFAULT 0 и проверка «> 0» не позволяли сбросить override и путали с «записать 0».

ALTER TABLE public.cabinet_daily_insights
  ALTER COLUMN manual_diagnostics DROP NOT NULL,
  ALTER COLUMN manual_diagnostics DROP DEFAULT,
  ALTER COLUMN manual_sales DROP NOT NULL,
  ALTER COLUMN manual_sales DROP DEFAULT,
  ALTER COLUMN manual_revenue DROP NOT NULL,
  ALTER COLUMN manual_revenue DROP DEFAULT,
  ALTER COLUMN manual_diagnostic_revenue DROP NOT NULL,
  ALTER COLUMN manual_diagnostic_revenue DROP DEFAULT;

UPDATE public.cabinet_daily_insights SET manual_diagnostics = NULL WHERE manual_diagnostics = 0;
UPDATE public.cabinet_daily_insights SET manual_sales = NULL WHERE manual_sales = 0;
UPDATE public.cabinet_daily_insights SET manual_revenue = NULL WHERE manual_revenue = 0;
UPDATE public.cabinet_daily_insights SET manual_diagnostic_revenue = NULL WHERE manual_diagnostic_revenue = 0;

COMMENT ON COLUMN public.cabinet_daily_insights.manual_diagnostics IS
  'Ручная правка диагностик за день. NULL = из CRM (crm_diagnostics).';
COMMENT ON COLUMN public.cabinet_daily_insights.manual_sales IS
  'Ручная правка оплат за день. NULL = из CRM (crm_sales).';
COMMENT ON COLUMN public.cabinet_daily_insights.manual_revenue IS
  'Ручная правка выручки продаж за день. NULL = из CRM (crm_revenue).';
