ALTER TABLE public.cabinet_daily_insights
  ADD COLUMN IF NOT EXISTS manual_sales integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_revenue numeric NOT NULL DEFAULT 0;