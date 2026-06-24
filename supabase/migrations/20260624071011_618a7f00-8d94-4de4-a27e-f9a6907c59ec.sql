DROP POLICY IF EXISTS "Users can upload own wardrobe images" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own wardrobe images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own wardrobe images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own wardrobe images" ON storage.objects;

CREATE POLICY "Users can upload own wardrobe images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'wardrobe'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can read own wardrobe images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'wardrobe'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update own wardrobe images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'wardrobe'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'wardrobe'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete own wardrobe images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'wardrobe'
  AND auth.uid()::text = (storage.foldername(name))[1]
);