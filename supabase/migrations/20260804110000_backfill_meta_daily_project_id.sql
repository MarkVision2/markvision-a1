-- Backfill project_id on Meta daily tables so Ads creatives can filter by project.
-- Null project_id caused period spend/leads to look like zeros in the UI.

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
