
CREATE TABLE IF NOT EXISTS public.fx_rates (
  date date PRIMARY KEY,
  usd_kzt numeric NOT NULL,
  source text NOT NULL DEFAULT 'nbk',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fx_rates_select_authed"
  ON public.fx_rates FOR SELECT
  TO authenticated
  USING (true);
