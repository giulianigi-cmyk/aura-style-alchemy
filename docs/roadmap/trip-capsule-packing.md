# AURA — Roadmap: Trip Capsule & Packing List

> Da committare in `docs/roadmap/trip-capsule-packing.md`
> Scopo di questo documento: fissare il design prima di scrivere codice — così
> non si riscopre da zero e non si confonde con una decisione già presa.
> Nessuna voce qui è congelata: è una proposta, da rivedere prima di passare
> all'implementazione.

## Contesto in una frase

La sezione "Day-by-day outfits" di un viaggio esiste già in `TripDetail.tsx`
come placeholder ("Coming next"). Questo documento descrive cosa deve fare
davvero: generare gli outfit di un viaggio e derivarne la valigia, minimizzando
i capi distinti nel rispetto di tutti i vincoli del profilo.

## Cosa esiste già (riuso, non si parte da zero)

- `outfit_plans` ha già `trip_id` e `day_segment` (`'day' | 'evening'`), con
  vincolo unique `(trip_id, date, day_segment)`.
- `trips` ha già `laundry_available: boolean`.
- `trip_day_activities` esiste già nello schema (`activity_date`,
  `activity_type`, `day_segment`, `dress_code`, `destination_id`, `notes`),
  letta da `getTripDetail` — ma **nessuna UI la scrive o la mostra** ancora.
  È il primo pezzo mancante, vedi "Domande aperte".
- `suggestOutfitCore` / `generateWeeklyOutfits` sono il motore già in uso per
  la generazione settimanale — riusabile per il ramo `laundry_available = true`,
  non adatto così com'è al ramo `false` (vedi sotto).
- `reanalyzeWardrobeBatch` classifica già `formality` (1-5) e gli altri
  attributi via AI vision in batch da 5, con gating corretto
  (`is("formality", null)`). L'algoritmo qui sotto dipende da questi dati:
  funziona per i capi già classificati, non per un guardaroba mai passato
  dalla bacchetta "Aggiorna compatibilità".
- `itten-wheel.ts` per l'armonia colore, `weather.ts` (`suggestOutfit`) per
  l'euristica meteo → entrambi deterministici, riusabili senza modifiche.

## Le 11 dimensioni del compromesso

Ogni outfit generato per il viaggio deve bilanciare simultaneamente:

1. Numero minimo di capi distinti
2. Compatibilità tra loro (colore, stile)
3. Vincoli YOU (hard, mai negoziabili — stessa priorità del resto di AURA)
4. Clima previsto (per destinazione/data)
5. Attività / dress code del giorno
6. Day / evening
7. Formalità
8. Stagione
9. Preferenze personali
10. Laundry disponibile
11. Varietà sufficiente da non sembrare sempre lo stesso outfit

Nessuna di queste è una media pesata delle altre — stessa regola già
stabilita nell'Outfit Engine Logic doc: un livello inferiore non compensa
mai una violazione di un livello superiore. YOU resta hard constraint fuori
da qualunque ottimizzazione di packing.

## Rewearability — tabella statica, non giudizio dell'AI

La rewearability è un attributo deterministico associato alla categoria del
capo. Non viene stimata dall'AI e non richiede una nuova inferenza. Stesso
pattern di `size-conversion.ts`: lookup statico per categoria.

**Non rappresenta un numero massimo assoluto di utilizzi.** È un parametro
che l'ottimizzatore usa per stabilire quali capi sono naturalmente più
adatti al riuso durante lo stesso viaggio — un fattore di ottimizzazione,
non un vincolo assoluto.

| Categoria | Riusabilità |
|---|---|
| Outerwear / cappotti | Molto alta |
| Blazer / giacche | Alta |
| Pantaloni / jeans | Alta |
| Gonne | Medio-alta |
| Abiti | Media |
| Camicie / maglieria | Media |
| T-shirt / top | Bassa |
| Intimo / calze | Nessun riuso senza lavaggio |

I valori esatti vivono in **una costante centralizzata**, mai distribuiti
nella logica dell'algoritmo — un solo posto da aggiornare, non sparsi tra
le funzioni di scoring.

`laundry_available` modifica il comportamento del riuso, non la tabella:
- `false` → i capi a bassa rewearability sono trattati sostanzialmente
  come single-use.
- `true` → il sistema può considerarne il riutilizzo dopo un intervallo
  compatibile col lavaggio (ciclo realistico, default ogni 3-4 giorni).

## Gerarchia decisionale del Travel Outfit Engine

Le 11 dimensioni sopra non costituiscono uno scoring unico e non vanno mai
trasformate in una media pesata. Il Travel Outfit Engine mantiene la
stessa filosofia decisionale già stabilita nell'Outfit Engine Logic doc:
un livello inferiore non può compensare una violazione o un fallimento di
un livello superiore. La logica è quindi gerarchica:

