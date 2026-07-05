
CREATE TABLE public.outfit_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  date date NOT NULL,
  item_ids text[] NOT NULL DEFAULT '{}',
  occasion text,
  notes text,
  weather_temp numeric,
  weather_condition text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outfit_plans TO authenticated;
GRANT ALL ON public.outfit_plans TO service_role;

ALTER TABLE public.outfit_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own outfit plans" ON public.outfit_plans
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own outfit plans" ON public.outfit_plans
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own outfit plans" ON public.outfit_plans
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own outfit plans" ON public.outfit_plans
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX outfit_plans_user_date_idx ON public.outfit_plans(user_id, date);

ALTER TABLE public.wardrobe_items
  ADD COLUMN IF NOT EXISTS worn_count integer NOT NULL DEFAULT 0;
