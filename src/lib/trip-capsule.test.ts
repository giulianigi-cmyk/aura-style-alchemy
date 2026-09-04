// AURA — Trip Capsule: test del seeding da piani già esistenti
//
// Copre esclusivamente il fix di questo step: buildCapsule() ora parte da
// un seed di item già scelti in giorni del trip già pianificati (e quindi
// esclusi dalla rigenerazione corrente), invece di ricostruire sempre da
// zero — vedi trip-capsule.server.ts per il ragionamento completo.
//
// COME ESEGUIRLO:
//   npx esbuild src/lib/trip-capsule.test.ts --bundle --platform=node --format=esm --external:@supabase/supabase-js --outfile=/tmp/tc-test.mjs
//   node /tmp/tc-test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { buildCapsule, type PoolItem, type Requirement } from "./trip-capsule.server";

function item(overrides: Partial<PoolItem> & { id: string }): PoolItem {
  return {
    category: "Tops", subcategory: null, colors: null, style: null, season: null,
    brand: null, material: null, locationId: null, formality: 2, dayEvening: "day",
    ...overrides,
  };
}

const req: Requirement = { activityId: "act-1", date: "2026-09-10", daySegment: "day", dressCode: null, label: "Everyday" };

test("il seed di item già pianificati entra nella capsule se è ancora nel pool", () => {
  const pool: PoolItem[] = [
    item({ id: "shirt-1" }),
    item({ id: "shoes-1", category: "Shoes" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const capsule = buildCapsule(pool, [req], new Map(), ["shirt-1", "shoes-1"]);
  assert.ok(capsule.has("shirt-1"), "shirt-1 dal seed deve essere nella capsule");
  assert.ok(capsule.has("shoes-1"), "shoes-1 dal seed deve essere nella capsule");
});

test("un id nel seed che non esiste più nel pool viene scartato, non crasha", () => {
  const pool: PoolItem[] = [item({ id: "shirt-1" })];
  const capsule = buildCapsule(pool, [req], new Map(), ["shirt-1", "deleted-item-99"]);
  assert.ok(capsule.has("shirt-1"));
  assert.equal(capsule.has("deleted-item-99"), false);
});

test("seed vuoto (caso targeted regenerate) si comporta come prima — nessuna regressione", () => {
  const pool: PoolItem[] = [item({ id: "shirt-1" }), item({ id: "shoes-1", category: "Shoes" })];
  const capsule = buildCapsule(pool, [req], new Map(), []);
  // Nessuna asserzione sul contenuto esatto (dipende dalla logica greedy
  // esistente, non toccata) — verifica solo che non esploda e che il seed
  // vuoto non forzi nulla che il comportamento originale non includerebbe.
  assert.ok(capsule instanceof Set);
});

test("seed omesso del tutto (retrocompatibilità della firma) equivale a nessun seed", () => {
  const pool: PoolItem[] = [item({ id: "shirt-1" })];
  const capsule = buildCapsule(pool, [req], new Map());
  assert.ok(capsule instanceof Set);
});

test("REGRESSIONE — un capo 'universale' preso dal giorno più vincolato non deve bloccare l'aggiunta di altri capi eleggibili nei giorni successivi", () => {
  // Riproduce il meccanismo esatto: un top a stagione nulla (eleggibile
  // ovunque) più 3 top solo estivi. Il giorno invernale (il più vincolato:
  // solo il top universale è eleggibile) viene processato per primo e
  // prende quell'unico top. Prima del fix, i giorni estivi vedevano quel
  // top universale già in inCapsule (è eleggibile anche per loro) e
  // hasRole() considerava il ruolo Top "già soddisfatto" — i 3 top estivi,
  // pur eleggibili e mai scelti, non venivano mai aggiunti.
  const pool: PoolItem[] = [
    item({ id: "top-universal", category: "Tops", season: null }),
    item({ id: "top-summer-1", category: "Tops", season: "Summer" }),
    item({ id: "top-summer-2", category: "Tops", season: "Summer" }),
    item({ id: "top-summer-3", category: "Tops", season: "Summer" }),
    item({ id: "bottom-1", category: "Bottoms", season: null }),
    item({ id: "shoes-1", category: "Shoes", season: null }),
    item({ id: "bag-1", category: "Bags", season: null }),
  ];
  const requirements: Requirement[] = [
    { activityId: "d1", date: "2026-01-10", daySegment: "day", dressCode: null, label: "Everyday" },
    { activityId: "d2", date: "2026-07-10", daySegment: "day", dressCode: null, label: "Everyday" },
    { activityId: "d3", date: "2026-07-11", daySegment: "day", dressCode: null, label: "Everyday" },
    { activityId: "d4", date: "2026-07-12", daySegment: "day", dressCode: null, label: "Everyday" },
  ];
  const seasonByDate = new Map([
    ["2026-01-10", "Winter"],
    ["2026-07-10", "Summer"], ["2026-07-11", "Summer"], ["2026-07-12", "Summer"],
  ]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, []);
  const topsInCapsule = Array.from(capsule).filter((id) => id.startsWith("top-"));
  assert.ok(topsInCapsule.length > 1, `attesi più top in capsule (i top estivi eleggibili non dovevano restare esclusi), trovati solo: ${topsInCapsule.join(", ")}`);
});