**1. Hard constraints.** I vincoli YOU sono sempre hard constraint e non
possono essere rilassati dall'ottimizzazione della valigia. Nessuna
ottimizzazione può proporre un capo o un outfit che viola un limite
esplicito del profilo. Rientrano qui anche le incompatibilità oggettive
che rendono un outfit non valido.

**2. Copertura delle esigenze del viaggio.** La soluzione deve coprire le
esigenze effettive del viaggio: clima previsto, attività, dress code,
day/evening quando richiesto, formalità, stagione. Una capsule più piccola
non è migliore se lascia scoperta un'esigenza del viaggio.

**3. Compatibilità dell'outfit.** Tra le soluzioni che rispettano i
vincoli e garantiscono la copertura, si privilegiano quelle con migliore
compatibilità secondo le regole già esistenti: colore, stile, proporzioni
e attributi rilevanti, formalità, stagione, meteo, preferenze personali.
Le regole deterministiche già presenti vanno riutilizzate, evitando una
seconda logica parallela.

**4. Efficienza della capsule.** Solo dopo aver garantito validità e
copertura, AURA minimizza il numero di capi distinti. L'obiettivo non è
"portare il minor numero possibile di capi a qualsiasi costo", ma "trovare
la capsule più piccola possibile tra quelle che coprono validamente
l'intero viaggio".

**5. Riuso e laundry.** A parità delle condizioni superiori, AURA
privilegia i capi con maggiore rewearability. `laundry_available` modifica
la possibilità di riutilizzare i capi durante il viaggio, secondo le
regole operative definite nella sezione "Rewearability — tabella statica,
non giudizio dell'AI" sopra. La rewearability rimane un fattore di
ottimizzazione e non un limite rigido al numero di utilizzi.

**6. Varietà.** A parità delle condizioni precedenti, AURA evita una
sequenza di outfit eccessivamente ripetitiva. La varietà si cerca prima
dentro la capsule già selezionata, e solo se necessario può giustificare
l'introduzione di ulteriori capi.

## Relazione con suggestOutfitCore

Trip Capsule **non sostituisce** `suggestOutfitCore` — resta il motore
condiviso per compatibilità, dress preferences, location, meteo, selezione
e composizione degli outfit. La nuova logica Travel aggiunge sopra il core
un livello di ottimizzazione globale sul viaggio:

```
Trip constraints → Capsule selection → suggestOutfitCore → Outfit validation → Packing List
```

Il ramo `laundry_available = true` può riusare maggiormente la logica
esistente così com'è. Il ramo `laundry_available = false` richiede invece
una strategia specifica di capsule optimization, perché l'obiettivo non è
la semplice varietà degli outfit ma la copertura dell'intero viaggio col
minor numero ragionevole di capi distinti.

## La sequenza (whole-trip-first, non giorno-per-giorno)

Ragionare giorno 1 → outfit → giorno 2 → outfit rischia outfit
singolarmente perfetti ma una valigia inefficiente. Sequenza corretta:

```
1. Analizza il viaggio
   Date + destinazioni + clima + attività + dress code + laundry + YOU
        ↓
2. Costruisce il wardrobe pool
   Filtro deterministico: location sorgente, stagione, esclusione YOU
        ↓
3. Ottimizza la capsule
   Algoritmo deterministico (dettaglio sotto) — non un LLM in un colpo solo
        ↓
4. Genera gli outfit
   Scrive outfit_plans (trip_id, date, day_segment) dalla capsule assegnata
        ↓
5. Verifica la copertura
   Ogni giorno/attività ha un outfit valido? Se no, lo segnala — non forza
   una combinazione sbagliata (stesso fallback di Outfit Engine Logic §28)
        ↓
6. Produce la packing list
   Solo ora: unione deduplicata degli item_ids di tutti gli outfit del
   viaggio → sezione separata "Capi da portare" (non mescolata a Essentials)
```

## Perché non un LLM in un colpo solo (passo 3)

Minimizzare capi distinti rispettando 11 vincoli è un problema di tipo
*set cover*. Un LLM può "sembrare" ottimale senza esserlo — falsa
precisione, esattamente ciò che il principio di progetto vuole evitare.
Decisione presa: **algoritmo deterministico**, non LLM guidato. Più lavoro
da costruire, ma spiegabile e verificabile — stesso principio già applicato
a D7 (dedup: filtro attributi deterministico, poi eventuale AI di
raffinamento, mai il contrario).

## Design del passo 3 — algoritmo greedy

