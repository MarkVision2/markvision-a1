-- thumb_offset_ms: позиция кадра обложки Reels (мс) для Instagram Graph thumb_offset.
ALTER TABLE public.cf_scheduled_posts
  ADD COLUMN IF NOT EXISTS thumb_offset_ms integer;

COMMENT ON COLUMN public.cf_scheduled_posts.thumb_offset_ms IS
  'Reels cover frame offset in milliseconds for Instagram Graph API thumb_offset';
