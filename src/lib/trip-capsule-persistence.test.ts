// AURA — Trip Capsule: merging the persistent trip_capsule_items table
// with the legacy outfit_plans-derived seed (trips generated before this
// table existed) into a single seed + exclusion list. Pure, unit-testable
// without a database — trip-capsule.server.ts does the fetching, this
// does the deciding.

export interface PersistedCapsuleItem {
  wardrobe_item_id: string;
  removed_by_user: boolean;
}

export interface CapsuleSeedResult {
  /** Item ids to start the capsule with (see buildCapsule's seed param). */
  seedIds: string[];
  /** Item ids that must NEVER be re-added to this trip's capsule, no
   *  matter how well they'd otherwise score — a manual removal wins. */
  excludedIds: string[];
}

export function computeCapsuleSeedAndExclusions(
  persisted: PersistedCapsuleItem[],
  legacyOutfitPlanItemIds: string[]
): CapsuleSeedResult {
  const excluded = new Set(persisted.filter((p) => p.removed_by_user).map((p) => p.wardrobe_item_id));
  const active = new Set(persisted.filter((p) => !p.removed_by_user).map((p) => p.wardrobe_item_id));

  // Backward compatibility: a trip generated before trip_capsule_items
  // existed has no rows here at all — its outfit_plans are the only
  // record of what the capsule was. Fold those in as seed too, UNLESS
  // the person has since explicitly removed that exact item (excluded
  // always wins, even over legacy data).
  for (const id of legacyOutfitPlanItemIds) {
    if (!excluded.has(id)) active.add(id);
  }

  return { seedIds: Array.from(active), excludedIds: Array.from(excluded) };
}
