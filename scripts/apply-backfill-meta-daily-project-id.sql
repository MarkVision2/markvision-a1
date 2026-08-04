-- Apply on prod szfgdruhlebfvcmlvxdk (SQL Editor or psql).
-- Fixes creatives showing 0 spend/leads when daily rows have null project_id.

UPDATE public.meta_creative_daily d
SET project_id = c.project_id
FROM public.meta_creatives c
WHERE d.ad_id = c.ad_id
  AND d.project_id IS NULL
  AND c.project_id IS NOT NULL;

UPDATE public.meta_campaign_daily d
SET project_id = c.project_id
FROM public.meta_campaigns c
WHERE d.campaign_id = c.campaign_id
  AND d.project_id IS NULL
  AND c.project_id IS NOT NULL;
