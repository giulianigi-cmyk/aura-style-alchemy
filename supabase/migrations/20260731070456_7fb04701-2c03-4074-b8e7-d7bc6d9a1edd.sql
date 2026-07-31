alter table public.wardrobe_items
  add column if not exists source text;

drop policy if exists "batch_scans owner delete" on public.batch_scans;

create policy "batch_scans owner delete" on public.batch_scans
  for delete to authenticated using (auth.uid() = user_id);