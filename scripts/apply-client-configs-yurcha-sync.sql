-- Fix client_configs dual-write + backfill кабинет «Юрча».
-- Run in Supabase SQL Editor (szfgdruhlebfvcmlvxdk).

-- 1) RLS: allow authenticated users to INSERT/UPDATE/DELETE mirrors.
--    SELECT stays locked (no anon/auth read of access_token). Service role bypasses RLS.
ALTER TABLE public.client_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_config insert anon" ON public.client_configs;
DROP POLICY IF EXISTS "client_configs_insert_authed" ON public.client_configs;
DROP POLICY IF EXISTS "client_configs_update_authed" ON public.client_configs;
DROP POLICY IF EXISTS "client_configs_delete_authed" ON public.client_configs;
DROP POLICY IF EXISTS "client_config select anon" ON public.client_configs;

CREATE POLICY client_configs_insert_authed ON public.client_configs
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY client_configs_update_authed ON public.client_configs
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY client_configs_delete_authed ON public.client_configs
  FOR DELETE TO authenticated
  USING (true);

-- Optional: also allow anon insert only if front still uses publishable key
-- without JWT (legacy). Prefer authenticated; keep anon closed for tokens.

GRANT INSERT, UPDATE, DELETE ON public.client_configs TO authenticated;
-- Do NOT grant SELECT of whole table to anon (tokens). Service role / edge only.

-- 2) Backfill from ad_cabinets → client_configs for «Юрча» (+ any missing Meta cabinets).
--    Copies access_token from ad_cabinets when present.
INSERT INTO public.client_configs (
  cabinet_id,
  name,
  type,
  daily_budget,
  city,
  ad_account_id,
  page_id,
  page_name,
  instagram_id,
  access_token,
  telegram_group_id,
  whatsapp_number,
  pixel_id,
  pixel_event,
  website_url,
  brief
)
SELECT
  c.id,
  COALESCE(NULLIF(TRIM(c.name), ''), 'Юрча'),
  CASE WHEN c.type = 'Агентский' THEN 'Агентский' ELSE 'Личный' END,
  c.daily_budget,
  c.city,
  COALESCE(c.ad_account_id, c.external_id),
  c.page_id,
  c.page_name,
  c.instagram_id,
  c.access_token,
  c.telegram_group_id,
  c.whatsapp_number,
  c.pixel_id,
  COALESCE(c.pixel_event, 'Lead'),
  c.website_url,
  c.brief
FROM public.ad_cabinets c
WHERE
  c.name ILIKE '%юрч%'
  OR c.name ILIKE '%yurch%'
  OR EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = c.project_id
      AND (p.name ILIKE '%юрч%' OR p.name ILIKE '%yurch%')
  )
ON CONFLICT (cabinet_id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  daily_budget = EXCLUDED.daily_budget,
  city = EXCLUDED.city,
  ad_account_id = EXCLUDED.ad_account_id,
  page_id = EXCLUDED.page_id,
  page_name = EXCLUDED.page_name,
  instagram_id = EXCLUDED.instagram_id,
  access_token = COALESCE(EXCLUDED.access_token, public.client_configs.access_token),
  telegram_group_id = EXCLUDED.telegram_group_id,
  whatsapp_number = EXCLUDED.whatsapp_number,
  pixel_id = EXCLUDED.pixel_id,
  pixel_event = EXCLUDED.pixel_event,
  website_url = EXCLUDED.website_url,
  brief = EXCLUDED.brief;

-- 2b) Also backfill ANY ad_cabinets missing from client_configs (same project DB).
INSERT INTO public.client_configs (
  cabinet_id, name, type, daily_budget, city, ad_account_id,
  page_id, page_name, instagram_id, access_token,
  telegram_group_id, whatsapp_number, pixel_id, pixel_event, website_url, brief
)
SELECT
  c.id,
  COALESCE(NULLIF(TRIM(c.name), ''), c.id::text),
  CASE WHEN c.type = 'Агентский' THEN 'Агентский' ELSE 'Личный' END,
  c.daily_budget, c.city, COALESCE(c.ad_account_id, c.external_id),
  c.page_id, c.page_name, c.instagram_id, c.access_token,
  c.telegram_group_id, c.whatsapp_number, c.pixel_id,
  COALESCE(c.pixel_event, 'Lead'), c.website_url, c.brief
FROM public.ad_cabinets c
WHERE NOT EXISTS (
  SELECT 1 FROM public.client_configs cc WHERE cc.cabinet_id = c.id
)
ON CONFLICT (cabinet_id) DO NOTHING;

-- 3) Show what we synced for Юрча (dashboard / SQL Editor result)
SELECT
  cc.cabinet_id,
  cc.name,
  cc.ad_account_id,
  cc.page_id,
  cc.page_name,
  cc.instagram_id,
  cc.pixel_id,
  cc.whatsapp_number,
  cc.city,
  cc.daily_budget,
  CASE WHEN cc.access_token IS NULL OR cc.access_token = '' THEN 'нет токена' ELSE 'токен есть' END AS token_status
FROM public.client_configs cc
WHERE cc.name ILIKE '%юрч%' OR cc.name ILIKE '%yurch%';
