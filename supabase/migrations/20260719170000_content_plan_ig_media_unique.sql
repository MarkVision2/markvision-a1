-- Контент-план: один IG media_id = одна строка плана (ручная публикация и автопост).
CREATE UNIQUE INDEX IF NOT EXISTS content_plan_items_project_ig_media_uidx
  ON public.content_plan_items (project_id, ig_media_id)
  WHERE ig_media_id IS NOT NULL AND length(btrim(ig_media_id)) > 0;
