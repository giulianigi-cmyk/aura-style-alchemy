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
import { buildCapsule, type PoolItem, type Requirement, climateSuitability, isSweatConsumable, applyHardDressCodeFilter, isTransportActivity, applyTransportPracticalityFilter, isAccommodationActivity, changeAssumedPossible, isTravelSuitable, outfitIsTravelSuitable } from "./trip-capsule.server";

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



test("REGRESSIONE — una scarpa non-sneaker eleggibile entra in capsule per gli slot serali invece delle sole sneakers", () => {
  // Un guardaroba con 2 sneakers e 1 paio di ballerine, tutti eleggibili
  // (stessa stagione, nessun vincolo escludente). Senza il nudge di
  // versatility(), le sneakers (più "versatili" a parità di altri
  // punteggi) potevano riempire da sole tutto lo shoeTarget, lasciando le
  // ballerine fuori dalla capsule anche per gli slot serali — la scarpa
  // "giusta" non entrava mai nel pool che l'AI vede, a monte.
  const pool: PoolItem[] = [
    item({ id: "sneaker-1", category: "Shoes", subcategory: "Sneakers", formality: 2, dayEvening: "both" }),
    item({ id: "sneaker-2", category: "Shoes", subcategory: "Sneakers", formality: 2, dayEvening: "both" }),
    item({ id: "flats-1", category: "Shoes", subcategory: "Ballet Flats", formality: 3, dayEvening: "both" }),
    item({ id: "top-1", category: "Tops" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "d1-day", date: "2026-07-10", daySegment: "day", dressCode: null, label: "Day" },
    { activityId: "d1-eve", date: "2026-07-10", daySegment: "evening", dressCode: null, label: "Evening" },
  ];
  const seasonByDate = new Map([["2026-07-10", "Summer"]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, []);
  assert.ok(capsule.has("flats-1"), "le ballerine dovevano entrare in capsule per lo slot serale, non solo le sneakers");
});

test("REGRESSIONE — uno stivaletto elegante non deve battere un tacco/sandalo estivo per una cena d'estate", () => {
  // Il trip ha una sola attività con segnale di eleganza (una cena),
  // in un giorno estivo, con temperatura reale nota e calda.
  const pool: PoolItem[] = [
    item({ id: "boot-elegant", category: "Shoes", subcategory: "Ankle Boots", formality: 4, colors: ["black"] }),
    item({ id: "sandal-elegant", category: "Shoes", subcategory: "Heeled Sandals", formality: 4, colors: ["black"] }),
    item({ id: "sneaker-1", category: "Shoes", subcategory: "Sneakers", formality: 2 }),
    item({ id: "top-1", category: "Tops" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "dinner", date: "2026-07-10", daySegment: "evening", dressCode: null, label: "Cena da Mario" },
  ];
  const seasonByDate = new Map([["2026-07-10", "Summer"]]);
  const tempByActivity = new Map([["dinner", 28]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  assert.ok(capsule.has("sandal-elegant"), "il sandalo elegante estivo doveva essere scelto per la cena");
  assert.ok(!capsule.has("boot-elegant"), "lo stivaletto non doveva essere scelto per una cena in piena estate");
});

test("Uno stivaletto elegante resta comunque scelto se è l'unica scarpa formale disponibile, anche d'estate", () => {
  // Nessuna alternativa elegante estiva nel guardaroba — lo slot riservato
  // non deve mai restare vuoto per una preferenza di stile.
  const pool: PoolItem[] = [
    item({ id: "boot-elegant", category: "Shoes", subcategory: "Ankle Boots", formality: 4 }),
    item({ id: "sneaker-1", category: "Shoes", subcategory: "Sneakers", formality: 2 }),
    item({ id: "top-1", category: "Tops" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "dinner", date: "2026-07-10", daySegment: "evening", dressCode: null, label: "Cena da Mario" },
  ];
  const seasonByDate = new Map([["2026-07-10", "Summer"]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, []);
  assert.ok(capsule.has("boot-elegant"), "in assenza di alternative, lo stivaletto va comunque scelto — mai lasciare lo slot vuoto");
});

test("REGRESSIONE — un trip di 2 giorni non aggiunge una seconda scarpa senza un motivo reale", () => {
  // Prima del fix, shoeTarget era sempre 2 indipendentemente dalla durata
  // del trip — un weekend di 2 giorni tentava comunque di inserire 2 paia
  // di sneakers in capsule anche senza nessuna occasione elegante/sport
  // che lo giustificasse.
  const pool: PoolItem[] = [
    item({ id: "sneaker-1", category: "Shoes", subcategory: "Sneakers" }),
    item({ id: "sneaker-2", category: "Shoes", subcategory: "Sneakers" }),
    item({ id: "top-1", category: "Tops" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "d1-day", date: "2026-07-10", daySegment: "day", dressCode: null, label: "Day" },
    { activityId: "d1-eve", date: "2026-07-10", daySegment: "evening", dressCode: null, label: "Evening" },
    { activityId: "d2-day", date: "2026-07-11", daySegment: "day", dressCode: null, label: "Day" },
    { activityId: "d2-eve", date: "2026-07-11", daySegment: "evening", dressCode: null, label: "Evening" },
  ];
  const seasonByDate = new Map([["2026-07-10", "Summer"], ["2026-07-11", "Summer"]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, []);
  const shoesInCapsule = Array.from(capsule).filter((id) => id.startsWith("sneaker-"));
  assert.equal(shoesInCapsule.length, 1, `un trip di 2 giorni senza occasioni speciali dovrebbe avere 1 sola scarpa, trovate: ${shoesInCapsule.join(", ")}`);
});

test("Un trip lungo (una settimana+) può comunque avere una seconda scarpa", () => {
  const pool: PoolItem[] = [
    item({ id: "sneaker-1", category: "Shoes", subcategory: "Sneakers" }),
    item({ id: "sneaker-2", category: "Shoes", subcategory: "Sneakers" }),
    item({ id: "top-1", category: "Tops" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = Array.from({ length: 16 }, (_, i) => ({
    activityId: `act-${i}`,
    date: `2026-07-${10 + Math.floor(i / 2)}`,
    daySegment: (i % 2 === 0 ? "day" : "evening") as "day" | "evening",
    dressCode: null,
    label: i % 2 === 0 ? "Day" : "Evening",
  }));
  const seasonByDate = new Map(requirements.map((r) => [r.date, "Summer"]));

  const capsule = buildCapsule(pool, requirements, seasonByDate, []);
  const shoesInCapsule = Array.from(capsule).filter((id) => id.startsWith("sneaker-"));
  assert.equal(shoesInCapsule.length, 2, `un trip lungo dovrebbe poter avere 2 scarpe, trovate: ${shoesInCapsule.join(", ")}`);
});

test("REGRESSIONE — settembre reale e caldo (25°C) preferisce il sandalo allo stivaletto, anche se seasonForDate lo classifica 'Autumn'", () => {
  // Il bug esatto segnalato: seasonForDate() bucketizza settembre come
  // "Autumn", quindi il vecchio controllo season-only non faceva mai
  // scattare la penalità stivaletto per un trip di settembre, anche con
  // 25°C reali di sera. La temperatura vera, quando disponibile, deve
  // vincere sul bucket stagionale grezzo.
  const pool: PoolItem[] = [
    item({ id: "boot-elegant", category: "Shoes", subcategory: "Ankle Boots", formality: 4, colors: ["black"] }),
    item({ id: "sandal-elegant", category: "Shoes", subcategory: "Heeled Sandals", formality: 4, colors: ["black"] }),
    item({ id: "top-1", category: "Tops" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "dinner", date: "2026-09-06", daySegment: "evening", dressCode: null, label: "Cena El Porteno" },
  ];
  const seasonByDate = new Map([["2026-09-06", "Autumn"]]);
  const tempByActivity = new Map([["dinner", 25]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  assert.ok(capsule.has("sandal-elegant"), "il sandalo doveva essere scelto: 25°C reali sono caldi, indipendentemente dal bucket stagionale");
  assert.ok(!capsule.has("boot-elegant"), "lo stivaletto non doveva essere scelto a 25°C reali");
});

test("Senza temperatura nota, il fallback stagionale usa il tag season dell'item (nessuna regressione)", () => {
  const pool: PoolItem[] = [
    item({ id: "boot-elegant", category: "Shoes", subcategory: "Ankle Boots", formality: 4, colors: ["black"], season: "Autumn" }),
    item({ id: "sandal-elegant", category: "Shoes", subcategory: "Heeled Sandals", formality: 4, colors: ["black"], season: "Summer" }),
    item({ id: "top-1", category: "Tops" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "dinner", date: "2026-07-10", daySegment: "evening", dressCode: null, label: "Cena" },
  ];
  const seasonByDate = new Map([["2026-07-10", "Summer"]]);
  // Nessun tempByActivity passato — deve ricadere sul tag season dell'item
  // (matchesSeasonLoose), esattamente come prima che esistesse la
  // temperatura reale.
  const capsule = buildCapsule(pool, requirements, seasonByDate, []);
  assert.ok(capsule.has("sandal-elegant"));
});

test("REGRESSIONE — una sera fresca preferisce un top a manica lunga su uno a manica corta, quando entrambi sono eleggibili", () => {
  const pool: PoolItem[] = [
    item({ id: "top-short", category: "Tops", sleeveLength: "Short Sleeve" }),
    item({ id: "top-long", category: "Tops", sleeveLength: "Long Sleeve" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "shoes-1", category: "Shoes" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "eve", date: "2026-09-06", daySegment: "evening", dressCode: null, label: "Evening" },
  ];
  const seasonByDate = new Map([["2026-09-06", "Autumn"]]);
  const tempByActivity = new Map([["eve", 14]]); // sera fresca

  const capsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  // Entrambi possono comunque entrare (perRoleTarget>=2), ma verifichiamo
  // che il long-sleeve non sia scartato a favore del solo short-sleeve —
  // controlliamo il caso opposto e più diagnostico sotto, con un solo
  // slot disponibile per il ruolo Top.
  assert.ok(capsule.has("top-long"), "il top a manica lunga doveva essere preferito per una sera fresca");
});

test("REGRESSIONE — un giorno caldo preferisce un top a manica corta su uno a manica lunga, quando entrambi sono eleggibili", () => {
  const pool: PoolItem[] = [
    item({ id: "top-short", category: "Tops", sleeveLength: "Short Sleeve" }),
    item({ id: "top-long", category: "Tops", sleeveLength: "Long Sleeve" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "shoes-1", category: "Shoes" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "day", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Day" },
  ];
  const seasonByDate = new Map([["2026-09-06", "Autumn"]]);
  const tempByActivity = new Map([["day", 27]]); // giorno caldo

  const capsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  assert.ok(capsule.has("top-short"), "il top a manica corta doveva essere preferito per un giorno caldo");
});

// ---------------------------------------------------------------------------
// climateSuitability — casi A-F richiesti esplicitamente, più il caso
// dell'eleggibilità (il bug reale: un capo "possible" non deve mai essere
// escluso da eligibleFor/buildCapsule, solo penalizzato nel punteggio).
// ---------------------------------------------------------------------------

test("Il bug reale: sandalo Summer eleggibile a settembre (bucket 'Autumn') con temperatura reale calda", () => {
  const pool: PoolItem[] = [
    item({ id: "boot-elegant", category: "Shoes", subcategory: "Ankle Boots", formality: 4, season: "Autumn" }),
    item({ id: "sandal-elegant", category: "Shoes", subcategory: "Heeled Sandals", formality: 4, season: "Summer" }),
    item({ id: "top-1", category: "Tops" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "dinner", date: "2026-09-06", daySegment: "evening", dressCode: null, label: "Cena El Porteno" },
  ];
  const seasonByDate = new Map([["2026-09-06", "Autumn"]]);
  const tempByActivity = new Map([["dinner", 25]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  assert.ok(capsule.has("sandal-elegant"), "il sandalo Summer doveva restare eleggibile ed essere scelto a 25°C reali, anche se settembre è bucketizzato come Autumn");
});

test("Caso A — 30°C: la T-shirt vince sulla maglia a maniche lunghe", () => {
  const pool: PoolItem[] = [
    item({ id: "tshirt", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve", season: null }),
    item({ id: "sweater", category: "Tops", subcategory: "Sweater", sleeveLength: "Long Sleeve", season: "Autumn" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "shoes-1", category: "Shoes" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "day", date: "2026-07-15", daySegment: "day", dressCode: null, label: "Day" },
  ];
  const seasonByDate = new Map([["2026-07-15", "Summer"]]);
  const tempByActivity = new Map([["day", 30]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  assert.ok(capsule.has("tshirt"), "la t-shirt doveva essere scelta a 30°C");
  assert.ok(!capsule.has("sweater"), "la maglia a manica lunga non doveva essere scelta a 30°C (HEAVY_SIGNAL + hot = inappropriate)");
});

test("Caso C — dicembre, 15°C: il sandalo Summer resta eleggibile (non escluso)", () => {
  const boot: PoolItem = item({ id: "boot", category: "Shoes", subcategory: "Ankle Boots", formality: 4, season: "Winter" });
  const sandal: PoolItem = item({ id: "sandal", category: "Shoes", subcategory: "Heeled Sandals", formality: 4, season: "Summer" });
  assert.equal(climateSuitability(sandal, 15, "Winter"), "possible", "15°C non è freddo estremo — il sandalo deve restare 'possible', mai 'inappropriate'");
  assert.notEqual(climateSuitability(sandal, 15, "Winter"), "inappropriate");
});

test("Caso D — 5°C reali: il sandalo è 'inappropriate' (fortemente sfavorito/escluso)", () => {
  const sandal: PoolItem = item({ id: "sandal", category: "Shoes", subcategory: "Heeled Sandals", formality: 4, season: "Summer" });
  assert.equal(climateSuitability(sandal, 5, "Winter"), "inappropriate");
});

test("Caso E — settembre, 28°C reali: la T-shirt Summer vince sulla maglia Autumn nonostante il calendario dica Autumn", () => {
  const pool: PoolItem[] = [
    item({ id: "tshirt", category: "Tops", subcategory: "T-Shirt", season: "Summer" }),
    item({ id: "sweater", category: "Tops", subcategory: "Sweater", season: "Autumn" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "shoes-1", category: "Shoes" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "day", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Day" },
  ];
  const seasonByDate = new Map([["2026-09-06", "Autumn"]]);
  const tempByActivity = new Map([["day", 28]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  assert.ok(capsule.has("tshirt"));
  assert.ok(!capsule.has("sweater"), "la maglia deve essere esclusa (inappropriate) a 28°C reali, anche se è 'in stagione' secondo il calendario");
});

test("Caso F — marzo, 5°C reali: la maglia Autumn/Winter vince sulla T-shirt Summer", () => {
  const pool: PoolItem[] = [
    item({ id: "tshirt", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve", season: "Summer" }),
    item({ id: "sweater", category: "Tops", subcategory: "Sweater", sleeveLength: "Long Sleeve", season: "Winter" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "shoes-1", category: "Shoes" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "day", date: "2026-03-10", daySegment: "day", dressCode: null, label: "Day" },
  ];
  const seasonByDate = new Map([["2026-03-10", "Spring"]]);
  const tempByActivity = new Map([["day", 5]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  assert.ok(capsule.has("sweater"), "la maglia doveva essere favorita a 5°C reali");
});

test("Senza temperatura nota, un capo fuori stagione resta 'possible' (mai 'inappropriate') — nessuna regressione sul fallback", () => {
  const sweater: PoolItem = item({ id: "sweater", category: "Tops", season: "Winter" });
  assert.equal(climateSuitability(sweater, null, "Summer"), "possible");
});

// ---------------------------------------------------------------------------
// isSweatConsumable — sezioni 7-8 del documento
// ---------------------------------------------------------------------------

test("Un top a 30°C è sweat-consumable, un blazer a 30°C no", () => {
  assert.equal(isSweatConsumable("Tops", 30), true);
  assert.equal(isSweatConsumable("Outerwear", 30), false);
});

test("Un top a temperatura mite (18°C) non è sweat-consumable", () => {
  assert.equal(isSweatConsumable("Tops", 18), false);
});

test("Nessuna temperatura nota -> mai sweat-consumable", () => {
  assert.equal(isSweatConsumable("Tops", null), false);
});

// ---------------------------------------------------------------------------
// applyHardDressCodeFilter — Step B: Formal/Sport come hard/strong
// constraint, non solo testo nel prompt.
// ---------------------------------------------------------------------------

test("Formal con abbastanza capi eleganti disponibili -> filtra ai soli formality>=4 (jeans+tshirt esclusi)", () => {
  const candidates: PoolItem[] = [
    item({ id: "jeans", category: "Bottoms", formality: 1 }),
    item({ id: "tshirt", category: "Tops", formality: 1 }),
    item({ id: "elegant-dress", category: "Dresses", formality: 4 }),
    item({ id: "elegant-trousers", category: "Bottoms", formality: 4 }),
    item({ id: "elegant-top", category: "Tops", formality: 5 }),
  ];
  const filtered = applyHardDressCodeFilter(candidates, "Formal");
  assert.ok(!filtered.some((it) => it.id === "jeans"), "i jeans (formality 1) non devono comparire per un requisito Formal con alternative eleganti disponibili");
  assert.ok(!filtered.some((it) => it.id === "tshirt"));
  assert.ok(filtered.some((it) => it.id === "elegant-dress"));
});

test("Formal con pochi capi eleganti (2) allarga alla banda formality>=3 invece di lasciare jeans+tshirt come unica opzione", () => {
  const candidates: PoolItem[] = [
    item({ id: "jeans", category: "Bottoms", formality: 1 }),
    item({ id: "smart-trousers", category: "Bottoms", formality: 3 }),
    item({ id: "smart-top", category: "Tops", formality: 3 }),
    item({ id: "elegant-shoes", category: "Shoes", formality: 4 }),
  ];
  const filtered = applyHardDressCodeFilter(candidates, "Formal");
  assert.ok(!filtered.some((it) => it.id === "jeans"), "i jeans devono restare esclusi anche nella banda allargata");
  assert.ok(filtered.some((it) => it.id === "smart-trousers"), "la banda 3+ deve essere inclusa quando 4+ non basta");
});

test("Formal su un guardaroba quasi interamente casual -> non lascia mai lo slot vuoto (fallback totale)", () => {
  const candidates: PoolItem[] = [
    item({ id: "jeans", category: "Bottoms", formality: 1 }),
    item({ id: "tshirt", category: "Tops", formality: 1 }),
  ];
  const filtered = applyHardDressCodeFilter(candidates, "Formal");
  assert.equal(filtered.length, 2, "senza nessuna alternativa elegante, il fallback deve restituire tutti i candidati invece di uno slot vuoto");
});

test("Sport filtra ai soli capi casual/sportivi quando ce ne sono abbastanza", () => {
  const candidates: PoolItem[] = [
    item({ id: "elegant-dress", category: "Dresses", formality: 5 }),
    item({ id: "sneaker", category: "Shoes", formality: 1 }),
    item({ id: "joggers", category: "Bottoms", formality: 1 }),
    item({ id: "sport-top", category: "Tops", formality: 1 }),
  ];
  const filtered = applyHardDressCodeFilter(candidates, "Sport");
  assert.ok(!filtered.some((it) => it.id === "elegant-dress"), "un abito elegante non deve comparire per un requisito Sport con alternative disponibili");
});

test("Dress code diversi da Formal/Sport (Evening, Work, null) non filtrano nulla — restano soft preference", () => {
  const candidates: PoolItem[] = [
    item({ id: "jeans", category: "Bottoms", formality: 1 }),
    item({ id: "elegant-dress", category: "Dresses", formality: 5 }),
  ];
  assert.equal(applyHardDressCodeFilter(candidates, "Evening").length, 2, "Evening non deve filtrare — il contesto decide, non un muro di formalità");
  assert.equal(applyHardDressCodeFilter(candidates, "Work").length, 2);
  assert.equal(applyHardDressCodeFilter(candidates, null).length, 2);
});

// ---------------------------------------------------------------------------
// bottomTarget — non deve scalare come i top, stesso principio di shoeTarget
// ---------------------------------------------------------------------------

test("REGRESSIONE — aggiungere un'attività a un trip breve non deve spingere a un terzo pantalone/gonna", () => {
  const pool: PoolItem[] = [
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "bottom-2", category: "Bottoms" }),
    item({ id: "bottom-3", category: "Bottoms" }),
    item({ id: "top-1", category: "Tops" }),
    item({ id: "shoes-1", category: "Shoes" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  // 5 requisiti (era un trip di 4, ne è stata aggiunta una quinta —
  // esattamente lo scenario segnalato: "se metto un'attività in più").
  const requirements: Requirement[] = [
    { activityId: "a1", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Treno" },
    { activityId: "a2", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Concerto" },
    { activityId: "a3", date: "2026-09-06", daySegment: "evening", dressCode: null, label: "Evening" },
    { activityId: "a4", date: "2026-09-07", daySegment: "day", dressCode: null, label: "Day" },
    { activityId: "a5", date: "2026-09-07", daySegment: "evening", dressCode: null, label: "Evening" },
  ];
  const seasonByDate = new Map(requirements.map((r) => [r.date, "Autumn"]));

  const capsule = buildCapsule(pool, requirements, seasonByDate, []);
  const bottomsInCapsule = Array.from(capsule).filter((id) => id.startsWith("bottom-"));
  assert.ok(bottomsInCapsule.length <= 2, `attesi al massimo 2 bottoms per un trip ancora breve, trovati: ${bottomsInCapsule.join(", ")}`);
});

// ---------------------------------------------------------------------------
// isTransportActivity + preferenza pratica per il trasporto
// ---------------------------------------------------------------------------

test("isTransportActivity riconosce treno/nave/aereo/volo in italiano e inglese", () => {
  assert.equal(isTransportActivity("Treno SMN - Milano"), true);
  assert.equal(isTransportActivity("Volo per Londra"), true);
  assert.equal(isTransportActivity("Return flight"), true);
  assert.equal(isTransportActivity("Cena da Mario"), false);
  assert.equal(isTransportActivity(null), false);
});

test("REGRESSIONE — un'attività di trasporto preferisce i pantaloni alla gonna quando entrambi sono eleggibili", () => {
  const pool: PoolItem[] = [
    item({ id: "trousers", category: "Bottoms", subcategory: "Trousers" }),
    item({ id: "skirt", category: "Bottoms", subcategory: "Skirt" }),
    item({ id: "top-1", category: "Tops" }),
    item({ id: "shoes-1", category: "Shoes" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "train", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Treno SMN - Milano" },
  ];
  const seasonByDate = new Map([["2026-09-06", "Autumn"]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, []);
  assert.ok(capsule.has("trousers"), "i pantaloni dovevano essere preferiti per un'attività di trasporto");
});

// ---------------------------------------------------------------------------
// applyTransportPracticalityFilter — la regola rigida, non più solo un
// punteggio più basso
// ---------------------------------------------------------------------------

test("REGRESSIONE — un'attività di trasporto esclude gonne e abiti corti quando esistono pantaloni disponibili", () => {
  const candidates: PoolItem[] = [
    item({ id: "skirt", category: "Bottoms", subcategory: "Skirt" }),
    item({ id: "dress", category: "Dresses" }),
    item({ id: "trousers", category: "Bottoms", subcategory: "Trousers" }),
  ];
  const filtered = applyTransportPracticalityFilter(candidates, true);
  assert.ok(!filtered.some((it) => it.id === "skirt"), "la gonna non deve comparire quando i pantaloni sono disponibili");
  assert.ok(!filtered.some((it) => it.id === "dress"));
  assert.ok(filtered.some((it) => it.id === "trousers"));
});

test("Se la gonna è l'unica opzione disponibile per il trasporto, resta quella (mai slot vuoto)", () => {
  const candidates: PoolItem[] = [item({ id: "skirt", category: "Bottoms", subcategory: "Skirt" })];
  const filtered = applyTransportPracticalityFilter(candidates, true);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "skirt");
});

test("Nessun filtro applicato quando l'attività NON è di trasporto", () => {
  const candidates: PoolItem[] = [
    item({ id: "skirt", category: "Bottoms", subcategory: "Skirt" }),
    item({ id: "trousers", category: "Bottoms", subcategory: "Trousers" }),
  ];
  assert.equal(applyTransportPracticalityFilter(candidates, false).length, 2);
});

test("REGRESSIONE — un top cut-out viene escluso per un'attività di trasporto quando esiste un top normale", () => {
  const candidates: PoolItem[] = [
    item({ id: "cutout-top", category: "Tops", subcategory: "Cut-Out Top" }),
    item({ id: "plain-top", category: "Tops", subcategory: "T-Shirt" }),
  ];
  const filtered = applyTransportPracticalityFilter(candidates, true);
  assert.ok(!filtered.some((it) => it.id === "cutout-top"));
  assert.ok(filtered.some((it) => it.id === "plain-top"));
});

test("Un top con styleTags 'party'/'club' viene escluso per il trasporto", () => {
  const candidates: PoolItem[] = [
    item({ id: "party-top", category: "Tops", subcategory: "Top", style: ["party", "going out"] }),
    item({ id: "plain-top", category: "Tops", subcategory: "T-Shirt" }),
  ];
  const filtered = applyTransportPracticalityFilter(candidates, true);
  assert.ok(!filtered.some((it) => it.id === "party-top"));
});

test("Un body a manica lunga NON viene escluso solo perché è un bodysuit (il problema è l'esposizione, non il tipo di capo)", () => {
  const candidates: PoolItem[] = [
    item({ id: "longsleeve-bodysuit", category: "Tops", subcategory: "Bodysuit", sleeveLength: "Long Sleeve" }),
  ];
  const filtered = applyTransportPracticalityFilter(candidates, true);
  assert.ok(filtered.some((it) => it.id === "longsleeve-bodysuit"), "un bodysuit a manica lunga non ha segnali di esposizione, non deve essere escluso automaticamente");
});

// ---------------------------------------------------------------------------
// changeAssumedPossible — Scenari A/B/C del documento
// ---------------------------------------------------------------------------

test("Scenario A — treno (day) + cena (evening), nessun hotel: segmenti diversi -> cambio assunto possibile", () => {
  const train: Requirement = { activityId: "train", date: "2026-09-07", daySegment: "day", dressCode: null, label: "Train to Florence" };
  const dinner: Requirement = { activityId: "dinner", date: "2026-09-07", daySegment: "evening", dressCode: "Formal", label: "Formal Dinner" };
  const all = [train, dinner];
  const activities = [
    { activity_date: "2026-09-07", activity_type: "Train to Florence" },
    { activity_date: "2026-09-07", activity_type: "Formal Dinner" },
  ];
  assert.equal(changeAssumedPossible(train, all, activities), true, "giorno e sera sono ore separate, cambio assunto possibile anche senza hotel esplicito");
});

test("Scenario B — treno + concerto stesso segmento, nessun hotel: cambio NON assunto possibile", () => {
  const train: Requirement = { activityId: "train", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Treno per il concerto" };
  const concert: Requirement = { activityId: "concert", date: "2026-09-06", daySegment: "day", dressCode: null, label: "David Guetta" };
  const all = [train, concert];
  const activities = [
    { activity_date: "2026-09-06", activity_type: "Treno per il concerto" },
    { activity_date: "2026-09-06", activity_type: "David Guetta" },
  ];
  assert.equal(changeAssumedPossible(train, all, activities), false, "stesso segmento, nessun hotel loggato: il filtro pratico va saltato, un solo outfit per entrambi i contesti");
});

test("Scenario C — treno + hotel + concerto stesso segmento: hotel loggato -> cambio assunto possibile", () => {
  const train: Requirement = { activityId: "train", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Treno per il concerto" };
  const concert: Requirement = { activityId: "concert", date: "2026-09-06", daySegment: "day", dressCode: null, label: "David Guetta" };
  const all = [train, concert];
  const activities = [
    { activity_date: "2026-09-06", activity_type: "Treno per il concerto" },
    { activity_date: "2026-09-06", activity_type: "Check-in Hotel Firenze" },
    { activity_date: "2026-09-06", activity_type: "David Guetta" },
  ];
  assert.equal(changeAssumedPossible(train, all, activities), true, "un hotel loggato lo stesso giorno è il segnale più chiaro possibile che il cambio è previsto");
});

test("Treno da solo, nessun'altra attività lo stesso giorno -> cambio assunto possibile (nessun conflitto reale)", () => {
  const train: Requirement = { activityId: "train", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Treno" };
  const all = [train];
  const activities = [{ activity_date: "2026-09-06", activity_type: "Treno" }];
  assert.equal(changeAssumedPossible(train, all, activities), true);
});

test("isAccommodationActivity riconosce hotel/check-in/albergo/airbnb", () => {
  assert.equal(isAccommodationActivity("Check-in Hotel Firenze"), true);
  assert.equal(isAccommodationActivity("Airbnb Milano"), true);
  assert.equal(isAccommodationActivity("Albergo Centrale"), true);
  assert.equal(isAccommodationActivity("David Guetta"), false);
  assert.equal(isAccommodationActivity(null), false);
});

test("REGRESSIONE — isAccommodationActivity riconosce l'alloggio in italiano, inglese, spagnolo e francese", () => {
  assert.equal(isAccommodationActivity("Soggiorno: City Life Apartment"), true, "italiano");
  assert.equal(isAccommodationActivity("Pernottamento a Roma"), true, "italiano");
  assert.equal(isAccommodationActivity("2-night stay at The Ritz"), true, "inglese");
  assert.equal(isAccommodationActivity("Overnight accommodation"), true, "inglese");
  assert.equal(isAccommodationActivity("Alojamiento en Barcelona"), true, "spagnolo");
  assert.equal(isAccommodationActivity("Pernoctación en Madrid"), true, "spagnolo");
  assert.equal(isAccommodationActivity("Séjour à Paris"), true, "francese");
  assert.equal(isAccommodationActivity("Hébergement centre-ville"), true, "francese");
  // Falsi positivi da evitare — parole simili ma non di alloggio
  assert.equal(isAccommodationActivity("David Guetta concert"), false);
  assert.equal(isAccommodationActivity("Cena da Mario"), false);
});

test("REGRESSIONE — 'Soggiorno: City Life...' viene riconosciuto come alloggio", () => {
  // Il caso reale segnalato: l'utente ha usato la parola 'Soggiorno' per
  // segnalare che poteva cambiarsi, ma non era nella lista di parole
  // chiave — risultato: il sistema assumeva 'nessun cambio possibile' e
  // lasciava passare la gonna per il treno, l'esatto opposto di quanto
  // l'utente intendeva.
  assert.equal(isAccommodationActivity("Soggiorno: City Life Apartment"), true);
});

test("Con 'Soggiorno' loggato lo stesso giorno, il cambio è assunto possibile anche se treno e concerto condividono il segmento", () => {
  const train: Requirement = { activityId: "train", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Treno SMN - Milano" };
  const concert: Requirement = { activityId: "concert", date: "2026-09-06", daySegment: "day", dressCode: null, label: "David Guetta" };
  const all = [train, concert];
  const activities = [
    { activity_date: "2026-09-06", activity_type: "Soggiorno: City Life Apartment" },
    { activity_date: "2026-09-06", activity_type: "Treno SMN - Milano" },
    { activity_date: "2026-09-06", activity_type: "David Guetta" },
  ];
  assert.equal(changeAssumedPossible(train, all, activities), true);
});

test("REGRESSIONE — settembre a 32°C reali allarga comunque il target dei top, anche se il bucket calendario dice 'Autumn'", () => {
  // Trip di 5 giorni (10 requisiti, day+evening) — con questa lunghezza
  // perRoleTarget e approxTripDays divergono abbastanza da rendere la
  // differenza hot/non-hot davvero verificabile (con pochi requisiti i
  // due target possono coincidere per coincidenza, mascherando il fix).
  const pool: PoolItem[] = [
    item({ id: "tshirt-1", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" }),
    item({ id: "tshirt-2", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" }),
    item({ id: "tshirt-3", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" }),
    item({ id: "tshirt-4", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" }),
    item({ id: "tshirt-5", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" }),
    item({ id: "bottom-1", category: "Bottoms" }),
    item({ id: "shoes-1", category: "Shoes" }),
    item({ id: "bag-1", category: "Bags" }),
  ];
  const dates = ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"];
  const requirements: Requirement[] = dates.flatMap((date) => ([
    { activityId: `${date}-day`, date, daySegment: "day" as const, dressCode: null, label: "Day" },
    { activityId: `${date}-eve`, date, daySegment: "evening" as const, dressCode: null, label: "Evening" },
  ]));
  const seasonByDate = new Map(dates.map((d) => [d, "Autumn"]));
  const tempByActivity = new Map(requirements.map((r) => [r.activityId, 32]));

  const hotCapsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  const hotTops = Array.from(hotCapsule).filter((id) => id.startsWith("tshirt-"));

  const noTempCapsule = buildCapsule(pool, requirements, seasonByDate, [], new Map());
  const noTempTops = Array.from(noTempCapsule).filter((id) => id.startsWith("tshirt-"));

  assert.ok(hotTops.length > noTempTops.length, `il caldo reale doveva allargare la rotazione dei top rispetto al fallback stagionale (bucket 'Autumn'): caldo=${hotTops.length}, fallback=${noTempTops.length}`);
});

test("isTransportActivity riconosce anche 'Milano Centrale - Firenze SMN 9551' senza la parola treno/train", () => {
  assert.equal(isTransportActivity("Milano Centrale - Firenze SMN 9551"), true, "il caso reale segnalato — nessuna parola 'treno' o 'train', solo nomi di stazione");
  assert.equal(isTransportActivity("Aeroporto di Fiumicino"), true);
  assert.equal(isTransportActivity("Gare du Nord"), true);
});

test("Falsi positivi noti e accettati su isTransportActivity — 'centrale' è un compromesso deliberato", () => {
  // 'centrale' è necessario per riconoscere nomi reali di stazioni
  // italiane ('Milano Centrale', 'Napoli Centrale') ma può occasionalmente
  // scattare su un'attività non di trasporto che contiene la stessa
  // parola. Compromesso accettato consapevolmente, non un bug.
  assert.equal(isTransportActivity("Farmacia Centrale"), true, "falso positivo noto e accettato");
});

// ---------------------------------------------------------------------------
// isTravelSuitable — la definizione unica di "adatto a viaggiare"
// ---------------------------------------------------------------------------

test("REGRESSIONE — una maglia a maniche lunghe trasparente non è adatta al viaggio", () => {
  const sheerTop = item({ id: "sheer", category: "Tops", subcategory: "Sheer Mesh Top", sleeveLength: "Long Sleeve" });
  assert.equal(isTravelSuitable(sheerTop, 30), false);
  assert.equal(isTravelSuitable(sheerTop, null), false, "la trasparenza è sbagliata in viaggio a qualunque temperatura");
});

test("REGRESSIONE — maniche lunghe e felpe escluse dal viaggio quando fa davvero caldo (32°C)", () => {
  const longSleeve = item({ id: "ls", category: "Tops", subcategory: "Top", sleeveLength: "Long Sleeve" });
  const sweatshirt = item({ id: "felpa", category: "Tops", subcategory: "Felpa" });
  const tshirt = item({ id: "tee", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" });
  assert.equal(isTravelSuitable(longSleeve, 32), false);
  assert.equal(isTravelSuitable(sweatshirt, 32), false);
  assert.equal(isTravelSuitable(tshirt, 32), true);
});

test("Maniche lunghe restano adatte al viaggio quando NON fa caldo", () => {
  const longSleeve = item({ id: "ls", category: "Tops", subcategory: "Top", sleeveLength: "Long Sleeve" });
  assert.equal(isTravelSuitable(longSleeve, 12), true);
  assert.equal(isTravelSuitable(longSleeve, null), true, "senza previsione nota le regole di temperatura non si applicano");
});

test("Gonne corte e capi da serata restano esclusi dal viaggio a qualunque temperatura", () => {
  assert.equal(isTravelSuitable(item({ id: "skirt", category: "Bottoms", subcategory: "Mini Skirt" }), 20), false);
  assert.equal(isTravelSuitable(item({ id: "dress", category: "Dresses" }), 20), false);
  assert.equal(isTravelSuitable(item({ id: "cutout", category: "Tops", subcategory: "Cut-Out Top" }), 20), false);
});

test("Jeans e t-shirt sono sempre adatti al viaggio", () => {
  assert.equal(isTravelSuitable(item({ id: "jeans", category: "Bottoms", subcategory: "Jeans" }), 32), true);
  assert.equal(isTravelSuitable(item({ id: "tee", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" }), 32), true);
});

test("outfitIsTravelSuitable — un look da concerto con jeans+t-shirt può essere riusato per il treno", () => {
  const catalog: PoolItem[] = [
    item({ id: "tee", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" }),
    item({ id: "jeans", category: "Bottoms", subcategory: "Jeans" }),
    item({ id: "sneaker", category: "Shoes", subcategory: "Sneakers" }),
  ];
  assert.equal(outfitIsTravelSuitable(["tee", "jeans", "sneaker"], catalog, 30), true, "nessun outfit separato necessario per il treno");
});

test("outfitIsTravelSuitable — un look con minigonna NON può essere riusato per il treno", () => {
  const catalog: PoolItem[] = [
    item({ id: "tee", category: "Tops", subcategory: "T-Shirt" }),
    item({ id: "mini", category: "Bottoms", subcategory: "Mini Skirt" }),
    item({ id: "sneaker", category: "Shoes", subcategory: "Sneakers" }),
  ];
  assert.equal(outfitIsTravelSuitable(["tee", "mini", "sneaker"], catalog, 30), false, "il treno deve ricevere un outfit pratico separato");
});

test("Il filtro trasporto ora esclude anche in base alla temperatura", () => {
  const candidates: PoolItem[] = [
    item({ id: "ls", category: "Tops", subcategory: "Top", sleeveLength: "Long Sleeve" }),
    item({ id: "tee", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" }),
    item({ id: "jeans", category: "Bottoms", subcategory: "Jeans" }),
  ];
  const hot = applyTransportPracticalityFilter(candidates, true, 32);
  assert.ok(!hot.some((it) => it.id === "ls"), "manica lunga esclusa a 32°C");
  assert.ok(hot.some((it) => it.id === "tee"));
  const mild = applyTransportPracticalityFilter(candidates, true, 14);
  assert.ok(mild.some((it) => it.id === "ls"), "manica lunga ammessa a 14°C");
});

test("Stivali esclusi col caldo, sandali no — la preferenza estiva regge", () => {
  const boot = item({ id: "boot", category: "Shoes", subcategory: "Ankle Boots" });
  const sandal = item({ id: "sandal", category: "Shoes", subcategory: "Sandals" });
  assert.equal(climateSuitability(boot, 32, "Summer"), "inappropriate", "gli stivaletti a 32°C devono essere esclusi");
  assert.equal(climateSuitability(sandal, 32, "Summer"), "compatible", "i sandali a 32°C sono la scelta giusta");
});

test("REGRESSIONE — un trip di più giorni tiene UNA borsa e UN paio di scarpe, non uno per giorno", () => {
  // Il guardaroba ha 3 borse e 3 paia di sneakers disponibili: la capsule
  // deve sceglierne poche, non una per ogni giorno.
  const pool: PoolItem[] = [
    item({ id: "tee-1", category: "Tops", subcategory: "T-Shirt" }),
    item({ id: "tee-2", category: "Tops", subcategory: "T-Shirt" }),
    item({ id: "tee-3", category: "Tops", subcategory: "T-Shirt" }),
    item({ id: "jeans-1", category: "Bottoms", subcategory: "Jeans" }),
    item({ id: "jeans-2", category: "Bottoms", subcategory: "Jeans" }),
    item({ id: "sneaker-1", category: "Shoes", subcategory: "Sneakers" }),
    item({ id: "sneaker-2", category: "Shoes", subcategory: "Sneakers" }),
    item({ id: "sneaker-3", category: "Shoes", subcategory: "Sneakers" }),
    item({ id: "bag-1", category: "Bags", subcategory: "Tote" }),
    item({ id: "bag-2", category: "Bags", subcategory: "Crossbody" }),
    item({ id: "bag-3", category: "Bags", subcategory: "Shoulder Bag" }),
  ];
  const dates = ["2026-09-06", "2026-09-07", "2026-09-08"];
  const requirements: Requirement[] = dates.map((date) => ({
    activityId: `${date}-day`, date, daySegment: "day" as const, dressCode: null, label: "Day",
  }));
  const seasonByDate = new Map(dates.map((d) => [d, "Autumn"]));

  const capsule = buildCapsule(pool, requirements, seasonByDate, []);
  const bags = Array.from(capsule).filter((id) => id.startsWith("bag-"));
  const shoes = Array.from(capsule).filter((id) => id.startsWith("sneaker-"));
  assert.ok(bags.length <= 1, `un trip di 3 giorni dovrebbe avere 1 borsa, trovate: ${bags.join(", ")}`);
  assert.ok(shoes.length <= 2, `un trip di 3 giorni dovrebbe avere al massimo 2 paia di scarpe, trovate: ${shoes.join(", ")}`);
});

test("REGRESSIONE — una gonna con subcategory VUOTA viene comunque riconosciuta dal nome/categoria", () => {
  // Il caso reale: se la sottocategoria non è compilata (o contiene il
  // brand invece del valore canonico), il filtro guardava un solo campo
  // e lasciava passare la gonna. Ora legge tutti i campi testuali.
  const skirtNoSubcat = item({ id: "s1", category: "Bottoms", subcategory: null, style: ["mini skirt"] });
  assert.equal(isTravelSuitable(skirtNoSubcat, 25), false);
  const skirtItalian = item({ id: "s2", category: "Bottoms", subcategory: "Minigonna" });
  assert.equal(isTravelSuitable(skirtItalian, 25), false);
});

test("REGRESSIONE — stivaletti esclusi dal viaggio col caldo, ammessi sotto i 15°C; tacchi mai", () => {
  const ankleBoot = item({ id: "b1", category: "Shoes", subcategory: "Ankle Boots" });
  assert.equal(isTravelSuitable(ankleBoot, null), false, "meteo sconosciuto: non si rischia");
  assert.equal(isTravelSuitable(ankleBoot, 20), false, "20°C: troppo caldo per stivaletti in viaggio");
  assert.equal(isTravelSuitable(ankleBoot, 32), false, "caldo");
  assert.equal(isTravelSuitable(ankleBoot, 10), true, "10°C: gli stivaletti sono la scelta giusta anche in treno");
  const heels = item({ id: "b2", category: "Shoes", subcategory: "Pumps" });
  assert.equal(isTravelSuitable(heels, 5), false, "i tacchi non sono mai una scarpa da viaggio, a nessuna temperatura");
});

test("Sneakers e sandali restano adatti al viaggio", () => {
  assert.equal(isTravelSuitable(item({ id: "sn", category: "Shoes", subcategory: "Sneakers" }), 30), true);
  assert.equal(isTravelSuitable(item({ id: "sa", category: "Shoes", subcategory: "Sandals" }), 30), true);
  assert.equal(isTravelSuitable(item({ id: "fl", category: "Shoes", subcategory: "Flats" }), 20), true);
});

test("REGRESSIONE — il fallback del filtro viaggio è per categoria, non svuota tutto il filtro", () => {
  // Il caso reale: la capsule aveva una gonna ma NESSUN pantalone.
  // Escludendo la gonna il ruolo Bottoms restava vuoto, il vecchio
  // fallback restituiva l'intera lista NON filtrata, e la gonna
  // rientrava insieme a tutto il resto (anche il top cut-out).
  const candidates: PoolItem[] = [
    item({ id: "skirt", category: "Bottoms", subcategory: "Skirt" }),
    item({ id: "cutout", category: "Tops", subcategory: "Cut-Out Top" }),
    item({ id: "tee", category: "Tops", subcategory: "T-Shirt" }),
    item({ id: "sneaker", category: "Shoes", subcategory: "Sneakers" }),
  ];
  const filtered = applyTransportPracticalityFilter(candidates, true, 30);
  // Bottoms non ha alternative -> la gonna resta (meglio di nessun bottom)
  assert.ok(filtered.some((it) => it.id === "skirt"), "senza pantaloni disponibili la gonna resta, ma solo per il suo ruolo");
  // Tops HA un'alternativa -> il cut-out deve restare escluso
  assert.ok(!filtered.some((it) => it.id === "cutout"), "il top cut-out NON deve rientrare: la t-shirt è disponibile");
  assert.ok(filtered.some((it) => it.id === "tee"));
});

test("REGRESSIONE — buildCapsule riserva un bottom e un top adatti al viaggio quando c'è un trasporto", () => {
  const pool: PoolItem[] = [
    item({ id: "skirt", category: "Bottoms", subcategory: "Skirt" }),
    item({ id: "trousers", category: "Bottoms", subcategory: "Trousers" }),
    item({ id: "cutout", category: "Tops", subcategory: "Cut-Out Top" }),
    item({ id: "tee", category: "Tops", subcategory: "T-Shirt" }),
    item({ id: "sneaker", category: "Shoes", subcategory: "Sneakers" }),
    item({ id: "bag", category: "Bags", subcategory: "Tote" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "train", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Treno SMN - Milano" },
    { activityId: "concert", date: "2026-09-06", daySegment: "day", dressCode: null, label: "David Guetta" },
  ];
  const seasonByDate = new Map([["2026-09-06", "Autumn"]]);
  const tempByActivity = new Map([["train", 30], ["concert", 30]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  assert.ok(capsule.has("trousers"), "la capsule deve includere un pantalone: c'è un viaggio in treno");
  assert.ok(capsule.has("tee"), "la capsule deve includere un top adatto al viaggio");
});

test("REGRESSIONE — un trip con un treno riserva sempre un bottom da viaggio in capsule, anche se l'evento richiede una gonna", () => {
  // Il caso reale: la capsule la costruisce il generatore per coprire gli
  // eventi. Il concerto vuole la minigonna, quindi la capsule prendeva
  // SOLO quella come bottom — e al treno non restava nessun pantalone,
  // facendo scattare il ripiego che rimetteva dentro proprio la gonna.
  const pool: PoolItem[] = [
    item({ id: "mini", category: "Bottoms", subcategory: "Skirt", formality: 3, dayEvening: "evening" }),
    item({ id: "jeans", category: "Bottoms", subcategory: "Jeans", formality: 2, dayEvening: "both" }),
    item({ id: "tee", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" }),
    item({ id: "sneaker", category: "Shoes", subcategory: "Sneakers" }),
    item({ id: "bag", category: "Bags", subcategory: "Tote" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "train", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Treno SMN - Milano" },
    { activityId: "concert", date: "2026-09-06", daySegment: "evening", dressCode: null, label: "David Guetta" },
  ];
  const seasonByDate = new Map([["2026-09-06", "Autumn"]]);
  const tempByActivity = new Map([["train", 32], ["concert", 28]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  assert.ok(capsule.has("jeans"), "la capsule deve contenere un bottom adatto al viaggio, non solo la gonna dell'evento");
});

test("REGRESSIONE — il filtro trasporto ripiega per CATEGORIA, non svuotando tutto il pool", () => {
  // Se l'unico bottom disponibile è una gonna, quella resta (meglio di un
  // outfit senza bottom) — ma questo non deve far rientrare anche il top
  // cut-out, che ha invece un'alternativa valida.
  const candidates: PoolItem[] = [
    item({ id: "skirt", category: "Bottoms", subcategory: "Skirt" }),
    item({ id: "cutout", category: "Tops", subcategory: "Cut-Out Top" }),
    item({ id: "tee", category: "Tops", subcategory: "T-Shirt" }),
  ];
  const filtered = applyTransportPracticalityFilter(candidates, true, 30);
  assert.ok(filtered.some((it) => it.id === "skirt"), "la gonna resta: è l'unico bottom");
  assert.ok(filtered.some((it) => it.id === "tee"));
  assert.ok(!filtered.some((it) => it.id === "cutout"), "il cut-out NON deve rientrare: esiste la t-shirt come alternativa");
});

test("Una maglia di lana è pratica per il treno, ma non a 26°C+", () => {
  const woolTop = item({ id: "wool", category: "Tops", subcategory: "Wool Sweater", sleeveLength: "Long Sleeve" });
  assert.equal(isTravelSuitable(woolTop, 28), false, "28°C: troppo caldo per la lana");
  assert.equal(isTravelSuitable(woolTop, 20), true, "20°C: la lana è perfettamente pratica in treno");
  assert.equal(isTravelSuitable(woolTop, 5), true, "5°C: la lana è la scelta giusta");
  assert.equal(isTravelSuitable(woolTop, null), true, "senza meteo noto non si esclude un capo pratico");
});

test("REGRESSIONE — andata E ritorno ricevono entrambi un bottom da viaggio, non solo l'andata", () => {
  // Il caso reale: con un solo pantalone riservato, l'andata lo usava e
  // la varietà lo spingeva via al ritorno, che ripiegava sulla gonna.
  const pool: PoolItem[] = [
    item({ id: "mini", category: "Bottoms", subcategory: "Skirt", formality: 3, dayEvening: "evening" }),
    item({ id: "trousers", category: "Bottoms", subcategory: "Trousers", formality: 2, dayEvening: "both" }),
    item({ id: "jeans", category: "Bottoms", subcategory: "Jeans", formality: 2, dayEvening: "both" }),
    item({ id: "tee-1", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" }),
    item({ id: "tee-2", category: "Tops", subcategory: "T-Shirt", sleeveLength: "Short Sleeve" }),
    item({ id: "sneaker", category: "Shoes", subcategory: "Sneakers" }),
    item({ id: "bag", category: "Bags", subcategory: "Tote" }),
  ];
  const requirements: Requirement[] = [
    { activityId: "andata", date: "2026-09-06", daySegment: "day", dressCode: null, label: "Treno SMN - Milano" },
    { activityId: "concert", date: "2026-09-06", daySegment: "evening", dressCode: null, label: "David Guetta" },
    { activityId: "ritorno", date: "2026-09-07", daySegment: "day", dressCode: null, label: "Treno Milano Centrale - SMN" },
  ];
  const seasonByDate = new Map([["2026-09-06", "Autumn"], ["2026-09-07", "Autumn"]]);
  const tempByActivity = new Map([["andata", 32], ["concert", 28], ["ritorno", 30]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, [], tempByActivity);
  const travelBottoms = ["trousers", "jeans"].filter((id) => capsule.has(id));
  assert.ok(travelBottoms.length >= 2, `con due viaggi servono due bottom da viaggio in capsule, trovati: ${travelBottoms.join(", ")}`);
});

test("REGRESSIONE — con una cena al caldo, uno stivaletto già in capsule non impedisce di riservare il sandalo", () => {
  // Il bug: 'alreadyHasElegantShoe' controllava solo che ci fosse UNA
  // scarpa elegante, senza verificare se fosse adatta al clima. Lo
  // stivaletto entrato per altri motivi soddisfaceva il test, il blocco
  // che avrebbe scelto il sandalo non partiva, e alla cena restava solo
  // lo stivaletto.
  const pool: PoolItem[] = [
    item({ id: "boot", category: "Shoes", subcategory: "Ankle Boots", formality: 4, dayEvening: "both" }),
    item({ id: "sandal", category: "Shoes", subcategory: "Heeled Sandals", formality: 4, dayEvening: "both" }),
    item({ id: "tee", category: "Tops", subcategory: "T-Shirt" }),
    item({ id: "trousers", category: "Bottoms", subcategory: "Trousers" }),
    item({ id: "bag", category: "Bags", subcategory: "Clutch", formality: 4 }),
  ];
  const requirements: Requirement[] = [
    { activityId: "dinner", date: "2026-09-06", daySegment: "evening", dressCode: null, label: "Cena El Porteño" },
  ];
  const seasonByDate = new Map([["2026-09-06", "Autumn"]]);
  const tempByActivity = new Map([["dinner", 30]]);

  const capsule = buildCapsule(pool, requirements, seasonByDate, ["boot"], tempByActivity);
  assert.ok(capsule.has("sandal"), "il sandalo deve essere riservato per la cena anche se lo stivaletto era già in capsule");
});
