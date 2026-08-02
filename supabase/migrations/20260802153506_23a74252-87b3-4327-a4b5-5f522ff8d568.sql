-- 1. outfit_sessions
CREATE TABLE public.outfit_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  occasion text,
  context jsonb,
  shown_outfit_ids uuid[],
  shown_item_ids uuid[],
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outfit_sessions TO authenticated;
GRANT ALL ON public.outfit_sessions TO service_role;
ALTER TABLE public.outfit_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outfit_sessions owner all" ON public.outfit_sessions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_outfit_sessions_user_created ON public.outfit_sessions (user_id, created_at DESC);

-- 2. outfit_feedback
CREATE TABLE public.outfit_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.outfit_sessions(id) ON DELETE SET NULL,
  outfit_id uuid REFERENCES public.outfits(id) ON DELETE SET NULL,
  item_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  feedback_type text NOT NULL CHECK (feedback_type IN ('worn','saved','liked','disliked','opened','viewed')),
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  feedback_reason text,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outfit_feedback TO authenticated;
GRANT ALL ON public.outfit_feedback TO service_role;
ALTER TABLE public.outfit_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outfit_feedback owner all" ON public.outfit_feedback FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_outfit_feedback_user_created ON public.outfit_feedback (user_id, created_at DESC);
CREATE INDEX idx_outfit_feedback_session ON public.outfit_feedback (session_id);
CREATE INDEX idx_outfit_feedback_type ON public.outfit_feedback (user_id, feedback_type);

-- 3. feedback_weights
CREATE TABLE public.feedback_weights (
  feedback_type text PRIMARY KEY,
  weight numeric NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.feedback_weights TO authenticated;
GRANT ALL ON public.feedback_weights TO service_role;
ALTER TABLE public.feedback_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feedback_weights readable" ON public.feedback_weights FOR SELECT TO authenticated USING (true);
CREATE TRIGGER update_feedback_weights_updated_at BEFORE UPDATE ON public.feedback_weights FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.feedback_weights (feedback_type, weight, notes) VALUES
  ('worn', 0.20, 'User actually wore the outfit'),
  ('saved', 0.18, 'User saved the outfit'),
  ('liked', 0.15, 'Explicit positive signal'),
  ('opened', 0.05, 'Opened outfit detail'),
  ('viewed', 0.02, 'Passive impression'),
  ('disliked', -0.15, 'Explicit negative signal');

-- 4. user_style_memory
CREATE TABLE public.user_style_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_type text NOT NULL CHECK (memory_type IN ('style_archetype','silhouette','color_preferred','color_avoided','material','brand','category','combination','avoided_combination','lifestyle_context')),
  value text NOT NULL,
  context_axis text CHECK (context_axis IN ('occasion','season','weather','time_of_day')),
  context_value text,
  confidence_score numeric NOT NULL DEFAULT 0.1 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  context_strength numeric CHECK (context_strength >= 0 AND context_strength <= 1),
  evidence_count integer NOT NULL DEFAULT 1,
  context_evidence_count integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'outfit_feedback' CHECK (source IN ('ai','user_input','wardrobe_analysis','outfit_feedback')),
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_style_memory_context_pair CHECK ((context_axis IS NULL) = (context_value IS NULL))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_style_memory TO authenticated;
GRANT ALL ON public.user_style_memory TO service_role;
ALTER TABLE public.user_style_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_style_memory owner all" ON public.user_style_memory FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE UNIQUE INDEX user_style_memory_unique_key ON public.user_style_memory (user_id, memory_type, value, COALESCE(context_axis,''), COALESCE(context_value,''));
CREATE INDEX idx_user_style_memory_user_type ON public.user_style_memory (user_id, memory_type);
CREATE TRIGGER update_user_style_memory_updated_at BEFORE UPDATE ON public.user_style_memory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. decay function
CREATE OR REPLACE FUNCTION public.effective_style_confidence(_confidence numeric, _last_seen timestamptz)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _confidence IS NULL OR _last_seen IS NULL THEN NULL
    ELSE ROUND((_confidence * exp(-1 * GREATEST(EXTRACT(EPOCH FROM (now() - _last_seen)), 0) / (86400 * 180)))::numeric, 6)
  END
$$;
GRANT EXECUTE ON FUNCTION public.effective_style_confidence(numeric, timestamptz) TO authenticated, service_role;

-- 6. active view
CREATE VIEW public.user_style_memory_active
WITH (security_invoker = true)
AS
SELECT m.id, m.user_id, m.memory_type, m.value, m.context_axis, m.context_value,
       m.confidence_score, m.context_strength, m.evidence_count, m.context_evidence_count,
       m.source, m.last_seen, m.created_at,
       public.effective_style_confidence(m.confidence_score, m.last_seen) AS effective_confidence,
       public.effective_style_confidence(m.context_strength, m.last_seen) AS effective_context_strength
FROM public.user_style_memory m
WHERE m.evidence_count >= 3
  AND public.effective_style_confidence(m.confidence_score, m.last_seen) >= 0.35
  AND (
    m.context_axis IS NULL
    OR (m.context_evidence_count >= 3
        AND public.effective_style_confidence(m.context_strength, m.last_seen) >= 0.50)
  );
GRANT SELECT ON public.user_style_memory_active TO authenticated;
GRANT ALL ON public.user_style_memory_active TO service_role;