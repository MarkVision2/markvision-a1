ALTER TABLE public.ad_cabinets
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS page_name text,
  ADD COLUMN IF NOT EXISTS instagram_id text,
  ADD COLUMN IF NOT EXISTS telegram_group_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS pixel_event text DEFAULT 'Lead',
  ADD COLUMN IF NOT EXISTS website_url text;