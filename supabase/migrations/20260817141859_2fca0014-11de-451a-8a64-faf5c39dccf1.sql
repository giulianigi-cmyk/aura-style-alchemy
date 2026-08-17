DO $$
DECLARE
  a uuid := 'ca68f676-2bbe-4a3e-92c8-eb1b945df163';
  b uuid := '8939f448-f268-49ef-8ece-73af4765167f';
  c1 uuid; c2 uuid; st1 text; st2 text; cs1 boolean; cs2 boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role','authenticated')::text, true);

  INSERT INTO public.friends (requester_id, addressee_id, status) VALUES (a, b, 'accepted');
  c1 := public.get_or_create_direct_conversation(b);

  PERFORM public.unfriend(b);
  SELECT status INTO st1 FROM public.conversations WHERE id = c1;
  IF st1 <> 'frozen' THEN RAISE EXCEPTION 'TEST FAIL: conversazione non congelata (status=%)', st1; END IF;
  cs1 := public.can_send_message(c1);
  IF cs1 THEN RAISE EXCEPTION 'TEST FAIL: chat congelata ancora scrivibile'; END IF;

  INSERT INTO public.friends (requester_id, addressee_id, status) VALUES (a, b, 'accepted');
  c2 := public.get_or_create_direct_conversation(b);
  IF c2 = c1 THEN RAISE EXCEPTION 'TEST FAIL: riusata la vecchia conversazione'; END IF;
  SELECT status INTO st2 FROM public.conversations WHERE id = c2;
  cs2 := public.can_send_message(c2);
  IF st2 <> 'active' OR NOT cs2 THEN RAISE EXCEPTION 'TEST FAIL: nuova conversazione non attiva/scrivibile'; END IF;
  IF EXISTS (SELECT 1 FROM public.messages WHERE conversation_id = c2) THEN RAISE EXCEPTION 'TEST FAIL: nuova conversazione non vuota'; END IF;

  RAISE NOTICE 'TEST OK: c1=% (%) frozen, c2=% (%) active', c1, st1, c2, st2;

  DELETE FROM public.messages WHERE conversation_id IN (c1, c2);
  DELETE FROM public.conversation_participants WHERE conversation_id IN (c1, c2);
  DELETE FROM public.conversations WHERE id IN (c1, c2);
  DELETE FROM public.friends WHERE (requester_id = a AND addressee_id = b) OR (requester_id = b AND addressee_id = a);
END $$;