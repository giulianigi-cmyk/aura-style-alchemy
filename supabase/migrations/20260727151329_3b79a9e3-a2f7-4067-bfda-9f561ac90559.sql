CREATE OR REPLACE FUNCTION public.can_read_shared_canvas(_object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.outfit_shares s
    JOIN public.outfits o ON o.id = s.outfit_id
    WHERE s.shared_with = auth.uid()
      AND o.canvas_image_url = _object_name
      AND public.are_friends(s.shared_by, s.shared_with)
  )
$$;
REVOKE ALL ON FUNCTION public.can_read_shared_canvas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_shared_canvas(text) TO authenticated;

DROP POLICY IF EXISTS "outfits shared-with read" ON storage.objects;
CREATE POLICY "outfits shared-with read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'outfits' AND public.can_read_shared_canvas(name));
