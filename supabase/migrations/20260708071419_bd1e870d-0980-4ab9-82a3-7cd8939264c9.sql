
-- Extend outfits table
ALTER TABLE public.outfits
  ADD COLUMN IF NOT EXISTS canvas_image_url text,
  ADD COLUMN IF NOT EXISTS occasion text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS season text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notes text;

-- Storage policies for the private "outfits" bucket: owner-scoped by first path segment (uid)
CREATE POLICY "outfits owner select"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'outfits' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "outfits owner insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'outfits' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "outfits owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'outfits' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "outfits owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'outfits' AND auth.uid()::text = (storage.foldername(name))[1]);
