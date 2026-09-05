// AURA — violatesSleeveClimate: unit test
//
// COME ESEGUIRLI:
//   npx esbuild src/lib/outfit-weather-rules.test.ts --bundle --platform=node --format=esm --outfile=/tmp/owr-test.mjs
//   node /tmp/owr-test.mjs
//
// (aggiunti a outfit-weather-rules.test.ts esistente — vedi in fondo)

import test from "node:test";
import assert from "node:assert/strict";
import { violatesSleeveClimate, MILD_WARM_THRESHOLD_C, MILD_COOL_THRESHOLD_C, violatesWeatherRule } from "./outfit-weather-rules";

const catalog = [
  { id: "tshirt", category: "Tops", sleeveLength: "Short Sleeve" },
  { id: "shirt", category: "Tops", sleeveLength: "Long Sleeve" },
  { id: "shoes", category: "Shoes", sleeveLength: "" },
];

test("REGRESSIONE — camicia a manica lunga scelta per una sera fresca quando la t-shirt era disponibile e inutilizzata -> violazione", () => {
  assert.equal(violatesSleeveClimate(["shirt", "shoes"], catalog, MILD_COOL_THRESHOLD_C - 1), false);
  // sopra: manica lunga con clima fresco è la scelta CORRETTA, non deve mai essere una violazione
});

test("REGRESSIONE — t-shirt scelta per un giorno caldo quando la camicia a manica lunga era disponibile e inutilizzata -> nessuna violazione (scelta corretta)", () => {
  assert.equal(violatesSleeveClimate(["tshirt", "shoes"], catalog, MILD_WARM_THRESHOLD_C + 1), false);
});

test("Il caso reale segnalato: manica lunga scelta per un giorno CALDO quando la t-shirt era disponibile e inutilizzata -> violazione", () => {
  assert.equal(violatesSleeveClimate(["shirt", "shoes"], catalog, MILD_WARM_THRESHOLD_C + 1), true);
});

test("T-shirt scelta per una sera FRESCA quando la camicia a manica lunga era disponibile e inutilizzata -> violazione", () => {
  assert.equal(violatesSleeveClimate(["tshirt", "shoes"], catalog, MILD_COOL_THRESHOLD_C - 1), true);
});

test("Nessuna violazione se il top scelto è l'UNICO disponibile, anche se climaticamente non ideale", () => {
  const onlyLongSleeve = [{ id: "shirt", category: "Tops", sleeveLength: "Long Sleeve" }, { id: "shoes", category: "Shoes", sleeveLength: "" }];
  assert.equal(violatesSleeveClimate(["shirt", "shoes"], onlyLongSleeve, MILD_WARM_THRESHOLD_C + 5), false, "senza alternativa disponibile non è una violazione, è l'unica scelta possibile");
});

test("Nessuna temperatura nota -> mai violazione", () => {
  assert.equal(violatesSleeveClimate(["shirt", "shoes"], catalog, null), false);
});

test("Temperatura mite (né calda né fredda) -> mai violazione", () => {
  const mild = (MILD_WARM_THRESHOLD_C + MILD_COOL_THRESHOLD_C) / 2;
  assert.equal(violatesSleeveClimate(["shirt", "shoes"], catalog, mild), false);
});

test("Categorie non-Tops/Dresses (scarpe, borse) non sono mai coinvolte nel controllo", () => {
  const shoeOnly = [{ id: "boot", category: "Shoes", sleeveLength: "" }];
  assert.equal(violatesSleeveClimate(["boot"], shoeOnly, MILD_WARM_THRESHOLD_C + 5), false);
});

test("REGRESSIONE — una felpa (sweatshirt) a 32°C reali viola la regola meteo hard", () => {
  const sweatshirt = { category: "Tops", subcategory: "Felpa" };
  const tshirt = { category: "Tops", subcategory: "T-Shirt" };
  assert.equal(violatesWeatherRule(sweatshirt, 32), true, "una felpa a 32°C deve violare la regola hard — prima del fix HEAVY_SIGNAL non la riconosceva affatto");
  assert.equal(violatesWeatherRule(tshirt, 32), false, "una t-shirt a 32°C non deve violare nulla");
});
