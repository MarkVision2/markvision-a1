
ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS webhook_url text;
