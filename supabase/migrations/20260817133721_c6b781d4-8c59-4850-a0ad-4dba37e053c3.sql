alter table public.messages replica identity full;
alter table public.notifications replica identity full;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;