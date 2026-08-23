-- Estende le notifiche chat anche ai messaggi di testo (prima solo outfit_share)
CREATE OR REPLACE FUNCTION public.notify_outfit_share()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.content_type = 'outfit_share' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT cp.user_id, 'outfit_share', 'Nuovo outfit condiviso', 'Hai ricevuto un outfit in chat',
           jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'sender_id', new.sender_id)
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = new.conversation_id
      AND cp.user_id <> new.sender_id
      AND cp.left_at IS NULL;
  ELSIF new.content_type = 'text' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT cp.user_id, 'chat_message', 'Nuovo messaggio', left(new.body, 120),
           jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'sender_id', new.sender_id)
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = new.conversation_id
      AND cp.user_id <> new.sender_id
      AND cp.left_at IS NULL;
  END IF;
  RETURN new;
END;
$$;