**Formalizzazione:**
- `Requirements`: una entry per ogni `(date, day_segment)` che serve un
  outfit — da `trip_day_activities` se presenti, altrimenti un default
  "day, formalità generica" per ogni data del viaggio. Ogni requirement
  porta: finestra meteo, `dress_code` → range di formalità target,
  `day_segment`.
- `Pool`: capi eleggibili dopo il filtro del passo 2.
- Ogni requirement richiede un outfit completo: top-o-dress + bottom (se
  non dress) + scarpe + opzionale outerwear/accessorio — stessa struttura
  già usata in `suggestOutfitCore`.

**Compatibilità candidato → requirement (tutta deterministica):**
- Formalità: `item.formality` entro il range target del `dress_code`
- Day/evening: `item.day_evening` compatibile col `day_segment`
- Meteo: subcategoria/materiale vs temperatura (euristica già in
  `weather.ts` → `suggestOutfit`)
- Colore: armonia Itten tra i capi scelti (`itten-wheel.ts`)

**Algoritmo:**

1. Ordina i requirements per vincolo più stringente prima (formalità
   estrema, meteo estremo) — i casi difficili si risolvono quando la
   capsule è ancora vuota e c'è più libertà di scelta.
2. Per ogni requirement, prova prima a comporre l'outfit usando solo capi
   già nella capsule. Se una combinazione valida esiste → assegnala, costo
   marginale zero.
3. Se non basta, cerca nel pool il capo che soddisfa il gap mancante e ha
   il punteggio di **versatilità** più alto tra le alternative valide.
   Aggiungilo alla capsule.
4. Applica il peso `laundry_available` (vedi sopra) al costo di riuso.
5. Dopo aver coperto tutte le requirements: verifica varietà — se lo stesso
   identico outfit compare troppe volte consecutive nello stesso tipo di
   formalità, forza una permutazione con un capo alternativo già in
   capsule (es. cambia solo il top), mantenendo la capsule minima.

**Versatility score** (da calcolare, non un nuovo campo DB): colore in
famiglia neutra + formalità medio-range (2-3) → punteggio alto; capo
stampato/vistoso/estremo → punteggio basso. Calcolabile dai campi esistenti
(`colors`, `formality`).

## Fallimento della generazione

AURA non deve mai inventare capi, ignorare vincoli YOU, o produrre una
capsule apparentemente completa quando il guardaroba non contiene
abbastanza elementi compatibili. Se non esiste una soluzione valida, il
sistema esplicita il problema invece di forzarlo — stesso principio già in
Outfit Engine Logic §28, qui applicato al livello capsule/viaggio:

- *"Non riesco a coprire tutte le attività del viaggio con i capi presenti
  nel tuo guardaroba."*
- *"Per questa combinazione di clima e dress code manca un capo
  compatibile."*

AURA può successivamente proporre un acquisto, ma solo secondo le regole
di shopping già definite nel sistema (§8 del documento di progetto
principale) — la generazione della capsule non altera mai autonomamente il
guardaroba dell'utente né inventa articoli mancanti.

## Dipendenza dai dati del guardaroba

La Travel Capsule dipende dalla qualità dei dati già presenti nel
guardaroba: categoria/sottocategoria, colore, materiale, stagione,
formalità, stile, lunghezza e altri attributi rilevanti, compatibilità coi
vincoli YOU.

Principio: **dato classificato → utilizzabile per l'ottimizzazione. Dato
mancante o non affidabile → non si assume mai un valore arbitrario.** Un
capo con `formality` nullo non viene trattato come se avesse una
formalità media implicita — viene escluso dal pool eleggibile finché non è
classificato, non forzato dentro con un default silenzioso (stessa regola
di "onesta approssimazione" che governa tutto il progetto).

L'utente può usare la funzione già esistente "Aggiorna compatibilità"
(`reanalyzeWardrobeBatch`) per completare la classificazione prima della
generazione della capsule. Se il pool eleggibile risulta comunque
insufficiente per mancanza di classificazione (non per mancanza reale di
capi), il sistema lo segnala distintamente dal caso "Fallimento della
generazione" sopra — sono due problemi diversi: uno è "non hai il capo
giusto", l'altro è "AURA non sa ancora se lo hai".

## Domande aperte (da chiudere prima del codice)

1. **`dress_code` su `trip_day_activities`**: stesse label di `OCCASIONS`
   in `Planner.tsx` (Work / Evening / Weekend / Formal / Travel / Sport /
   Everyday) o un set diverso per il contesto viaggio?
2. **Input attività**: oggi non esiste alcuna UI per scrivere in
   `trip_day_activities`. Form strutturato (data + tipo + dress code) o
   linguaggio naturale via chat stilista che poi popola la tabella?

## Stato

Proposto — non ancora implementato. Nessuna decisione qui è congelata fino
a revisione.

Data: 2026-08-11
