-- 1. Column for high-quality poster URL
ALTER TABLE public.meta_creatives
  ADD COLUMN IF NOT EXISTS poster_url text;

-- 2. Public bucket for creative posters
INSERT INTO storage.buckets (id, name, public)
VALUES ('creative-posters', 'creative-posters', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Storage policies
DROP POLICY IF EXISTS "Creative posters are publicly readable" ON storage.objects;
CREATE POLICY "Creative posters are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'creative-posters');

DROP POLICY IF EXISTS "Authed can upload creative posters" ON storage.objects;
CREATE POLICY "Authed can upload creative posters"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'creative-posters');

DROP POLICY IF EXISTS "Authed can update creative posters" ON storage.objects;
CREATE POLICY "Authed can update creative posters"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'creative-posters');