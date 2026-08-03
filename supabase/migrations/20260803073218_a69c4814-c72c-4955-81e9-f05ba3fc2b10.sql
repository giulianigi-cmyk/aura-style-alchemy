-- 1. feedback_weights: internal config, service-role only
DROP POLICY IF EXISTS "feedback_weights readable" ON public.feedback_weights;
DROP POLICY IF EXISTS "feedback_weights select" ON public.feedback_weights;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='feedback_weights' LOOP
    EXECUTE format('DROP POLICY %I ON public.feedback_weights', p.policyname);
  END LOOP;
END $$;
REVOKE ALL ON public.feedback_weights FROM anon, authenticated;
GRANT ALL ON public.feedback_weights TO service_role;

-- 2. Revoke execute from anon on all public functions
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
  END LOOP;
END $$;

-- 3. Internal worker-only SECURITY DEFINER routines: service_role only
REVOKE ALL ON FUNCTION public.claim_pending_feedback(integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.claim_scan_jobs(integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.upsert_style_memory(uuid, text, text, numeric, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_feedback(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_scan_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_style_memory(uuid, text, text, numeric, text, text, integer) TO service_role;

-- 4. Re-grant the routines the signed-in app legitimately needs
GRANT EXECUTE ON FUNCTION public.are_friends(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_share(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_shared_canvas(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_share_comments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_feed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_friendships() TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_profiles(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unfriend(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.effective_style_confidence(numeric, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.are_friends(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_access_share(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_read_shared_canvas(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;