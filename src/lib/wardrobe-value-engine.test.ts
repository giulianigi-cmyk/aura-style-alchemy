// AURA — Wardrobe Value Engine: unit test
//
// Usa SOLO node:test + node:assert/strict — già disponibili in Node 18+,
// nessuna nuova dipendenza da aggiungere a package.json (niente vitest/jest
// da installare, niente lockfile da toccare dal GitHub mobile editor).
//
// COME ESEGUIRLI:
//   npx esbuild src/lib/wardrobe-value-engine.test.ts --bundle --platform=node --format=esm --outfile=/tmp/wve-test.mjs
//   node /tmp/wve-test.mjs
//
// I 9 casi ricalcano esattamente quelli approvati in
// docs/features/wardrobe-value-engine-calibration.md — se qualcuno cambia
// un floor/tau/modifier in futuro, questi test devono fallire finché non
// si aggiornano consapevolmente insieme al documento di calibrazione.

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeItemValuation,
  type ValuationConfig,
  type ValuationInput,
} from "./wardrobe-value-engine";

const NOW = new Date("2026-09-03T00:00:00");

// Sottoinsieme del seed reale (sql_value_engine_v3.sql), solo le righe
// necessarie ai 9 casi di calibrazione — tenerlo sincronizzato con la SQL.
const CONFIG: ValuationConfig = {
  categoryProfiles: [
    { category: "Bags", subcategory: null, floor: 0.65, tau_years: 10, wear_expected_life_wears: 400, wear_max_penalty: 0.08, default_iconicity: null, evidence_floor: "derived" },
    { category: "Outerwear", subcategory: "Leather Jacket", floor: 0.45, tau_years: 7, wear_expected_life_wears: 250, wear_max_penalty: 0.12, default_iconicity: "timeless", evidence_floor: "assumption" },
    { category: "Tops", subcategory: "T-Shirt", floor: 0.08, tau_years: 1.5, wear_expected_life_wears: 60, wear_max_penalty: 0.40, default_iconicity: "basic", evidence_floor: "assumption" },
    { category: "Shoes", subcategory: null, floor: 0.35, tau_years: 5, wear_expected_life_wears: 80, wear_max_penalty: 0.45, default_iconicity: null, evidence_floor: "derived" },
    { category: "Accessories", subcategory: "Watch", floor: 0.35, tau_years: 6, wear_expected_life_wears: 600, wear_max_penalty: 0.05, default_iconicity: null, evidence_floor: "assumption" },
  ],
  brandModifiers: [
    { brand: "Rolex", category: "Accessories", subcategory: "Watch", modifier: 1.30, evidence: "derived" },
  ],
  materialModifiers: [
    { material: "Leather", modifier: 1.05 },
  ],
  modelProfiles: [
    { brand: "Chanel", model: "Classic Flap", category: "Bags", subcategory: null, floor: 0.80, ceiling: 0.94, tau_years: 15, wear_expected_life_wears: 400, wear_max_penalty: 0.08, evidence_tier: "market_evidence" },
    { brand: "Prada", model: "Re-Edition", category: "Bags", subcategory: null, floor: 1.09, ceiling: 1.09, tau_years: 10, wear_expected_life_wears: 400, wear_max_penalty: 0.08, evidence_tier: "market_evidence" },
    { brand: "Rolex", model: "Submariner", category: "Accessories", subcategory: "Watch", floor: 0.95, ceiling: 1.15, tau_years: 15, wear_expected_life_wears: 600, wear_max_penalty: 0.05, evidence_tier: "market_evidence" },
  ],
  sizeModifiers: [],
};

function baseInput(overrides: Partial<ValuationInput>): ValuationInput {
  return { price: null, purchaseDate: null, now: NOW, ...overrides };
}

test("1. Chanel Classic Flap — MODEL_MARKET_EVIDENCE, HIGH/HIGH, no market premium (94% ceiling < 100%)", () => {
  const r = computeItemValuation(
    baseInput({
      price: 5000, currentRetailPrice: 10000, currentRetailSource: "user",
      purchaseDate: "2021-01-01", brand: "Chanel", model: "Classic Flap", category: "Bags",
      wornCount: 20,
    }),
    CONFIG
  );
  assert.equal(r.level, "model_market_evidence");
  assert.equal(r.dataConfidence, "high");
  assert.equal(r.valuationConfidence, "high");
  assert.equal(r.anchorType, "current_retail");
  assert.equal(r.marketPremium, false); // ceiling 0.94 < 1.0, mai premium
  assert.ok(r.resaleHigh! <= 10000); // plausibility: mai sopra il retail qui
  assert.ok(r.resaleLow! > 7000 && r.resaleHigh! < 10500);
});

test("2. Chanel T-Shirt — CATEGORY_SUBCATEGORY, LOW valuation confidence (assumption floor, nessun anchor reale)", () => {
  const r = computeItemValuation(
    baseInput({ price: 500, purchaseDate: "2021-01-01", brand: "Chanel", category: "Tops", subcategory: "T-Shirt", wornCount: 150 }),
    CONFIG
  );
  assert.equal(r.level, "category_subcategory");
  assert.equal(r.valuationConfidence, "low");
  assert.equal(r.anchorType, "purchase_price");
  assert.ok(r.resaleHigh! < 100); // crollo marcato atteso
});

