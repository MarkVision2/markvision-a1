-- Если при повторном запуске 006 была ошибка 42710 на supabase_realtime —
-- таблица content_factory_results УЖЕ в publication, ничего делать не нужно.
-- Запустите только 007_content_factory_gallery_brand.sql для галереи и брендов.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.content_factory_results;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.content_factory_gallery;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
