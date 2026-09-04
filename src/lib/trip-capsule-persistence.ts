// AURA — trip-capsule-persistence: unit test
//
// COME ESEGUIRLI:
//   npx esbuild src/lib/trip-capsule-persistence.test.ts --bundle --platform=node --format=esm --outfile=/tmp/tcp-test.mjs
//   node /tmp/tcp-test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { computeCapsuleSeedAndExclusions } from "./trip-capsule-persistence";

test("item persistito non rimosso → entra nel seed", () => {
  const r = computeCapsuleSeedAndExclusions([{ wardrobe_item_id: "a", removed_by_user: false }], []);
  assert.deepEqual(r.seedIds, ["a"]);
  assert.deepEqual(r.excludedIds, []);
});

test("item rimosso manualmente → esclusione, MAI nel seed", () => {
  const r = computeCapsuleSeedAndExclusions([{ wardrobe_item_id: "a", removed_by_user: true }], []);
  assert.deepEqual(r.seedIds, []);
  assert.deepEqual(r.excludedIds, ["a"]);
});

test("legacy outfit_plans (trip senza righe trip_capsule_items) → entra comunque nel seed", () => {
  const r = computeCapsuleSeedAndExclusions([], ["legacy-1", "legacy-2"]);
  assert.deepEqual(r.seedIds.sort(), ["legacy-1", "legacy-2"]);
});

test("esclusione manuale vince SEMPRE sul dato legacy — anche se l'item appare ancora in outfit_plans vecchi", () => {
  const r = computeCapsuleSeedAndExclusions(
    [{ wardrobe_item_id: "a", removed_by_user: true }],
    ["a", "b"]
  );
  assert.deepEqual(r.seedIds.sort(), ["b"]);
  assert.deepEqual(r.excludedIds, ["a"]);
});

test("nessun dato persistito e nessun legacy → seed ed esclusioni vuoti, nessun crash", () => {
  const r = computeCapsuleSeedAndExclusions([], []);
  assert.deepEqual(r.seedIds, []);
  assert.deepEqual(r.excludedIds, []);
});

test("stesso item sia persistito attivo sia in legacy → nessun doppione nel seed", () => {
  const r = computeCapsuleSeedAndExclusions([{ wardrobe_item_id: "a", removed_by_user: false }], ["a"]);
  assert.deepEqual(r.seedIds, ["a"]);
});
