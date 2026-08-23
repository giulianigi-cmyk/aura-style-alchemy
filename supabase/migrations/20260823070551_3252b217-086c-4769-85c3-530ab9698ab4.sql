-- Lock the four service-role-only tables away from client roles entirely.
REVOKE ALL ON public.calendar_connections FROM anon, authenticated;
REVOKE ALL ON public.oauth_pending_connections FROM anon, authenticated;
REVOKE ALL ON public.feedback_weights FROM anon, authenticated;
REVOKE ALL ON public.scrape_domain_hints FROM anon, authenticated;

GRANT ALL ON public.calendar_connections TO service_role;
GRANT ALL ON public.oauth_pending_connections TO service_role;
GRANT ALL ON public.feedback_weights TO service_role;
GRANT ALL ON public.scrape_domain_hints TO service_role;

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_pending_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_domain_hints ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.calendar_connections IS 'Server-only: OAuth tokens. No client access by design (no grants, no policies); reached solely via the service role from server code.';
COMMENT ON TABLE public.oauth_pending_connections IS 'Server-only: transient OAuth state. No client access by design.';
COMMENT ON TABLE public.feedback_weights IS 'Server-only: tuning constants read by the style-memory aggregator.';
COMMENT ON TABLE public.scrape_domain_hints IS 'Server-only: scraper fallback hints.';

-- Username lookup must not be callable by unauthenticated visitors.
REVOKE EXECUTE ON FUNCTION public.profile_by_username(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_by_username(text) TO authenticated, service_role;