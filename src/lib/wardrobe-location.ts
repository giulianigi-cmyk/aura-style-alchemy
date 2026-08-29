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

/**
 * Same rule as isItemAtLocation, generalized to more than one location at
 * once — e.g. "I'm on a trip: consider both my main wardrobe AND what's
 * at the beach house available". An empty/undefined list means the
 * location system isn't being scoped for this call at all, so every
 * item is eligible (same fallback as the single-location version, and
 * the same default the rest of the app already relies on).
 */
export function isItemAtAnyLocation(
  item: { location_id?: string | null },
  activeLocations: { id: string; is_primary: boolean }[] | null | undefined,
): boolean {
  if (!activeLocations || activeLocations.length === 0) return true;
  if (activeLocations.some((loc) => item.location_id === loc.id)) return true;
  if (item.location_id == null && activeLocations.some((loc) => loc.is_primary)) return true;
  return false;
}
