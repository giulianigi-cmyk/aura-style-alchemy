drop policy if exists "Users manage their own trip packing items" on public.trip_packing_items;
create policy "Users manage their own trip packing items"
on public.trip_packing_items
for all
to authenticated
using (
  exists (select 1 from public.trips t where t.id = trip_packing_items.trip_id and t.user_id = auth.uid())
)
with check (
  exists (select 1 from public.trips t where t.id = trip_packing_items.trip_id and t.user_id = auth.uid())
  and (
    wardrobe_item_id is null
    or exists (select 1 from public.wardrobe_items w where w.id = trip_packing_items.wardrobe_item_id and w.user_id = auth.uid())
  )
  and (
    source_location_id is null
    or exists (select 1 from public.wardrobe_locations l where l.id = trip_packing_items.source_location_id and l.user_id = auth.uid())
  )
);

drop policy if exists "Users manage their own trip locations" on public.trip_source_locations;
create policy "Users manage their own trip locations"
on public.trip_source_locations
for all
to authenticated
using (
  exists (select 1 from public.trips t where t.id = trip_source_locations.trip_id and t.user_id = auth.uid())
)
with check (
  exists (select 1 from public.trips t where t.id = trip_source_locations.trip_id and t.user_id = auth.uid())
  and exists (select 1 from public.wardrobe_locations l where l.id = trip_source_locations.location_id and l.user_id = auth.uid())
);