CREATE OR REPLACE FUNCTION public.can_read_shared_canvas(_object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.outfit_shares s
    JOIN public.outfits o ON o.id = s.outfit_id
    WHERE s.shared_with = auth.uid()
      AND o.canvas_image_url = _object_name
      AND public.are_friends(s.shared_by, s.shared_with)
  )
  OR EXISTS (
    SELECT 1
    FROM public.message_references r
    JOIN public.messages m ON m.id = r.message_id
    JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id
    WHERE cp.user_id = auth.uid()
      AND cp.left_at IS NULL
      AND m.created_at >= cp.joined_at
      AND r.snapshot_image_url = _object_name
  )
$function$;

CREATE OR REPLACE FUNCTION public.unfriend(_other uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _key text;
BEGIN
  IF _me IS NULL OR _other IS NULL OR _me = _other THEN RETURN; END IF;
  DELETE FROM public.friends f
   WHERE (f.requester_id = _me AND f.addressee_id = _other)
      OR (f.requester_id = _other AND f.addressee_id = _me);
  DELETE FROM public.outfit_shares s
   WHERE (s.shared_by = _me AND s.shared_with = _other)
      OR (s.shared_by = _other AND s.shared_with = _me);

  _key := least(_me, _other)::text || '_' || greatest(_me, _other)::text;
  UPDATE public.conversations
     SET status = 'frozen'
   WHERE canonical_key = _key
     AND status = 'active';
END;
$function$;