-- Run in Supabase SQL Editor (project szfgdruhlebfvcmlvxdk) if auto-migrate failed.
-- Fixes Content Plan carousel scheduling error "db" / media_type_check.

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
