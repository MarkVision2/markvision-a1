-- Backfill ad_cabinets / client_configs that were saved without access_token
-- while the project already had an active meta_tokens row (pick-from-list UI).
-- Idempotent. Project: szfgdruhlebfvcmlvxdk

UPDATE public.ad_cabinets ac
SET
  access_token = mt.access_token,
  updated_at = now()
FROM public.meta_tokens mt
WHERE mt.project_id = ac.project_id
  AND mt.is_active = true
  AND (ac.access_token IS NULL OR btrim(ac.access_token) = '')
  AND mt.access_token IS NOT NULL
  AND btrim(mt.access_token) <> '';

UPDATE public.client_configs cc
SET access_token = ac.access_token
FROM public.ad_cabinets ac
WHERE cc.cabinet_id = ac.id
  AND ac.access_token IS NOT NULL
  AND btrim(ac.access_token) <> ''
  AND (cc.access_token IS NULL OR btrim(cc.access_token) = '');

INSERT INTO public.client_configs (
  cabinet_id, name, type, daily_budget, city, ad_account_id,
  page_id, page_name, instagram_id, access_token,
  telegram_group_id, whatsapp_number, pixel_id, pixel_event, website_url, brief
)
SELECT
  ac.id,
  ac.name,
  CASE WHEN ac.type = 'Агентский' THEN 'Агентский' ELSE 'Личный' END,
  ac.daily_budget,
  ac.city,
  ac.ad_account_id,
  ac.page_id,
  ac.page_name,
  ac.instagram_id,
  ac.access_token,
  ac.telegram_group_id,
  ac.whatsapp_number,
  ac.pixel_id,
  COALESCE(ac.pixel_event, 'Lead'),
  ac.website_url,
  ac.brief
FROM public.ad_cabinets ac
WHERE NOT EXISTS (
  SELECT 1 FROM public.client_configs cc WHERE cc.cabinet_id = ac.id
)
ON CONFLICT (cabinet_id) DO NOTHING;
