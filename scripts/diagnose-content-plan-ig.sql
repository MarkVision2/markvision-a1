SELECT im.project_id,
  count(*) AS media_n,
  min(im.timestamp) AS first_ts,
  max(im.timestamp) AS last_ts
FROM instagram_media im
GROUP BY 1
ORDER BY media_n DESC
LIMIT 10;

SELECT project_id, media_id, left(coalesce(caption,''),40) AS cap, media_type, timestamp
FROM instagram_media
ORDER BY timestamp DESC NULLS LAST
LIMIT 50;

SELECT project_id, left(title,40) AS title, status, ig_media_id IS NOT NULL AS has_ig,
  published_at, scheduled_at, created_at
FROM content_plan_items
ORDER BY COALESCE(published_at, scheduled_at, created_at) DESC NULLS LAST
LIMIT 50;

SELECT im.project_id, im.media_id, left(coalesce(im.caption,''),40) AS cap, im.timestamp
FROM instagram_media im
WHERE NOT EXISTS (
  SELECT 1 FROM content_plan_items p
  WHERE p.project_id = im.project_id AND p.ig_media_id = im.media_id
)
ORDER BY im.timestamp DESC NULLS LAST
LIMIT 50;

SELECT
  (SELECT count(*) FROM instagram_media) AS all_media,
  (SELECT count(*) FROM content_plan_items) AS all_plan,
  (SELECT count(*) FROM content_plan_items WHERE ig_media_id IS NOT NULL) AS plan_linked,
  (SELECT count(*) FROM content_plan_items WHERE status = 'published') AS plan_published;
