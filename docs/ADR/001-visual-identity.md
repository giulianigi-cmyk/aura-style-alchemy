# AURA — Architecture Decisions: Fashion Identity Layer

> Da committare in `docs/ADR/001-visual-identity.md`
> Scopo di questo documento: **solo decisioni**. Nessun benchmark, nessuna roadmap, nessuna discussione — quelli vivono in documenti separati.
> Stato aggiornato in fondo al documento.

---

## Contesto in una frase

AURA deve capire se una foto mostra un capo già presente nel guardaroba dell'utente. Serve un embedding visivo come *raffinamento* della deduplicazione, non come primo criterio decisionale.

---

## Decisioni congelate

**D1 — Provider separato dal modello.**
Il resto dell'app chiama un contratto ("dammi un vettore per questa immagine"), mai un provider specifico direttamente.
*Perché*: cambiare provider (HF → altro) o modello (DINOv2 → altro) non deve toccare il codice applicativo, solo l'adapter.

**D2 — Storage: tabella `visual_embeddings` dedicata, mai colonne su `wardrobe_items`.**
*Perché*: `wardrobe_items` ha già accumulato colonne prefissate in passato; un embedding è un dato di natura diversa (rigenerabile, versionato, multi-provider) e merita tabella propria.

**D3 — L'embedding attivo usa pgvector (`vector(N)`), non `jsonb`.**
La dimensione `N` è quella del modello attivo (attualmente 768 per il candidato iniziale, DINOv2-Base). Solo `provider_metadata` resta `jsonb`.
*Perché*: pgvector è nativo su Supabase a costo zero; abilita query di similarità lato DB fin da subito (utile anche per la futura ricerca visiva, §9 del documento architetturale). Se cambia il modello e la dimensione, si gestisce con una nuova colonna/tabella quando serve — non prima.

**D4 — Append-only, mai overwrite. Un solo `is_active = true` per capo, garantito da vincolo DB.**
`CREATE UNIQUE INDEX ... WHERE is_active`.
*Perché*: permette confronto storico tra rigenerazioni (bug fix, cambio modello) e previene bug silenziosi di doppia riga attiva.

**D5 — Generazione non bloccante.**
Il capo si salva sempre, anche se l'embedding fallisce o è in coda. Nessun risultato "inventato" in attesa del vettore.
*Perché*: coerente con il principio già affermato nel progetto — l'onestà sull'incertezza vale più di una falsa precisione.

**D6 — Esecuzione asincrona tramite `pg_cron` + Edge Function, con scrittura condizionata `pending → processing`.**
Nessuna infrastruttura di worker esterna o persistente.
*Perché*: coerente con lo stack esistente (Supabase), gestibile da SQL Editor, nessuna nuova infrastruttura operativa per un founder solo senza dev environment locale.

**D7 — Deduplicazione come politica di prodotto a cascata, non come punteggio pesato.**

