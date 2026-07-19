-- Fix codeword insert + Instagram Login connect without Facebook Page.
--
-- 1) short_id DEFAULT calling gen_random_bytes() fails on prod with:
--    "function gen_random_bytes(integer) does not exist"
--    → rewrite generator to pure SQL (md5/random), no pgcrypto.
-- 2) Allow Instagram Login–only accounts (page_* may be null / placeholder).
-- 3) Recreate instagram_accounts_safe with ig_login_token_present + grants
--    so members can see the connected @zapoinov again.

-- ---------------------------------------------------------------------------
-- 1) short_id generator without pgcrypto
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gen_codeword_short_id()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT substr(
    translate(
      md5(random()::text || clock_timestamp()::text || coalesce(inet_client_addr()::text, '')),
      'abcdef',
      'ghijkl'
    ),
    1,
    10
  );
$$;

COMMENT ON FUNCTION public.gen_codeword_short_id() IS
  '10-char short id for ig-organic-redirect (?c=). Pure SQL — no pgcrypto.';

-- Ensure variant columns exist (idempotent; may already be applied).
ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS comment_replies jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dm_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS target_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS short_id text;

UPDATE public.instagram_codewords
   SET short_id = public.gen_codeword_short_id()
 WHERE short_id IS NULL OR btrim(short_id) = '';

ALTER TABLE public.instagram_codewords
  ALTER COLUMN short_id SET DEFAULT public.gen_codeword_short_id();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'instagram_codewords' AND column_name = 'short_id'
  ) THEN
    BEGIN
      ALTER TABLE public.instagram_codewords ALTER COLUMN short_id SET NOT NULL;
    EXCEPTION WHEN others THEN
      NULL; -- leave nullable if backfill somehow incomplete
    END;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS instagram_codewords_short_id_key
  ON public.instagram_codewords(short_id);

-- ---------------------------------------------------------------------------
-- 2) Instagram Login token column + nullable page fields for login-only link
-- ---------------------------------------------------------------------------
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS ig_login_access_token text;

ALTER TABLE public.instagram_accounts
  ALTER COLUMN page_id DROP NOT NULL;

ALTER TABLE public.instagram_accounts
  ALTER COLUMN page_access_token DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'instagram_accounts'
      AND column_name = 'ig_login_token_present'
  ) THEN
    ALTER TABLE public.instagram_accounts
      ADD COLUMN ig_login_token_present boolean
      GENERATED ALWAYS AS (ig_login_access_token IS NOT NULL AND length(ig_login_access_token) > 0) STORED;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'instagram_accounts'
      AND column_name = 'page_token_present'
  ) THEN
    ALTER TABLE public.instagram_accounts
      ADD COLUMN page_token_present boolean
      GENERATED ALWAYS AS (page_access_token IS NOT NULL AND length(page_access_token) > 0) STORED;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Safe view: members must be able to SELECT connected account
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.instagram_accounts TO authenticated;

DROP VIEW IF EXISTS public.instagram_accounts_safe;
CREATE VIEW public.instagram_accounts_safe
WITH (security_invoker = true) AS
SELECT
  id,
  project_id,
  ig_user_id,
  username,
  name,
  profile_picture_url,
  page_id,
  page_name,
  page_token_present,
  ig_login_token_present,
  followers_count,
  follows_count,
  media_count,
  active,
  last_sync_at,
  last_error,
  created_at,
  updated_at
FROM public.instagram_accounts;

COMMENT ON VIEW public.instagram_accounts_safe IS
  'Client-safe Instagram account (no raw tokens). Includes ig_login_token_present for DM via Instagram Login.';

GRANT SELECT ON public.instagram_accounts_safe TO authenticated;
REVOKE ALL ON public.instagram_accounts_safe FROM anon;
REVOKE SELECT (page_access_token) ON public.instagram_accounts FROM PUBLIC, authenticated, anon;
REVOKE SELECT (ig_login_access_token) ON public.instagram_accounts FROM PUBLIC, authenticated, anon;
