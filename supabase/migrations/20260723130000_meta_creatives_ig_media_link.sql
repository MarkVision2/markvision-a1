-- Связка Meta Ads ↔ органический Instagram-пост для расхода в Контент-плане.
ALTER TABLE public.meta_creatives
  ADD COLUMN IF NOT EXISTS source_instagram_media_id text,
  ADD COLUMN IF NOT EXISTS effective_instagram_media_id text;

CREATE INDEX IF NOT EXISTS idx_meta_creatives_source_ig_media
  ON public.meta_creatives (project_id, source_instagram_media_id)
  WHERE source_instagram_media_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_creatives_effective_ig_media
  ON public.meta_creatives (project_id, effective_instagram_media_id)
  WHERE effective_instagram_media_id IS NOT NULL;

COMMENT ON COLUMN public.meta_creatives.source_instagram_media_id IS
  'Органический IG media id при бусте поста (source_instagram_media_id в Ad Creative).';
COMMENT ON COLUMN public.meta_creatives.effective_instagram_media_id IS
  'Фактический IG media id креатива (effective_instagram_media_id).';
