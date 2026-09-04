-- OAuth-подключение аккаунтов площадок к очереди публикаций
-- (docs/AUTOPOSTING-PLATFORM.md): Threads, TikTok, YouTube — по образцу
-- google_oauth_states / meta_oauth_states. Одноразовый state с TTL (проверяет
-- edge-функция publish-oauth), RLS без политик — читает только service_role.
CREATE TABLE IF NOT EXISTS public.publish_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  platform text NOT NULL,
  return_url text NOT NULL,
  group_id uuid REFERENCES public.publish_account_groups(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_oauth_states_platform_check CHECK (platform IN ('threads', 'tiktok', 'youtube'))
);

ALTER TABLE public.publish_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS publish_oauth_states_created_idx ON public.publish_oauth_states (created_at);

-- Просроченные state убирает GC контент-конвейера (раз в 10 минут).
CREATE OR REPLACE FUNCTION public.content_pipeline_gc()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.pipeline_callback_nonces WHERE seen_at < now() - interval '1 day';
  DELETE FROM public.pipeline_telegram_updates WHERE seen_at < now() - interval '7 days';
  DELETE FROM public.pipeline_review_tokens
   WHERE used_at IS NOT NULL AND used_at < now() - interval '30 days';
  DELETE FROM public.publish_oauth_states WHERE created_at < now() - interval '1 hour';
$$;

-- Аккаунт помнит, какой OAuth-scope выдан: без video.publish / youtube.upload
-- публикация невозможна, и монитор покажет это заранее.
ALTER TABLE public.publish_accounts
  ADD COLUMN IF NOT EXISTS oauth_scope text,
  ADD COLUMN IF NOT EXISTS connected_by uuid;
