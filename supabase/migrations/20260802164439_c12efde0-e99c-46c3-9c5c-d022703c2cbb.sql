ALTER TABLE public.outfit_feedback
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS aggregation_version integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS outfit_feedback_unprocessed_idx
  ON public.outfit_feedback (user_id, created_at)
  WHERE processed_at IS NULL;