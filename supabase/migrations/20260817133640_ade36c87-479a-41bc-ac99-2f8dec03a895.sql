-- 1. USER_BLOCKS
create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
grant select, insert, delete on public.user_blocks to authenticated;
grant all on public.user_blocks to service_role;
alter table public.user_blocks enable row level security;

create policy "user_blocks_select_own" on public.user_blocks for select to authenticated using (auth.uid() = blocker_id);
create policy "user_blocks_insert_own" on public.user_blocks for insert to authenticated with check (auth.uid() = blocker_id);
create policy "user_blocks_delete_own" on public.user_blocks for delete to authenticated using (auth.uid() = blocker_id);

create or replace function public.is_blocked(_a uuid, _b uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = _a and blocked_id = _b) or (blocker_id = _b and blocked_id = _a)
  );
$$;
revoke all on function public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

-- 2. CONVERSATIONS
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  canonical_key text,
  status text not null default 'active' check (status in ('active','frozen')),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id)
);
grant select on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;

create unique index conversations_canonical_key_active_idx
  on public.conversations (canonical_key) where status = 'active';

-- 3. CONVERSATION_PARTICIPANTS
create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member','admin')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);
grant select, update(last_read_at) on public.conversation_participants to authenticated;
grant all on public.conversation_participants to service_role;
alter table public.conversation_participants enable row level security;

create or replace function public.is_participant(_conversation_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = _conversation_id and user_id = auth.uid() and left_at is null
  );
$$;
revoke all on function public.is_participant(uuid) from public, anon;
grant execute on function public.is_participant(uuid) to authenticated;

create or replace function public.active_participant_count(_conversation_id uuid)
returns integer language sql security definer set search_path = public stable as $$
  select count(*)::int from public.conversation_participants
  where conversation_id = _conversation_id and left_at is null;
$$;
revoke all on function public.active_participant_count(uuid) from public, anon;
grant execute on function public.active_participant_count(uuid) to authenticated;

create policy "conversations_select_participant" on public.conversations
  for select to authenticated using (public.is_participant(id));

create policy "participants_select_if_participant" on public.conversation_participants
  for select to authenticated using (public.is_participant(conversation_id));

create policy "participants_update_own_last_read" on public.conversation_participants
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4. MESSAGES
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  content_type text not null check (content_type in ('text','outfit_share','system')),
  body text check (char_length(body) <= 2000),
  metadata jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select, insert, update on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;

create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index conversation_participants_user_active_idx on public.conversation_participants (user_id) where left_at is null;

create or replace function public.can_send_message(_conversation_id uuid)
returns boolean language plpgsql security definer set search_path = public stable as $$
declare
  _me uuid := auth.uid();
  _other uuid;
  _count int;
  _status text;
begin
  if not public.is_participant(_conversation_id) then return false; end if;
  select status into _status from public.conversations where id = _conversation_id;
  if _status <> 'active' then return false; end if;
  _count := public.active_participant_count(_conversation_id);
  if _count = 2 then
    select user_id into _other from public.conversation_participants
    where conversation_id = _conversation_id and user_id <> _me and left_at is null;
    return public.are_friends(_me, _other) and not public.is_blocked(_me, _other);
  end if;
  return true;
end;
$$;
revoke all on function public.can_send_message(uuid) from public, anon;
grant execute on function public.can_send_message(uuid) to authenticated;

create policy "messages_select_from_joined_at" on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id
        and cp.user_id = auth.uid()
        and messages.created_at >= cp.joined_at
    )
  );

create policy "messages_insert_own" on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and content_type in ('text','outfit_share')
    and public.can_send_message(conversation_id)
  );

