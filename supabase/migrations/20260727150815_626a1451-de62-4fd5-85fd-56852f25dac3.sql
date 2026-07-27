-- 1. username on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$');

-- 2. friends
CREATE TABLE public.friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friends_unique_pair UNIQUE (requester_id, addressee_id),
  CONSTRAINT friends_not_self CHECK (requester_id <> addressee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friends TO authenticated;
GRANT ALL ON public.friends TO service_role;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friends select own" ON public.friends FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());
CREATE POLICY "friends insert as requester" ON public.friends FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid() AND requester_id <> addressee_id);
CREATE POLICY "friends addressee accepts" ON public.friends FOR UPDATE TO authenticated
  USING (addressee_id = auth.uid() AND status = 'pending')
  WITH CHECK (addressee_id = auth.uid() AND status = 'accepted');
CREATE POLICY "friends delete own" ON public.friends FOR DELETE TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

CREATE INDEX friends_addressee_idx ON public.friends (addressee_id, status);
CREATE INDEX friends_requester_idx ON public.friends (requester_id, status);

-- helper: accepted friendship check
CREATE OR REPLACE FUNCTION public.are_friends(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friends f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = _a AND f.addressee_id = _b)
        OR (f.requester_id = _b AND f.addressee_id = _a))
  )
$$;
REVOKE ALL ON FUNCTION public.are_friends(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.are_friends(uuid, uuid) TO authenticated;

-- 3. outfit_shares
CREATE TABLE public.outfit_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id uuid NOT NULL REFERENCES public.outfits(id) ON DELETE CASCADE,
  shared_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_with uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outfit_shares_unique UNIQUE (outfit_id, shared_with),
  CONSTRAINT outfit_shares_not_self CHECK (shared_by <> shared_with)
);
GRANT SELECT, INSERT, DELETE ON public.outfit_shares TO authenticated;
GRANT ALL ON public.outfit_shares TO service_role;
ALTER TABLE public.outfit_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shares select participant" ON public.outfit_shares FOR SELECT TO authenticated
  USING (shared_by = auth.uid() OR shared_with = auth.uid());
CREATE POLICY "shares insert own outfit to friend" ON public.outfit_shares FOR INSERT TO authenticated
  WITH CHECK (
    shared_by = auth.uid()
    AND shared_by <> shared_with
    AND EXISTS (SELECT 1 FROM public.outfits o WHERE o.id = outfit_id AND o.user_id = auth.uid())
    AND public.are_friends(auth.uid(), shared_with)
  );
CREATE POLICY "shares delete by owner" ON public.outfit_shares FOR DELETE TO authenticated
  USING (shared_by = auth.uid());

CREATE INDEX outfit_shares_with_idx ON public.outfit_shares (shared_with, created_at DESC);
CREATE INDEX outfit_shares_by_idx ON public.outfit_shares (shared_by, created_at DESC);

-- helper: participant in a share AND still friends
CREATE OR REPLACE FUNCTION public.can_access_share(_share_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.outfit_shares s
    WHERE s.id = _share_id
      AND (s.shared_by = auth.uid() OR s.shared_with = auth.uid())
      AND public.are_friends(s.shared_by, s.shared_with)
  )
