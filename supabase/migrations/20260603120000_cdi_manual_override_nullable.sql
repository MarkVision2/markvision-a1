-- NULL = нет ручной правки (берём crm_*). Число, включая 0 = явный факт за день.
ALTER TABLE public.cabinet_daily_insights
  ALTER COLUMN manual_diagnostics DROP NOT NULL,
  ALTER COLUMN manual_sales DROP NOT NULL,
  ALTER COLUMN manual_revenue DROP NOT NULL,
  ALTER COLUMN manual_diagnostic_revenue DROP NOT NULL;

ALTER TABLE public.cabinet_daily_insights
  ALTER COLUMN manual_diagnostics DROP DEFAULT,
  ALTER COLUMN manual_sales DROP DEFAULT,
  ALTER COLUMN manual_revenue DROP DEFAULT,
  ALTER COLUMN manual_diagnostic_revenue DROP DEFAULT;

UPDATE public.cabinet_daily_insights
SET
  manual_diagnostics = NULLIF(manual_diagnostics, 0),
  manual_sales = NULLIF(manual_sales, 0),
  manual_revenue = NULLIF(manual_revenue, 0),
  manual_diagnostic_revenue = NULLIF(manual_diagnostic_revenue, 0)
WHERE
  manual_diagnostics = 0
  OR manual_sales = 0
  OR manual_revenue = 0
  OR manual_diagnostic_revenue = 0;
