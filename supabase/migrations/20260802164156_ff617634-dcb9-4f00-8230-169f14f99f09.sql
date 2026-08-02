CREATE OR REPLACE FUNCTION public.effective_style_confidence(_confidence numeric, _last_seen timestamp with time zone)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _confidence IS NULL OR _last_seen IS NULL THEN NULL
    ELSE ROUND((_confidence * exp(-1 * GREATEST(EXTRACT(EPOCH FROM (now() - _last_seen)), 0) / (86400 * 180)))::numeric, 6)
  END
$function$;