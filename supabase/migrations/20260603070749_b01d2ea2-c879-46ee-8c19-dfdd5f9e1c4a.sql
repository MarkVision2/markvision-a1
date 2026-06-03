-- Make manual_* columns nullable so we can distinguish "no override" (NULL) from "explicit 0" override.
ALTER TABLE public.cabinet_daily_insights
  ALTER COLUMN manual_diagnostics DROP NOT NULL,
  ALTER COLUMN manual_diagnostics DROP DEFAULT,
  ALTER COLUMN manual_sales DROP NOT NULL,
  ALTER COLUMN manual_sales DROP DEFAULT,
  ALTER COLUMN manual_revenue DROP NOT NULL,
  ALTER COLUMN manual_revenue DROP DEFAULT,
  ALTER COLUMN manual_diagnostic_revenue DROP NOT NULL,
  ALTER COLUMN manual_diagnostic_revenue DROP DEFAULT;

-- Clean legacy zeros: treat existing 0 as "no override".
UPDATE public.cabinet_daily_insights SET manual_diagnostics = NULL WHERE manual_diagnostics = 0;
UPDATE public.cabinet_daily_insights SET manual_sales = NULL WHERE manual_sales = 0;
UPDATE public.cabinet_daily_insights SET manual_revenue = NULL WHERE manual_revenue = 0;
UPDATE public.cabinet_daily_insights SET manual_diagnostic_revenue = NULL WHERE manual_diagnostic_revenue = 0;