ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS whatsapp_id text,
  ADD COLUMN IF NOT EXISTS pixel_id text,
  ADD COLUMN IF NOT EXISTS pixel_event text,
  ADD COLUMN IF NOT EXISTS lead_form_id text;