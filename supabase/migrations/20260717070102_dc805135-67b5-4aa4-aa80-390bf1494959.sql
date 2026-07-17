ALTER TABLE public.wardrobe_items DROP COLUMN IF EXISTS material;
ALTER TABLE public.wardrobe_items ADD COLUMN material TEXT[] NOT NULL DEFAULT '{}';