test("3. SL Leather Jacket — CATEGORY_SUBCATEGORY, retail verificato porta a MEDIUM valuation (non HIGH)", () => {
  const r = computeItemValuation(
    baseInput({
      price: 3500, currentRetailPrice: 5000, currentRetailSource: "user",
      purchaseDate: "2021-01-01", brand: "Saint Laurent", category: "Outerwear", subcategory: "Leather Jacket",
      materials: ["Leather"], wornCount: 15,
    }),
    CONFIG
  );
  assert.equal(r.level, "category_subcategory"); // nessun brand modifier SL x Outerwear seedato
  assert.equal(r.dataConfidence, "high");
  assert.equal(r.valuationConfidence, "medium"); // separazione data/valuation confidence
  assert.ok(r.resaleHigh! <= 5000);
});

test("7. Rolex generico (no model) — BRAND_CATEGORY, MEDIUM confermato", () => {
  const r = computeItemValuation(
    baseInput({ price: 8000, purchaseDate: "2021-01-01", brand: "Rolex", category: "Accessories", subcategory: "Watch", wornCount: 50 }),
    CONFIG
  );
  assert.equal(r.level, "brand_category");
  assert.equal(r.valuationConfidence, "medium");
  assert.equal(r.anchorType, "purchase_price"); // nessun retail noto
});

test("9. Fast-fashion T-shirt — LOW confermato anche con dati non scarsi", () => {
  const r = computeItemValuation(
    baseInput({ price: 50, purchaseDate: "2021-01-01", category: "Tops", subcategory: "T-Shirt", wornCount: 150 }),
    CONFIG
  );
  assert.equal(r.valuationConfidence, "low");
  assert.equal(r.dataConfidence, "medium"); // price+date+category ok, ma niente brand/model/retail
});

test("5. Prada Re-Edition — market premium consentito, ceiling sourced > 1.0", () => {
  const r = computeItemValuation(
    baseInput({
      price: 1500, currentRetailPrice: 1500, currentRetailSource: "user",
      purchaseDate: "2022-01-01", brand: "Prada", model: "Re-Edition", category: "Bags", wornCount: 30,
    }),
    CONFIG
  );
  assert.equal(r.level, "model_market_evidence");
  assert.equal(r.marketPremium, true); // resale_center > anchor, sourced (109%)
  assert.ok(r.resaleHigh! > 1500); // NON clampato, a differenza del caso 1
});

test("6. Rolex Submariner steel — MODEL, nessun brand modifier stackato sopra la curva", () => {
  const r = computeItemValuation(
    baseInput({
      price: 8000, currentRetailPrice: 8000, currentRetailSource: "user",
      purchaseDate: "2021-01-01", brand: "Rolex", model: "Submariner", category: "Accessories", subcategory: "Watch",
      wornCount: 100,
    }),
    CONFIG
  );
  assert.equal(r.level, "model_market_evidence");
  // Se il brand modifier (1.30) fosse stato applicato ANCHE qui sopra la
  // curva del modello, market_value_factor supererebbe abbondantemente
  // 1.3 — verifichiamo che NON sia così (niente stacking).
  assert.ok(r.marketValueFactor! < 1.2, `market_value_factor troppo alto: ${r.marketValueFactor} — possibile stacking brand×model`);
});

test("8. Designer shoes — CATEGORY bare, LOW anche con floor derived (nessuna subcategory/brand)", () => {
  const r = computeItemValuation(
    baseInput({ price: 800, purchaseDate: "2021-01-01", category: "Shoes", wornCount: 150 }),
    CONFIG
  );
  assert.equal(r.level, "category"); // Shoes non ha subcategory seedate
  assert.equal(r.valuationConfidence, "low"); // CATEGORY bare = sempre low, indipendentemente dall'evidenza del floor
});

test("Nessuna purchase_date → level 'none', nessuna stima inventata", () => {
  const r = computeItemValuation(baseInput({ price: 500, category: "Bags" }), CONFIG);
  assert.equal(r.level, "none");
  assert.equal(r.resaleLow, null);
  assert.equal(r.resaleHigh, null);
});

test("current_retail_source non anchor-eligible → fallback su purchase_price", () => {
  const r = computeItemValuation(
    baseInput({
      price: 1000, currentRetailPrice: 5000, currentRetailSource: "ai_lookup_unverified",
      purchaseDate: "2021-01-01", category: "Bags", wornCount: 5,
    }),
    CONFIG
  );
  assert.equal(r.anchorType, "purchase_price");
  assert.equal(r.anchorValue, 1000);
});

test("Plausibility: senza market premium sourced, resale_high non supera mai il retail verificato", () => {
  const r = computeItemValuation(
    baseInput({
      price: 100, currentRetailPrice: 200, currentRetailSource: "user",
      purchaseDate: "2026-08-01", category: "Bags", brand: "Hermès", wornCount: 0,
    }),
    CONFIG
  );
  assert.ok(r.resaleHigh! <= 200, `resaleHigh (${r.resaleHigh}) ha superato il retail senza essere un market premium sourced`);
});
