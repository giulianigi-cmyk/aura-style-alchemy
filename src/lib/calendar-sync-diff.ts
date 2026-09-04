// AURA — Calendar sync: detecting events removed from the source.
//
// Pure diff logic, shared by google-calendar.server.ts,
// outlook-calendar.server.ts and caldav.server.ts — each does its own
// provider-specific fetch, then hands the two id lists here. Kept out of
// the three sync files so the rule (what counts as "removed") lives in one
// place and is unit-testable without hitting any of the three providers.

/** Ids that were cached for this connection before this sync, and are no
 *  longer present in what the provider just returned — candidates to mark
 *  removed_from_source. Never a delete: the caller updates a flag, the
 *  row and anything referencing it (outfit_plans, trip_day_activities)
 *  stays exactly where it is. */
export function computeRemovedEventIds(previouslyCachedIds: string[], freshlyFetchedIds: string[]): string[] {
  const fetched = new Set(freshlyFetchedIds);
  // De-dupe defensively: a provider returning the same id twice in one
  // fetch (shouldn't happen, but costs nothing to guard) must never
  // produce a duplicate entry in the result.
  const seen = new Set<string>();
  const removed: string[] = [];
  for (const id of previouslyCachedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!fetched.has(id)) removed.push(id);
  }
  return removed;
}
