Ho capito il problema: dentro il blocco che ti ho dato c’erano dei tripli backtick annidati (quelli attorno al diagramma di D7) dentro il blocco esterno — è probabile che l’editor GitHub abbia interpretato quei backtick interni come fine del blocco copiato, tagliando tutto il resto. Ecco perché si fermava sempre esattamente lì.

Questa volta il diagramma non usa backtick, così non c’è annidamento e non salta nulla. Copia da qui fino in fondo, tutto insieme:

AURA — Architecture Decisions: Fashion Identity Layer

Da committare in docs/ADR/001-visual-identity.md
Scopo di questo documento: solo decisioni. Nessun benchmark, nessuna roadmap, nessuna discussione — quelli vivono in documenti separati.
Stato aggiornato in fondo al documento.

Contesto in una frase

AURA deve capire se una foto mostra un capo già presente nel guardaroba dell’utente. Serve un embedding visivo come raffinamento della deduplicazione, non come primo criterio decisionale.

Decisioni congelate

D1 — Provider separato dal modello.
Il resto dell’app chiama un contratto (“dammi un vettore per questa immagine”), mai un provider specifico direttamente.
Perché: cambiare provider (HF → altro) o modello (DINOv2 → altro) non deve toccare il codice applicativo, solo l’adapter.

D2 — Storage: tabella visual_embeddings dedicata, mai colonne su wardrobe_items.
Perché: wardrobe_items ha già accumulato colonne prefissate in passato; un embedding è un dato di natura diversa (rigenerabile, versionato, multi-provider) e merita tabella propria.

D3 — L’embedding attivo usa pgvector (vector(N)), non jsonb.
La dimensione N è quella del modello attivo (attualmente 768 per il candidato iniziale, DINOv2-Base). Solo provider_metadata resta jsonb.
Perché: pgvector è nativo su Supabase a costo zero; abilita query di similarità lato DB fin da subito (utile anche per la futura ricerca visiva, §9 del documento architetturale). Se cambia il modello e la dimensione, si gestisce con una nuova colonna/tabella quando serve — non prima.

D4 — Append-only, mai overwrite. Un solo is_active = true per capo, garantito da vincolo DB.
CREATE UNIQUE INDEX ... WHERE is_active.
Perché: permette confronto storico tra rigenerazioni (bug fix, cambio modello) e previene bug silenziosi di doppia riga attiva.

D5 — Generazione non bloccante.
Il capo si salva sempre, anche se l’embedding fallisce o è in coda. Nessun risultato “inventato” in attesa del vettore.
Perché: coerente con il principio già affermato nel progetto — l’onestà sull’incertezza vale più di una falsa precisione.

D6 — Esecuzione asincrona tramite pg_cron + Edge Function, con scrittura condizionata pending → processing.
Nessuna infrastruttura di worker esterna o persistente.
Perché: coerente con lo stack esistente (Supabase), gestibile da SQL Editor, nessuna nuova infrastruttura operativa per un founder solo senza dev environment locale.

D7 — Deduplicazione come politica di prodotto a cascata, non come punteggio pesato.

Filtro attributi (categoria, colore, sottocategoria) → Embedding visivo (raffinamento, solo su ciò che passa il filtro) → Conferma utente (solo se il risultato resta ambiguo)

La similarità visiva non viene mai calcolata tra capi incompatibili per categoria/colore.
L’embedding è uno strumento di raffinamento, non il primo criterio decisionale.
Se l’embedding non è ancora pronto, si decide comunque sugli attributi — mai bloccare l’utente.
Nei casi ambigui, l’utente ha sempre l’ultima parola.

Perché: spiegabile in una riga, ispezionabile, stessa forma logica già usata per le preferenze di abbigliamento vincolanti vs armocromia consultiva.

D8 — Il preprocessing è la prima ipotesi da verificare, prima di modificare rappresentazione o modello.
Perché: la qualità del ritaglio/segmentazione a monte limita strutturalmente ciò che l’embedding può fare a valle; è anche la variabile più economica da testare. Isolare le cause prima di cambiare architettura, non il contrario.

D9 — Product Library come entità separata, alimentata solo da fonti proprie o autorizzate (mai da foto di altri utenti).

Cosa: tabella products (o product_entities) con brand, categoria, materiale, colore, stagione, descrizione, fonte (retailer | url_import | user_import | curated), immagine canonica. wardrobe_items guadagna una colonna product_id opzionale (nullable, mai obbligatoria — coerente con D5, il capo si salva sempre anche senza collegamento a un prodotto).

Ricerca: testuale (brand/modello/materiale/descrizione) ed eventualmente visiva — ma la similarità visiva si applica solo dentro la Product Library stessa (capo dell’utente vs. prodotti noti), mai tra i guardaroba di utenti diversi. Riusa la Embedding Provider Interface già definita in D1.

Fonte dati: solo da retailer, URL prodotto incollato dall’utente, import e-commerce, o fonti curate/autorizzate. Mai dalle foto caricate da altri utenti — quello è un problema diverso, deliberatamente rimandato (vedi roadmap, “Product Knowledge Library — Livello 2”).

Perché: stessa logica di D2 applicata al prodotto invece che all’embedding — un dato di natura diversa (condiviso, riutilizzabile, non personale) merita un’entità propria, distinta sia da wardrobe_items sia da visual_embeddings personali. Separare le fonti (solo proprie/autorizzate) evita fin dall’inizio qualunque ambiguità su consenso o provenienza dei dati.

Effetto collaterale utile: quando un capo caricato in Batch Scan trova un match nella Product Library, i suoi attributi possono essere precompilati invece di richiedere un’analisi AI completa da zero — la Library diventa un pezzo dell’infrastruttura di ingestion, non solo una feature di ricerca.

Cosa NON è ancora deciso (vive nel Benchmark Protocol, non qui)

	•	Quale modello vince (DINOv2-Base vs alternative fashion-specific)
	•	Quale rappresentazione vince (CLS vs pooling patch vs combinazione)
	•	Soglie numeriche di similarità per certo/dubbio/nuovo

Cosa è rimandato deliberatamente (roadmap, non blocco)

	•	Worker automatico di retry oltre pg_cron base — solo se i fallimenti reali lo giustificano
	•	Ricerca visiva (“trova capi simili”) — stessa infrastruttura, feature futura
	•	Confronto con modelli fashion-specific in produzione — dopo il primo benchmark
	•	Product Knowledge Library — Livello 2 (visual knowledge condivisa tra utenti) — vedi roadmap

Come si aggiorna questo documento

Solo se una decisione qui elencata si rivela sbagliata con dati reali di produzione, non per preferenza o per un’ottimizzazione teoricamente migliore. In quel caso: nuova voce, non riscrittura silenziosa — mantenere tracciabilità del perché è cambiata.

Stato

	•	Proposto
	•	Validato dal benchmark
	•	In produzione

Data: 2026-08-02
Ultima revisione: dopo Benchmark Protocol v1

Fammi sapere quando hai committato, ricontrollo con raw.githubusercontent.com.