ALTER TABLE public.outfit_plans
  ADD COLUMN IF NOT EXISTS trip_activity_id uuid REFERENCES public.trip_day_activities(id) ON DELETE CASCADE;

-- Backfill: attach each existing trip plan to the earliest matching activity
WITH ranked AS (
  SELECT a.id AS activity_id, a.trip_id, a.activity_date,
         COALESCE(a.day_segment,'day') AS seg,
         row_number() OVER (PARTITION BY a.trip_id, a.activity_date, COALESCE(a.day_segment,'day') ORDER BY a.created_at, a.id) AS rn
  FROM public.trip_day_activities a
)
UPDATE public.outfit_plans p
SET trip_activity_id = r.activity_id
FROM ranked r
WHERE p.trip_id IS NOT NULL
  AND p.trip_activity_id IS NULL
  AND r.rn = 1
  AND r.trip_id = p.trip_id
  AND r.activity_date = p.date
  AND r.seg = COALESCE(p.day_segment,'day');

ALTER TABLE public.outfit_plans DROP CONSTRAINT IF EXISTS outfit_plans_one_per_trip_segment;
DROP INDEX IF EXISTS public.outfit_plans_one_per_trip_segment;

CREATE UNIQUE INDEX IF NOT EXISTS outfit_plans_one_per_trip_activity
  ON public.outfit_plans (trip_activity_id)
  WHERE trip_activity_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_outfit_plan_trip_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.trip_activity_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.trip_day_activities a
      JOIN public.trips t ON t.id = a.trip_id
      WHERE a.id = NEW.trip_activity_id
        AND t.user_id = NEW.user_id
        AND (NEW.trip_id IS NULL OR a.trip_id = NEW.trip_id)
    ) THEN
      RAISE EXCEPTION 'trip_activity_id does not belong to this user''s trip';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_outfit_plan_trip_activity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_outfit_plan_trip_activity ON public.outfit_plans;
CREATE TRIGGER trg_validate_outfit_plan_trip_activity
BEFORE INSERT OR UPDATE OF trip_activity_id ON public.outfit_plans
FOR EACH ROW EXECUTE FUNCTION public.validate_outfit_plan_trip_activity();