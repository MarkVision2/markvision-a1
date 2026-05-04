
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.cabinet_daily_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL,
  external_id text NOT NULL,
  date date NOT NULL,
  spend numeric NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  leads integer NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  cpl numeric NOT NULL DEFAULT 0,
  cpm numeric NOT NULL DEFAULT 0,
  cpc numeric NOT NULL DEFAULT 0,
  ctr numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_id, date)
);

CREATE INDEX IF NOT EXISTS idx_cdi_cabinet_date ON public.cabinet_daily_insights (cabinet_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_cdi_external_date ON public.cabinet_daily_insights (external_id, date DESC);

ALTER TABLE public.cabinet_daily_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY cdi_select_authed ON public.cabinet_daily_insights
  FOR SELECT TO authenticated USING (true);

CREATE POLICY cdi_write_admin ON public.cabinet_daily_insights
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