create policy "messages_update_own_soft_delete" on public.messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- 3b. FUNZIONI DI GESTIONE CONVERSAZIONE
create or replace function public.get_or_create_direct_conversation(_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  _me uuid := auth.uid();
  _key text;
  _conv_id uuid;
begin
  if _me is null then raise exception 'Non autenticato'; end if;
  if not public.are_friends(_me, _other) then raise exception 'Non siete amici'; end if;
  _key := least(_me, _other)::text || '_' || greatest(_me, _other)::text;
  select id into _conv_id from public.conversations where canonical_key = _key and status = 'active';
  if _conv_id is null then
    insert into public.conversations (canonical_key, created_by) values (_key, _me) returning id into _conv_id;
    insert into public.conversation_participants (conversation_id, user_id, role)
    values (_conv_id, _me, 'admin'), (_conv_id, _other, 'member');
  end if;
  return _conv_id;
end;
$$;
revoke all on function public.get_or_create_direct_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

create or replace function public.create_group_conversation(_members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  _me uuid := auth.uid();
  _conv_id uuid;
  _m uuid;
begin
  if _me is null then raise exception 'Non autenticato'; end if;
  foreach _m in array _members loop
    if not public.are_friends(_me, _m) then raise exception 'Puoi aggiungere solo amici al gruppo'; end if;
  end loop;
  insert into public.conversations (created_by) values (_me) returning id into _conv_id;
  insert into public.conversation_participants (conversation_id, user_id, role) values (_conv_id, _me, 'admin');
  insert into public.conversation_participants (conversation_id, user_id, role)
  select _conv_id, unnest(_members), 'member';
  return _conv_id;
end;
$$;
revoke all on function public.create_group_conversation(uuid[]) from public, anon;
grant execute on function public.create_group_conversation(uuid[]) to authenticated;

create or replace function public.add_group_participant(_conversation_id uuid, _new_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _me uuid := auth.uid();
begin
  if not public.is_participant(_conversation_id) then raise exception 'Non sei partecipante di questa conversazione'; end if;
  if not public.are_friends(_me, _new_member) then raise exception 'Puoi aggiungere solo amici'; end if;
  insert into public.conversation_participants (conversation_id, user_id, role)
  values (_conversation_id, _new_member, 'member')
  on conflict (conversation_id, user_id) do update set left_at = null, joined_at = now();
  insert into public.messages (conversation_id, sender_id, content_type, metadata)
  values (_conversation_id, _me, 'system', jsonb_build_object('action', 'added', 'target_user', _new_member));
end;
$$;
revoke all on function public.add_group_participant(uuid, uuid) from public, anon;
grant execute on function public.add_group_participant(uuid, uuid) to authenticated;

create or replace function public.remove_group_participant(_conversation_id uuid, _target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  _me uuid := auth.uid();
  _my_role text;
begin
  select role into _my_role from public.conversation_participants
  where conversation_id = _conversation_id and user_id = _me and left_at is null;
  if _my_role is distinct from 'admin' then raise exception 'Solo un admin può rimuovere un partecipante'; end if;
  update public.conversation_participants set left_at = now()
  where conversation_id = _conversation_id and user_id = _target;
  insert into public.messages (conversation_id, sender_id, content_type, metadata)
  values (_conversation_id, _me, 'system', jsonb_build_object('action', 'removed', 'target_user', _target));
end;
$$;
revoke all on function public.remove_group_participant(uuid, uuid) from public, anon;
grant execute on function public.remove_group_participant(uuid, uuid) to authenticated;

create or replace function public.leave_group_conversation(_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _me uuid := auth.uid();
begin
  if not public.is_participant(_conversation_id) then raise exception 'Non sei partecipante di questa conversazione'; end if;
  update public.conversation_participants set left_at = now()
  where conversation_id = _conversation_id and user_id = _me;
  insert into public.messages (conversation_id, sender_id, content_type, metadata)
  values (_conversation_id, _me, 'system', jsonb_build_object('action', 'left'));
end;
$$;
revoke all on function public.leave_group_conversation(uuid) from public, anon;
grant execute on function public.leave_group_conversation(uuid) to authenticated;

create or replace function public.promote_to_admin(_conversation_id uuid, _target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  _me uuid := auth.uid();
  _my_role text;
begin
  select role into _my_role from public.conversation_participants
  where conversation_id = _conversation_id and user_id = _me and left_at is null;
  if _my_role is distinct from 'admin' then raise exception 'Solo un admin può promuovere un altro membro'; end if;
  update public.conversation_participants set role = 'admin'
  where conversation_id = _conversation_id and user_id = _target and left_at is null;
end;
$$;
revoke all on function public.promote_to_admin(uuid, uuid) from public, anon;
grant execute on function public.promote_to_admin(uuid, uuid) to authenticated;

-- 5. MESSAGE_REFERENCES
create table public.message_references (
  message_id uuid primary key references public.messages(id) on delete cascade,
  ref_type text not null check (ref_type in ('outfit','outfit_plan','event_snapshot')),
  outfit_id uuid references public.outfits(id),
  snapshot_image_url text,
  event_snapshot jsonb
);
grant select, insert on public.message_references to authenticated;
grant all on public.message_references to service_role;
alter table public.message_references enable row level security;
create index message_references_outfit_idx on public.message_references (outfit_id);

create policy "message_references_select_if_visible" on public.message_references for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_references.message_id
        and exists (
          select 1 from public.conversation_participants cp
          where cp.conversation_id = m.conversation_id
            and cp.user_id = auth.uid()
            and m.created_at >= cp.joined_at
        )
    )
  );

create policy "message_references_insert_own_outfit" on public.message_references for insert to authenticated
  with check (
    exists (
      select 1 from public.messages m
      where m.id = message_references.message_id and m.sender_id = auth.uid()
    )
    and (
      ref_type <> 'outfit'
      or exists (
        select 1 from public.outfits o
        where o.id = message_references.outfit_id and o.user_id = auth.uid()
      )
    )
  );

-- 6. MESSAGE_REACTIONS
create table public.message_reactions (
  message_id uuid not null references public.message_references(message_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('like','dislike')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
grant select, insert, delete on public.message_reactions to authenticated;
grant all on public.message_reactions to service_role;
alter table public.message_reactions enable row level security;

create policy "reactions_select_if_participant" on public.message_reactions for select to authenticated
  using (
    exists (select 1 from public.messages m where m.id = message_reactions.message_id and public.is_participant(m.conversation_id))
  );
create policy "reactions_insert_own_if_participant" on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.messages m where m.id = message_reactions.message_id and public.is_participant(m.conversation_id))
  );
create policy "reactions_delete_own" on public.message_reactions for delete to authenticated using (user_id = auth.uid());

-- 7. MESSAGE_COMMENTS
create table public.message_comments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.message_references(message_id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
grant select, insert on public.message_comments to authenticated;
grant all on public.message_comments to service_role;
alter table public.message_comments enable row level security;
create index message_comments_message_idx on public.message_comments (message_id, created_at);

create policy "comments_select_if_participant" on public.message_comments for select to authenticated
  using (
    exists (select 1 from public.messages m where m.id = message_comments.message_id and public.is_participant(m.conversation_id))
  );
create policy "comments_insert_own_if_participant" on public.message_comments for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.messages m where m.id = message_comments.message_id and public.is_participant(m.conversation_id))
  );

-- 8. NOTIFICHE
create or replace function public.notify_outfit_share()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.content_type = 'outfit_share' then
    insert into public.notifications (user_id, type, title, body, data)
    select cp.user_id, 'outfit_share', 'Nuovo outfit condiviso', 'Hai ricevuto un outfit in chat',
           jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'sender_id', new.sender_id)
    from public.conversation_participants cp
    where cp.conversation_id = new.conversation_id
      and cp.user_id <> new.sender_id
      and cp.left_at is null;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_outfit_share() from public, anon, authenticated;

create trigger trg_notify_outfit_share
  after insert on public.messages
  for each row execute function public.notify_outfit_share();

-- 2bis. Estensione can_read_shared_canvas (logica esistente invariata + caso chat)
create or replace function public.can_read_shared_canvas(_object_name text)
returns boolean language sql stable security definer set search_path = public as $$
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
      AND m.created_at >= cp.joined_at
      AND r.snapshot_image_url = _object_name
  )
$$;
