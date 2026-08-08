// Wardrobe locations — a person may have more than one place their
// clothes physically live (a main home, a beach house, etc.). Most
// people will never create a second location; when none exists, every
// function below is a no-op and the wardrobe behaves exactly as it did
// before this feature existed.
//
// Compatibility rule (deliberate, not a migration): existing items have
// location_id = NULL. NULL is treated as "the primary location" ONLY
// when the currently active location IS the primary one — never as a
// wildcard match for every location. New items are always given an
// explicit location_id going forward (see AddItem.tsx), so this
// fallback only matters for pre-existing rows.

export type WardrobeLocation = {
  id: string;
  user_id: string;
  name: string;
  is_primary: boolean;
  end_date: string | null;
  created_at: string;
  updated_at: string;
};

export function isItemAtLocation(
  item: { location_id?: string | null },
  active: { id: string; is_primary: boolean } | null,
): boolean {
  // No active location set (or the location system isn't in use at all)
  // — every item is eligible, same as before this feature existed.
  if (!active) return true;
  if (item.location_id === active.id) return true;
  if (item.location_id == null && active.is_primary) return true;
  return false;
}
