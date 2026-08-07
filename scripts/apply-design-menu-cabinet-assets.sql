-- Backfill page / Instagram from Meta ads when promote_pages was empty.
-- Example: ДИЗАЙН МЕНЮ (act_1548332385908803) — page from creatives.
-- Idempotent for that cabinet id. Project: szfgdruhlebfvcmlvxdk

UPDATE public.ad_cabinets
SET
  page_id = COALESCE(NULLIF(btrim(page_id), ''), '106729685844290'),
  page_name = COALESCE(NULLIF(btrim(page_name), ''), 'InDesign'),
  instagram_id = COALESCE(NULLIF(btrim(instagram_id), ''), '17841400831805079'),
  website_url = COALESCE(NULLIF(btrim(website_url), ''), 'https://indesign-meny.vercel.app/'),
  business_id = COALESCE(NULLIF(btrim(business_id), ''), '1025810501083301'),
  updated_at = now()
WHERE id = '1f4478cc-53f5-4b0a-9759-0076959af74e';

UPDATE public.client_configs cc
SET
  page_id = ac.page_id,
  page_name = ac.page_name,
  instagram_id = ac.instagram_id,
  website_url = COALESCE(NULLIF(btrim(cc.website_url), ''), ac.website_url),
  pixel_id = ac.pixel_id,
  pixel_event = COALESCE(ac.pixel_event, cc.pixel_event, 'Lead'),
  telegram_group_id = COALESCE(cc.telegram_group_id, ac.telegram_group_id),
  city = COALESCE(cc.city, ac.city),
  daily_budget = COALESCE(ac.daily_budget, cc.daily_budget)
FROM public.ad_cabinets ac
WHERE cc.cabinet_id = ac.id
  AND ac.id = '1f4478cc-53f5-4b0a-9759-0076959af74e';
