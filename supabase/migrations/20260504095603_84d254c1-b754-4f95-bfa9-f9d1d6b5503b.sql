ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS launch_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_campaigns_launch_id
  ON public.ad_campaigns (launch_id)
  WHERE launch_id IS NOT NULL;