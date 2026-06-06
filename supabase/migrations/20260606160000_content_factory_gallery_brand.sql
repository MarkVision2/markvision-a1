-- Контент-завод: галерея готовых креативов + шаблоны брендбука (по project_id).

-- ============================================================
-- 1. Готовый контент (галерея)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.content_factory_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_cfgallery_project_created
  ON public.content_factory_gallery (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cfgallery_request_id
  ON public.content_factory_gallery (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.content_factory_gallery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfgallery_select ON public.content_factory_gallery;
CREATE POLICY cfgallery_select ON public.content_factory_gallery
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.user_can_access_project(project_id)
  );

DROP POLICY IF EXISTS cfgallery_insert ON public.content_factory_gallery;
CREATE POLICY cfgallery_insert ON public.content_factory_gallery
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.user_can_access_project(project_id)
  );

DROP POLICY IF EXISTS cfgallery_delete ON public.content_factory_gallery;
CREATE POLICY cfgallery_delete ON public.content_factory_gallery
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.user_can_access_project(project_id)
  );

-- ============================================================
-- 2. Шаблоны брендбука
-- ============================================================
CREATE TABLE IF NOT EXISTS public.content_factory_brand_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
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
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.user_can_access_project(project_id)
  );

DROP POLICY IF EXISTS cfbrand_insert ON public.content_factory_brand_templates;
CREATE POLICY cfbrand_insert ON public.content_factory_brand_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.user_can_access_project(project_id)
  );

DROP POLICY IF EXISTS cfbrand_update ON public.content_factory_brand_templates;
CREATE POLICY cfbrand_update ON public.content_factory_brand_templates
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.user_can_access_project(project_id)
  );

DROP POLICY IF EXISTS cfbrand_delete ON public.content_factory_brand_templates;
CREATE POLICY cfbrand_delete ON public.content_factory_brand_templates
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.user_can_access_project(project_id)
  );

ALTER TABLE public.content_factory_gallery
  DROP CONSTRAINT IF EXISTS content_factory_gallery_brand_template_id_fkey;
ALTER TABLE public.content_factory_gallery
  ADD CONSTRAINT content_factory_gallery_brand_template_id_fkey
  FOREIGN KEY (brand_template_id)
  REFERENCES public.content_factory_brand_templates(id)
  ON DELETE SET NULL;

DROP TRIGGER IF EXISTS update_cfbrand_updated_at ON public.content_factory_brand_templates;
CREATE TRIGGER update_cfbrand_updated_at
  BEFORE UPDATE ON public.content_factory_brand_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. Storage: content-factory (логотипы, референсы, брендбуки)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('content-factory', 'content-factory', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "content-factory public read" ON storage.objects;
CREATE POLICY "content-factory public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'content-factory');

DROP POLICY IF EXISTS "content-factory authed insert" ON storage.objects;
CREATE POLICY "content-factory authed insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'content-factory');

DROP POLICY IF EXISTS "content-factory authed update" ON storage.objects;
CREATE POLICY "content-factory authed update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'content-factory');

DROP POLICY IF EXISTS "content-factory authed delete" ON storage.objects;
CREATE POLICY "content-factory authed delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'content-factory');
