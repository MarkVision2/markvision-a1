-- Бэкап: все опубликованные IG-посты из instagram_media (с 2026-07-20 Алматы)
-- → content_plan_items, если ещё нет строки с тем же ig_media_id.
-- Выравнивает Контент-план с Контент-центром.
-- Supabase → SQL Editor → Run (проект szfgdruhlebfvcmlvxdk)

WITH cutoff AS (
  SELECT '2026-07-20T00:00:00+05:00'::timestamptz AS ts
),
orphans AS (
  SELECT
    im.project_id,
    im.media_id,
    im.caption,
    im.media_type,
    im.media_product_type,
    im.media_url,
    im.thumbnail_url,
    im.timestamp
  FROM public.instagram_media im
  CROSS JOIN cutoff c
  WHERE im.timestamp >= c.ts
    AND im.media_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.content_plan_items p
      WHERE p.project_id = im.project_id
        AND p.ig_media_id = im.media_id
    )
)
INSERT INTO public.content_plan_items (
  project_id,
  title,
  category,
  content_type,
  status,
  description,
  media_url,
  thumbnail_url,
  scheduled_at,
  published_at,
  ig_media_id,
  post_instagram,
  post_facebook,
  post_threads,
  post_telegram,
  post_linkedin
)
SELECT
  o.project_id,
  COALESCE(
    NULLIF(trim(split_part(COALESCE(o.caption, ''), E'\n', 1)), ''),
    CASE
      WHEN upper(COALESCE(o.media_product_type, '')) = 'REELS'
        OR upper(COALESCE(o.media_type, '')) = 'VIDEO' THEN 'REELS Instagram'
      WHEN upper(COALESCE(o.media_type, '')) = 'CAROUSEL_ALBUM' THEN 'CAROUSEL Instagram'
      WHEN upper(COALESCE(o.media_product_type, '')) = 'STORY' THEN 'STORIES Instagram'
      ELSE 'IMAGE Instagram'
    END
  ) AS title,
  'content',
  CASE
    WHEN upper(COALESCE(o.media_product_type, '')) = 'REELS'
      OR upper(COALESCE(o.media_type, '')) = 'VIDEO' THEN 'REELS'
    WHEN upper(COALESCE(o.media_type, '')) = 'CAROUSEL_ALBUM' THEN 'CAROUSEL'
    WHEN upper(COALESCE(o.media_product_type, '')) = 'STORY' THEN 'STORIES'
    ELSE 'IMAGE'
  END,
  'published',
  NULLIF(o.caption, ''),
  o.media_url,
  o.thumbnail_url,
  o.timestamp,
  o.timestamp,
  o.media_id,
  true,
  false,
  false,
  false,
  false
FROM orphans o;
