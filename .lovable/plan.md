# Un outfit per attività di viaggio + editing manuale

## Obiettivo
Oggi un viaggio può avere al massimo un outfit per giorno/segmento: due attività nello stesso pomeriggio vengono fuse in un unico look (es. "Hegra day tour + Swimmingpool"). Si passa a **un outfit per attività**, e si rende ogni outfit modificabile a mano.

## 1. Migrazione database
- Nuova colonna `outfit_plans.trip_activity_id` collegata a `trip_day_activities`, con cancellazione a cascata (se elimini l'attività, sparisce anche il suo outfit).
- Backfill dei 7 piani esistenti: ogni piano viene agganciato all'attività corrispondente per data + segmento. Per i 2 giorni "fusi" (11 e 12 febbraio 2027) il piano resta legato alla prima attività del giorno; gli outfit delle altre attività si generano al primo "Generate" successivo.
- Sostituzione del vincolo di unicità: da "un outfit per giorno+segmento" a "un outfit per attività".
- Le regole di accesso restano invariate: ognuno vede e modifica solo i propri piani, e l'attività referenziata deve appartenere allo stesso viaggio dell'utente.

## 2. Generazione outfit (trip-capsule)
- Un requisito per ogni attività: si elimina la fusione testuale dei dress code e dei nomi.
- Lo "skip" degli outfit già esistenti passa da data+segmento a id attività, così le attività nuove/duplicate vengono generate senza toccare quelle già pianificate.
- Scrittura con il nuovo vincolo su attività.
- Il tetto per singola esecuzione resta 30 outfit.
- La lista bagaglio non cambia logica: continua a raccogliere l'unione dei capi di tutti gli outfit del viaggio, deduplicati.

## 3. UI TripDetail — outfit sotto la propria attività
- Ogni riga attività mostra sotto di sé il suo outfit (thumbnail dei capi) invece della lista separata raggruppata per segmento.
- Attività senza outfit: stato vuoto con azione "Generate".

## 4. Editing manuale dell'outfit di attività (nuovo)
Su ogni outfit di attività:
- **Modifica capi** — apre il `PiecePicker` condiviso (stesso layout del Closet già usato in Planner e Outfit Builder) precaricato con i capi correnti; al salvataggio aggiorna `item_ids`.
- **Rigenera** — cancella e ricrea solo quell'outfit con l'AI, così un capo appena aggiunto al guardaroba (es. un costume nuovo) entra nel pool.
- **Elimina** — rimuove l'outfit lasciando l'attività.
Le tre azioni passano dalle funzioni server di viaggio esistenti, estese con update/delete per singolo piano.

## Note tecniche
- Punto centrale: `src/lib/outfit-plan-slot.ts` guadagna il tipo `trip_activity` con conflitto su `trip_activity_id`; gli slot `calendar_event_id` e `general_date` restano intatti.
- File toccati: migrazione SQL, `outfit-plan-slot.ts`, `trip-capsule.functions.ts`, `trips.functions.ts` (select + nuove mutation), `TripDetail.tsx`.
- Nessun impatto su Planner, AIStylist, SavedOutfits, weekly-outfits e strumenti MCP: usano slot diversi.
