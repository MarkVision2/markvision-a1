-- Код-слово → автоответ/DM: колонки, на которые опирается ig-webhook.
-- Без external_id claimEvent падает (PGRST / 400) → молча нет ответа на комментарий.
-- Без reply_text/dm_text select в webhook тоже может ломаться на старых БД.

ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS reply_text text,
  ADD COLUMN IF NOT EXISTS dm_text text;

CREATE INDEX IF NOT EXISTS idx_instagram_accounts_ig_user_id
  ON public.instagram_accounts(ig_user_id);

ALTER TABLE public.instagram_organic_events
  ADD COLUMN IF NOT EXISTS external_id text;

-- Один комментарий Meta → одна обработка (ретраи вебхука).
CREATE UNIQUE INDEX IF NOT EXISTS instagram_organic_events_external_id_key
  ON public.instagram_organic_events (external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON COLUMN public.instagram_organic_events.external_id IS
  'Meta comment id — идемпотентность ig-webhook (claim до reply/DM).';
