CREATE OR REPLACE FUNCTION public.profile_by_username(_username text)
RETURNS TABLE(id uuid, username text, profile_image text, relation text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.username, p.profile_image,
    CASE
      WHEN auth.uid() IS NULL THEN 'anon'
      WHEN p.id = auth.uid() THEN 'self'
      WHEN public.are_friends(auth.uid(), p.id) THEN 'friends'
      WHEN EXISTS (SELECT 1 FROM public.friends f WHERE f.requester_id = auth.uid() AND f.addressee_id = p.id) THEN 'outgoing'
      WHEN EXISTS (SELECT 1 FROM public.friends f WHERE f.addressee_id = auth.uid() AND f.requester_id = p.id) THEN 'incoming'
      ELSE 'none'
    END AS relation
  FROM public.profiles p
  WHERE p.username IS NOT NULL
    AND p.username = lower(btrim(_username))
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.profile_by_username(text) FROM public;
GRANT EXECUTE ON FUNCTION public.profile_by_username(text) TO anon, authenticated, service_role;