$$;
REVOKE ALL ON FUNCTION public.can_access_share(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_share(uuid) TO authenticated;

-- 4. outfit_comments
CREATE TABLE public.outfit_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.outfit_shares(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.outfit_comments TO authenticated;
GRANT ALL ON public.outfit_comments TO service_role;
ALTER TABLE public.outfit_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments select participant" ON public.outfit_comments FOR SELECT TO authenticated
  USING (public.can_access_share(share_id));
CREATE POLICY "comments insert participant" ON public.outfit_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access_share(share_id));
CREATE POLICY "comments delete own" ON public.outfit_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE INDEX outfit_comments_share_idx ON public.outfit_comments (share_id, created_at);

-- 5. outfit_likes
CREATE TABLE public.outfit_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.outfit_shares(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outfit_likes_unique UNIQUE (share_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.outfit_likes TO authenticated;
GRANT ALL ON public.outfit_likes TO service_role;
ALTER TABLE public.outfit_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "likes select participant" ON public.outfit_likes FOR SELECT TO authenticated
  USING (public.can_access_share(share_id));
CREATE POLICY "likes insert participant" ON public.outfit_likes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access_share(share_id));
CREATE POLICY "likes delete own" ON public.outfit_likes FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE INDEX outfit_likes_share_idx ON public.outfit_likes (share_id);

-- 6. scoped read RPCs (profiles RLS stays owner-only)
CREATE OR REPLACE FUNCTION public.search_profiles(_q text)
RETURNS TABLE (id uuid, username text, profile_image text, relation text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.username, p.profile_image,
    CASE
      WHEN public.are_friends(auth.uid(), p.id) THEN 'friends'
      WHEN EXISTS (SELECT 1 FROM public.friends f WHERE f.requester_id = auth.uid() AND f.addressee_id = p.id) THEN 'outgoing'
      WHEN EXISTS (SELECT 1 FROM public.friends f WHERE f.addressee_id = auth.uid() AND f.requester_id = p.id) THEN 'incoming'
      ELSE 'none'
    END AS relation
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.username IS NOT NULL
    AND p.id <> auth.uid()
    AND length(btrim(_q)) >= 2
    AND p.username LIKE lower(btrim(_q)) || '%'
  ORDER BY p.username
  LIMIT 20
$$;
REVOKE ALL ON FUNCTION public.search_profiles(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_profiles(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.username_available(_username text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND _username ~ '^[a-z0-9_]{3,20}$'
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.username = _username AND p.id <> auth.uid())
$$;
REVOKE ALL ON FUNCTION public.username_available(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_friendships()
RETURNS TABLE (
  friendship_id uuid, other_id uuid, username text, profile_image text,
  status text, direction text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id,
    CASE WHEN f.requester_id = auth.uid() THEN f.addressee_id ELSE f.requester_id END,
    p.username, p.profile_image, f.status,
    CASE WHEN f.requester_id = auth.uid() THEN 'outgoing' ELSE 'incoming' END,
    f.created_at
  FROM public.friends f
  JOIN public.profiles p
    ON p.id = CASE WHEN f.requester_id = auth.uid() THEN f.addressee_id ELSE f.requester_id END
  WHERE auth.uid() IS NOT NULL
    AND (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())
  ORDER BY f.created_at DESC
$$;
REVOKE ALL ON FUNCTION public.list_friendships() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_friendships() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_shared_feed()
RETURNS TABLE (
  share_id uuid, outfit_id uuid, shared_by uuid, shared_with uuid,
  created_at timestamptz, direction text,
  outfit_name text, canvas_image_url text,
  other_username text, other_profile_image text,
  like_count bigint, comment_count bigint, liked_by_me boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.outfit_id, s.shared_by, s.shared_with, s.created_at,
    CASE WHEN s.shared_by = auth.uid() THEN 'outgoing' ELSE 'incoming' END,
    o.name, o.canvas_image_url,
    p.username, p.profile_image,
    (SELECT count(*) FROM public.outfit_likes l WHERE l.share_id = s.id),
    (SELECT count(*) FROM public.outfit_comments c WHERE c.share_id = s.id),
    EXISTS (SELECT 1 FROM public.outfit_likes l2 WHERE l2.share_id = s.id AND l2.user_id = auth.uid())
  FROM public.outfit_shares s
  JOIN public.outfits o ON o.id = s.outfit_id
  JOIN public.profiles p
    ON p.id = CASE WHEN s.shared_by = auth.uid() THEN s.shared_with ELSE s.shared_by END
  WHERE auth.uid() IS NOT NULL
    AND (s.shared_by = auth.uid() OR s.shared_with = auth.uid())
    AND public.are_friends(s.shared_by, s.shared_with)
  ORDER BY s.created_at DESC
  LIMIT 100
$$;
REVOKE ALL ON FUNCTION public.get_shared_feed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shared_feed() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_share_comments(_share_id uuid)
RETURNS TABLE (id uuid, user_id uuid, username text, profile_image text, body text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.user_id, p.username, p.profile_image, c.body, c.created_at
  FROM public.outfit_comments c
  JOIN public.profiles p ON p.id = c.user_id
  WHERE c.share_id = _share_id
    AND public.can_access_share(_share_id)
  ORDER BY c.created_at
$$;
REVOKE ALL ON FUNCTION public.get_share_comments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_share_comments(uuid) TO authenticated;

-- unfriend: removes friendship + revokes shares in both directions
CREATE OR REPLACE FUNCTION public.unfriend(_other uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL OR _other IS NULL OR _me = _other THEN RETURN; END IF;
  DELETE FROM public.friends f
   WHERE (f.requester_id = _me AND f.addressee_id = _other)
      OR (f.requester_id = _other AND f.addressee_id = _me);
  DELETE FROM public.outfit_shares s
   WHERE (s.shared_by = _me AND s.shared_with = _other)
      OR (s.shared_by = _other AND s.shared_with = _me);
END;
$$;
REVOKE ALL ON FUNCTION public.unfriend(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unfriend(uuid) TO authenticated;

-- 7. storage: friend may read ONLY the exact outfit canvas explicitly shared with them
CREATE POLICY "outfits shared-with read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'outfits'
  AND EXISTS (
    SELECT 1
    FROM public.outfit_shares s
    JOIN public.outfits o ON o.id = s.outfit_id
    WHERE s.shared_with = auth.uid()
      AND o.canvas_image_url = storage.objects.name
      AND public.are_friends(s.shared_by, s.shared_with)
  )
);

-- friend profile photos (accepted friends only)
CREATE POLICY "avatars friend read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'avatars'
  AND public.are_friends(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
