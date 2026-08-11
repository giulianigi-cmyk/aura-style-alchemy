DROP INDEX IF EXISTS public.outfit_plans_one_general_per_date;
DROP INDEX IF EXISTS public.outfit_plans_one_per_event;
DROP INDEX IF EXISTS public.outfit_plans_one_per_trip_segment;

ALTER TABLE public.outfit_plans
  ADD COLUMN general_date date GENERATED ALWAYS AS (
    CASE
      WHEN calendar_event_id IS NULL AND trip_id IS NULL THEN date
      ELSE NULL
    END
  ) STORED;

ALTER TABLE public.outfit_plans
  ADD CONSTRAINT outfit_plans_one_general_per_date UNIQUE (user_id, general_date),
  ADD CONSTRAINT outfit_plans_one_per_event UNIQUE (calendar_event_id),
  ADD CONSTRAINT outfit_plans_one_per_trip_segment UNIQUE (trip_id, date, day_segment);