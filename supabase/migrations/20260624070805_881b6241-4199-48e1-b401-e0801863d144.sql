CREATE TABLE IF NOT EXISTS public.wardrobe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  category text,
  brand text,
  color text,
  season text,
  style text,
  occasion text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wardrobe_items TO authenticated;
GRANT ALL ON public.wardrobe_items TO service_role;

ALTER TABLE public.wardrobe_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select own wardrobe items" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Users can insert own wardrobe items" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Users can update own wardrobe items" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Users can delete own wardrobe items" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Users can view their own wardrobe items" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Users can create their own wardrobe items" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Users can edit their own wardrobe items" ON public.wardrobe_items;
DROP POLICY IF EXISTS "Users can remove their own wardrobe items" ON public.wardrobe_items;

CREATE POLICY "Users can select own wardrobe items"
ON public.wardrobe_items
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own wardrobe items"
ON public.wardrobe_items
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own wardrobe items"
ON public.wardrobe_items
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own wardrobe items"
ON public.wardrobe_items
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS wardrobe_items_user_id_created_at_idx
ON public.wardrobe_items (user_id, created_at DESC);