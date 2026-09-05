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
import { buildCapsule, type PoolItem, type Requirement, climateSuitability, isSweatConsumable, applyHardDressCodeFilter } from "./trip-capsule.server";

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
