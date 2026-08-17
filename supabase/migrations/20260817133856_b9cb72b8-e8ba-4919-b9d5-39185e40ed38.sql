create or replace function public.list_conversations()
returns table(
  conversation_id uuid, status text, is_group boolean, created_at timestamptz,
  my_role text, title text, other_id uuid, other_profile_image text,
  member_count integer, last_message_at timestamptz, last_message_type text,
  last_message_body text, unread_count integer, can_send boolean
)
language sql stable security definer set search_path = public as $$
  select c.id, c.status,
    (c.canonical_key is null) as is_group,
    c.created_at,
    me.role,
    case when c.canonical_key is null
      then coalesce((
        select string_agg(p.username, ', ' order by p.username)
        from public.conversation_participants cp2
        join public.profiles p on p.id = cp2.user_id
        where cp2.conversation_id = c.id and cp2.left_at is null and cp2.user_id <> auth.uid()
      ), 'Gruppo')
      else (
        select p.username from public.conversation_participants cp3
        join public.profiles p on p.id = cp3.user_id
        where cp3.conversation_id = c.id and cp3.user_id <> auth.uid() limit 1
      )
    end as title,
    case when c.canonical_key is null then null else (
      select cp4.user_id from public.conversation_participants cp4
      where cp4.conversation_id = c.id and cp4.user_id <> auth.uid() limit 1
    ) end as other_id,
    case when c.canonical_key is null then null else (
      select p.profile_image from public.conversation_participants cp5
      join public.profiles p on p.id = cp5.user_id
      where cp5.conversation_id = c.id and cp5.user_id <> auth.uid() limit 1
    ) end as other_profile_image,
    public.active_participant_count(c.id),
    (select max(m.created_at) from public.messages m where m.conversation_id = c.id and m.created_at >= me.joined_at),
    (select m.content_type from public.messages m where m.conversation_id = c.id and m.created_at >= me.joined_at order by m.created_at desc limit 1),
    (select case when m.deleted_at is not null then null else m.body end from public.messages m
      where m.conversation_id = c.id and m.created_at >= me.joined_at order by m.created_at desc limit 1),
    (select count(*)::int from public.messages m
      where m.conversation_id = c.id
        and m.created_at >= me.joined_at
        and m.sender_id <> auth.uid()
        and (me.last_read_at is null or m.created_at > me.last_read_at)),
    public.can_send_message(c.id)
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  where me.user_id = auth.uid() and me.left_at is null
  order by coalesce((select max(m.created_at) from public.messages m where m.conversation_id = c.id), c.created_at) desc
$$;
revoke all on function public.list_conversations() from public, anon;
grant execute on function public.list_conversations() to authenticated;

create or replace function public.get_conversation_participants(_conversation_id uuid)
returns table(user_id uuid, username text, profile_image text, role text, joined_at timestamptz, left_at timestamptz)
language sql stable security definer set search_path = public as $$
  select cp.user_id, p.username, p.profile_image, cp.role, cp.joined_at, cp.left_at
  from public.conversation_participants cp
  join public.profiles p on p.id = cp.user_id
  where cp.conversation_id = _conversation_id
    and public.is_participant(_conversation_id)
  order by cp.joined_at
$$;
revoke all on function public.get_conversation_participants(uuid) from public, anon;
grant execute on function public.get_conversation_participants(uuid) to authenticated;

create or replace function public.get_conversation_messages(_conversation_id uuid, _limit integer default 200)
returns table(
  id uuid, sender_id uuid, sender_username text, sender_profile_image text,
  content_type text, body text, metadata jsonb, created_at timestamptz, deleted_at timestamptz,
  ref_type text, outfit_id uuid, snapshot_image_url text, event_snapshot jsonb,
  like_count integer, dislike_count integer, my_reaction text, comment_count integer
)
language sql stable security definer set search_path = public as $$
  select m.id, m.sender_id, p.username, p.profile_image,
    m.content_type, case when m.deleted_at is not null then null else m.body end, m.metadata, m.created_at, m.deleted_at,
    r.ref_type, r.outfit_id, r.snapshot_image_url, r.event_snapshot,
    (select count(*)::int from public.message_reactions x where x.message_id = m.id and x.reaction_type = 'like'),
    (select count(*)::int from public.message_reactions x where x.message_id = m.id and x.reaction_type = 'dislike'),
    (select x.reaction_type from public.message_reactions x where x.message_id = m.id and x.user_id = auth.uid()),
    (select count(*)::int from public.message_comments cc where cc.message_id = m.id)
  from public.messages m
  join public.conversation_participants me
    on me.conversation_id = m.conversation_id and me.user_id = auth.uid()
  join public.profiles p on p.id = m.sender_id
  left join public.message_references r on r.message_id = m.id
  where m.conversation_id = _conversation_id
    and m.created_at >= me.joined_at
  order by m.created_at
  limit greatest(_limit, 1)
$$;
revoke all on function public.get_conversation_messages(uuid, integer) from public, anon;
grant execute on function public.get_conversation_messages(uuid, integer) to authenticated;

create or replace function public.get_message_thread_comments(_message_id uuid)
returns table(id uuid, user_id uuid, username text, profile_image text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select cc.id, cc.user_id, p.username, p.profile_image, cc.body, cc.created_at
  from public.message_comments cc
  join public.profiles p on p.id = cc.user_id
  join public.messages m on m.id = cc.message_id
  where cc.message_id = _message_id
    and public.is_participant(m.conversation_id)
  order by cc.created_at
$$;
revoke all on function public.get_message_thread_comments(uuid) from public, anon;
grant execute on function public.get_message_thread_comments(uuid) to authenticated;

create or replace function public.mark_conversation_read(_conversation_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.conversation_participants
  set last_read_at = now()
  where conversation_id = _conversation_id and user_id = auth.uid();
$$;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;