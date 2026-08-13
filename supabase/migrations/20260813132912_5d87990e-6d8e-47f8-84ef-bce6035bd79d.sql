ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS share_wardrobe_to_library boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.shared_library_owner_hash(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _key text;
BEGIN
  SELECT decrypted_secret INTO _key
  FROM vault.decrypted_secrets
  WHERE name = 'shared_library_hmac_key';

  IF _key IS NULL THEN
    RAISE EXCEPTION 'shared_library_hmac_key missing from Vault';
  END IF;

  RETURN encode(extensions.hmac(_user_id::text, _key, 'sha256'), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION public.shared_library_owner_hash(uuid) FROM public;
REVOKE ALL ON FUNCTION public.shared_library_owner_hash(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.shared_library_owner_hash(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.shared_library_owner_hash(uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.shared_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_hash text NOT NULL,
  source_item_id uuid NOT NULL,
  image_url text NOT NULL,
  thumbnail_path text,
  category text,
  subcategory text,
  brand text,
  color text,
  colors text[] NOT NULL DEFAULT '{}',
  material text[] NOT NULL DEFAULT '{}',
  season text,
  style text,
  occasion text,
  style_tags text[] NOT NULL DEFAULT '{}',
  size text,
  price numeric,
  currency text,
  gender text,
  length text,
  sleeve_length text,
  fit text,
  heel_height text,
  toe_shape text,
  closure text,
  formality smallint,
  day_evening text,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_hash, source_item_id)
);

GRANT SELECT ON public.shared_library_items TO authenticated;
GRANT ALL ON public.shared_library_items TO service_role;

ALTER TABLE public.shared_library_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read shared library" ON public.shared_library_items;
CREATE POLICY "Authenticated can read shared library"
  ON public.shared_library_items
  FOR SELECT TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS shared_library_items_owner_hash_idx ON public.shared_library_items (owner_hash);
CREATE INDEX IF NOT EXISTS shared_library_items_brand_idx ON public.shared_library_items (lower(brand));
CREATE INDEX IF NOT EXISTS shared_library_items_category_idx ON public.shared_library_items (category);

DROP TRIGGER IF EXISTS shared_library_items_updated_at ON public.shared_library_items;
CREATE TRIGGER shared_library_items_updated_at
  BEFORE UPDATE ON public.shared_library_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Authenticated can read shared library images"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'shared-library');
