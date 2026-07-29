-- batch_scans
CREATE TABLE public.batch_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','done_with_errors')),
  total_photos integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_scans TO authenticated;
GRANT ALL ON public.batch_scans TO service_role;
ALTER TABLE public.batch_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "batch_scans owner all" ON public.batch_scans FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- scan_jobs
CREATE TABLE public.scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.batch_scans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  image_path text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','failed')),
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scan_jobs_status_created_idx ON public.scan_jobs (status, created_at);
CREATE INDEX scan_jobs_scan_id_idx ON public.scan_jobs (scan_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_jobs TO authenticated;
GRANT ALL ON public.scan_jobs TO service_role;
ALTER TABLE public.scan_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_jobs owner all" ON public.scan_jobs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- scan_detected_items
CREATE TABLE public.scan_detected_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.scan_jobs(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES public.batch_scans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  category text,
  subcategory text,
  colors text[] NOT NULL DEFAULT '{}'::text[],
  material text[] NOT NULL DEFAULT '{}'::text[],
  season text,
  description text,
  confidence numeric,
  bbox jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scan_detected_items_scan_idx ON public.scan_detected_items (scan_id);
CREATE INDEX scan_detected_items_job_idx ON public.scan_detected_items (job_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_detected_items TO authenticated;
GRANT ALL ON public.scan_detected_items TO service_role;
ALTER TABLE public.scan_detected_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_detected_items owner all" ON public.scan_detected_items FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- notifications
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_created_idx ON public.notifications (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications owner all" ON public.notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_batch_scans_updated_at BEFORE UPDATE ON public.batch_scans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_scan_jobs_updated_at BEFORE UPDATE ON public.scan_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_scan_detected_items_updated_at BEFORE UPDATE ON public.scan_detected_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- worker job claiming (service_role only)
CREATE OR REPLACE FUNCTION public.claim_scan_jobs(_limit integer)
RETURNS SETOF public.scan_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.scan_jobs j
     SET status = 'processing', claimed_at = now(), attempts = j.attempts + 1
   WHERE j.id IN (
     SELECT id FROM public.scan_jobs
      WHERE status = 'queued'
         OR (status = 'processing' AND claimed_at < now() - interval '5 minutes')
      ORDER BY created_at
      LIMIT _limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING j.*;
$$;

REVOKE ALL ON FUNCTION public.claim_scan_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scan_jobs(integer) TO service_role;