ALTER TABLE public.outfit_plans
  ADD COLUMN IF NOT EXISTS weather_precipitation_probability numeric,
  ADD COLUMN IF NOT EXISTS weather_code integer,
  ADD COLUMN IF NOT EXISTS weather_checked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS set_outfit_plans_updated_at ON public.outfit_plans;
CREATE TRIGGER set_outfit_plans_updated_at
  BEFORE UPDATE ON public.outfit_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS outfit_plans_recheck_idx
  ON public.outfit_plans (date)
  WHERE status = 'planned';

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unread';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_status_check'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_status_check
      CHECK (status IN ('unread', 'read', 'accepted', 'dismissed'));
  END IF;
END $$;

UPDATE public.notifications SET status = 'read' WHERE read_at IS NOT NULL AND status = 'unread';

CREATE INDEX IF NOT EXISTS notifications_open_weather_change_idx
  ON public.notifications (user_id, type, status)
  WHERE type = 'weather_change' AND status IN ('unread', 'read');