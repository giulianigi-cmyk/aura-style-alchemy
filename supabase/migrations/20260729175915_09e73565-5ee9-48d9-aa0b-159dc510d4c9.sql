REVOKE EXECUTE ON FUNCTION public.are_friends(uuid, uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.can_access_share(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.can_read_shared_canvas(text) FROM anon, authenticated, public;