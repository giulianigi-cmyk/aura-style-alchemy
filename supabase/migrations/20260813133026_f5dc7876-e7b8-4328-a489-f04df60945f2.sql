ALTER TABLE public.shared_library_items
  ADD COLUMN IF NOT EXISTS source_image_path text;

REVOKE SELECT (source_image_path) ON public.shared_library_items FROM authenticated;