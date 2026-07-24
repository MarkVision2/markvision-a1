
-- Explicit public SELECT policy for the public creative-posters bucket
DROP POLICY IF EXISTS "Public can read creative posters" ON storage.objects;
CREATE POLICY "Public can read creative posters"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'creative-posters');

-- Admin-only policies for the private database export bucket
DROP POLICY IF EXISTS "Admins can read database exports" ON storage.objects;
CREATE POLICY "Admins can read database exports"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'database_export_06_07_26' AND has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can upload database exports" ON storage.objects;
CREATE POLICY "Admins can upload database exports"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'database_export_06_07_26' AND has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can update database exports" ON storage.objects;
CREATE POLICY "Admins can update database exports"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'database_export_06_07_26' AND has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'database_export_06_07_26' AND has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can delete database exports" ON storage.objects;
CREATE POLICY "Admins can delete database exports"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'database_export_06_07_26' AND has_role(auth.uid(), 'admin'::app_role));
