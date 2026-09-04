// AURA — calendar-sync-diff: unit test
//
// COME ESEGUIRLI:
//   npx esbuild src/lib/calendar-sync-diff.test.ts --bundle --platform=node --format=esm --outfile=/tmp/csd-test.mjs
//   node /tmp/csd-test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { computeRemovedEventIds } from "./calendar-sync-diff";

test("un evento presente prima e assente ora → rilevato come rimosso", () => {
  const removed = computeRemovedEventIds(["a", "b", "c"], ["a", "c"]);
  assert.deepEqual(removed, ["b"]);
});

test("nessun evento rimosso → array vuoto", () => {
  const removed = computeRemovedEventIds(["a", "b"], ["a", "b", "c"]);
  assert.deepEqual(removed, []);
});

test("cache precedente vuota → nulla può essere rimosso", () => {
  assert.deepEqual(computeRemovedEventIds([], ["a", "b"]), []);
});

test("fetch attuale vuoto → tutto il precedente risulta rimosso", () => {
  assert.deepEqual(computeRemovedEventIds(["a", "b"], []), ["a", "b"]);
});

test("id duplicato nella lista precedente non produce doppioni nel risultato", () => {
  const removed = computeRemovedEventIds(["a", "a", "b"], []);
  assert.deepEqual(removed, ["a", "b"]);
});

test("un evento rimosso e poi ricomparso in un fetch successivo non è più 'rimosso'", () => {
  // Simula due sync consecutivi: nel primo "b" sparisce, nel secondo
  // ricompare — il chiamante deve ripartire da previouslyCachedIds
  // aggiornato (righe con removed_from_source=false), non dalla lista
  // originale, quindi qui verifichiamo solo che l'assenza di "b" tra i
  // previouslyCachedIds passati non lo faccia comparire come rimosso.
  const removedAfterFirstSync = computeRemovedEventIds(["a", "b"], ["a"]);
  assert.deepEqual(removedAfterFirstSync, ["b"]);
  // Il secondo sync riceve solo gli id NON già marcati removed (query
  // .eq("removed_from_source", false) lato server) — "b" non è più tra
  // i previouslyCachedIds passati alla funzione.
  const removedAfterSecondSync = computeRemovedEventIds(["a"], ["a", "b"]);
  assert.deepEqual(removedAfterSecondSync, []);
});
