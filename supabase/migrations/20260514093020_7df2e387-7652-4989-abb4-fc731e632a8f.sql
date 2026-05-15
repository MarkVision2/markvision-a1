ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS ads_only boolean NOT NULL DEFAULT true;