-- Контент-завод (Clony): галерея + шаблоны бренда
-- Проект: szfgdruhlebfvcmlvxdk
-- project_id — UUID проекта MarkVision (без FK, таблицы projects здесь нет)
--
-- НЕ запускайте 006 повторно, если content_factory_results уже есть.
-- Ошибка 42710 "already member of publication supabase_realtime" — нормальна, пропустите.

-- ============================================================
-- 1. Галерея готового контента
-- ============================================================
CREATE TABLE IF NOT EXISTS public.content_factory_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  created_by text,
  request_id text,
  session_id text,
  type_id text,
  type_title text,
  style_id text,
  style_label text,
  image_url text NOT NULL,
  prompt_snapshot text,
  brand_template_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cfgallery_project_request
  ON public.content_factory_gallery (project_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cfgallery_project_created
  ON public.content_factory_gallery (project_id, created_at DESC);

ALTER TABLE public.content_factory_gallery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfgallery_select ON public.content_factory_gallery;
CREATE POLICY cfgallery_select ON public.content_factory_gallery
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS cfgallery_insert ON public.content_factory_gallery;
CREATE POLICY cfgallery_insert ON public.content_factory_gallery
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS cfgallery_delete ON public.content_factory_gallery;
CREATE POLICY cfgallery_delete ON public.content_factory_gallery
  FOR DELETE TO anon, authenticated
  USING (true);

-- ============================================================
-- 2. Шаблоны бренда
-- ============================================================
CREATE TABLE IF NOT EXISTS public.content_factory_brand_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  created_by text,
  name text NOT NULL,
  description text,
  colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  fonts jsonb NOT NULL DEFAULT '{}'::jsonb,
  tone text,
  style_notes text,
  prompt_addon text,
  logo_url text,
  reference_urls text[] NOT NULL DEFAULT '{}',
  brandbook_urls text[] NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfbrand_project
  ON public.content_factory_brand_templates (project_id, updated_at DESC);

ALTER TABLE public.content_factory_brand_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfbrand_select ON public.content_factory_brand_templates;
CREATE POLICY cfbrand_select ON public.content_factory_brand_templates
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS cfbrand_insert ON public.content_factory_brand_templates;
CREATE POLICY cfbrand_insert ON public.content_factory_brand_templates
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS cfbrand_update ON public.content_factory_brand_templates;
CREATE POLICY cfbrand_update ON public.content_factory_brand_templates
  FOR UPDATE TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS cfbrand_delete ON public.content_factory_brand_templates;
CREATE POLICY cfbrand_delete ON public.content_factory_brand_templates
  FOR DELETE TO anon, authenticated
  USING (true);

ALTER TABLE public.content_factory_gallery
  DROP CONSTRAINT IF EXISTS content_factory_gallery_brand_template_id_fkey;
ALTER TABLE public.content_factory_gallery
  ADD CONSTRAINT content_factory_gallery_brand_template_id_fkey
  FOREIGN KEY (brand_template_id)
  REFERENCES public.content_factory_brand_templates(id)
  ON DELETE SET NULL;

-- ============================================================
-- 3. Storage buckets
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('content-factory', 'content-factory', true),
  ('content-factory-uploads', 'content-factory-uploads', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "content-factory public read" ON storage.objects;
CREATE POLICY "content-factory public read"
ON storage.objects FOR SELECT
USING (bucket_id IN ('content-factory', 'content-factory-uploads'));

DROP POLICY IF EXISTS "content-factory anon insert" ON storage.objects;
CREATE POLICY "content-factory anon insert"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id IN ('content-factory', 'content-factory-uploads'));

DROP POLICY IF EXISTS "content-factory anon update" ON storage.objects;
CREATE POLICY "content-factory anon update"
ON storage.objects FOR UPDATE TO anon, authenticated
USING (bucket_id IN ('content-factory', 'content-factory-uploads'));

DROP POLICY IF EXISTS "content-factory anon delete" ON storage.objects;
CREATE POLICY "content-factory anon delete"
ON storage.objects FOR DELETE TO anon, authenticated
USING (bucket_id IN ('content-factory', 'content-factory-uploads'));

-- Realtime для галереи (опционально)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.content_factory_gallery;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
