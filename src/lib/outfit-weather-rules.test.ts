// AURA — outfit-weather-rules: unit test
//
// COME ESEGUIRLI:
//   npx esbuild src/lib/outfit-weather-rules.test.ts --bundle --platform=node --format=esm --outfile=/tmp/owr-test.mjs
//   node /tmp/owr-test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { violatesWeatherRule, anyItemViolatesWeather, HOT_THRESHOLD_C, COLD_THRESHOLD_C } from "./outfit-weather-rules";

test("nessuna temperatura → mai violazione (nessuna opinione senza dati)", () => {
  assert.equal(violatesWeatherRule({ subcategory: "Sweater" }, null), false);
});

test("REGRESSIONE — maglione di lana con subcategory generica passa solo grazie al campo material", () => {
  // Prima del fix, il validator di Home non guardava affatto `material` —
  // esattamente il caso che ha causato il bug segnalato.
  const item = { category: "Tops", subcategory: "Knitwear", material: ["Wool"], styleTags: [] };
  assert.equal(violatesWeatherRule(item, 30), true, "un capo di lana a 30°C deve essere escluso anche senza la parola 'sweater' nel subcategory");
});

test("REGRESSIONE — season multi-valore 'Autumn, Winter' deve matchare con .includes(), non ===", () => {
  const item = { category: "Bottoms", subcategory: "Trousers", season: "Autumn, Winter", material: [] };
  assert.equal(violatesWeatherRule(item, HOT_THRESHOLD_C), true);
});

test("capo leggero a temperatura calda → non viola", () => {
  const item = { category: "Tops", subcategory: "Tank Top", material: ["Cotton"], season: "Summer" };
  assert.equal(violatesWeatherRule(item, 30), false);
});

test("scarpa open toe con freddo → viola", () => {
  const item = { category: "Shoes", subcategory: "Sandals", toeShape: "Open Toe" };
  assert.equal(violatesWeatherRule(item, COLD_THRESHOLD_C), true);
});

test("capo leggero (season summer) con freddo → viola", () => {
  const item = { category: "Tops", subcategory: "Tank Top", season: "Summer" };
  assert.equal(violatesWeatherRule(item, 5), true);
});

test("temperatura mite (né calda né fredda) → mai violazione", () => {
  const item = { category: "Tops", subcategory: "Sweater", material: ["Wool"] };
  assert.equal(violatesWeatherRule(item, 18), false);
});

test("anyItemViolatesWeather: un solo capo su più id che viola basta a far scattare true", () => {
  const catalog = [
    { id: "a", category: "Tops", subcategory: "Tank Top" },
    { id: "b", category: "Outerwear", subcategory: "Coat", material: ["Wool"] },
  ];
  assert.equal(anyItemViolatesWeather(["a", "b"], catalog, 30), true);
  assert.equal(anyItemViolatesWeather(["a"], catalog, 30), false);
});

test("id non trovato nel catalog → ignorato, non crasha", () => {
  const catalog = [{ id: "a", category: "Tops" }];
  assert.equal(anyItemViolatesWeather(["missing-id"], catalog, 30), false);
});
