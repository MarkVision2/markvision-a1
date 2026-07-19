-- =============================================================================
-- MarkVision AI — фикс «комментарий хаб без ответа»
-- Проект: szfgdruhlebfvcmlvxdk
-- Безопасно запускать повторно.
-- =============================================================================

ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS reply_text text,
  ADD COLUMN IF NOT EXISTS dm_text text;

CREATE INDEX IF NOT EXISTS idx_instagram_accounts_ig_user_id
  ON public.instagram_accounts(ig_user_id);

ALTER TABLE public.instagram_organic_events
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS instagram_organic_events_external_id_key
  ON public.instagram_organic_events (external_id)
  WHERE external_id IS NOT NULL;

-- Быстрая проверка после применения:
-- SELECT codeword, active FROM instagram_codewords WHERE lower(codeword) = 'хаб';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'instagram_organic_events' AND column_name = 'external_id';
