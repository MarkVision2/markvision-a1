-- Allow CAROUSEL and STORIES in cf_scheduled_posts (was IMAGE/REELS only).
-- Without this, Content Plan / Autopost create returns opaque error "db"
-- (check constraint cf_scheduled_posts_media_type_check).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cf_scheduled_posts_media_type_check'
      AND conrelid = 'public.cf_scheduled_posts'::regclass
  ) THEN
    ALTER TABLE public.cf_scheduled_posts
      DROP CONSTRAINT cf_scheduled_posts_media_type_check;
  END IF;
END $$;

ALTER TABLE public.cf_scheduled_posts
  ADD CONSTRAINT cf_scheduled_posts_media_type_check
  CHECK (media_type = ANY (ARRAY[
    'IMAGE'::text,
    'REELS'::text,
    'STORIES'::text,
    'CAROUSEL'::text
  ]));
