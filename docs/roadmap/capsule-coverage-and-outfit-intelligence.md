# AURA — Roadmap: Capsule Coverage, Outfit Intelligence & Fashion Knowledge Layer

> Da committare in `docs/roadmap/capsule-coverage-and-outfit-intelligence.md`
> Scopo di questo documento: fissare il design di tre capability future
> **distinte** prima di scrivere codice — così nessuna delle tre si implementa
> per caso come sottoprodotto delle altre, e nessuna riscoperta da zero tra
> qualche mese. Nessuna voce qui è congelata: è una proposta di design, da
> approvare — incluso il modello dati e il contratto di scoring — prima di
> passare a qualunque implementazione, anche parziale. Le tre capability non
> sono alla pari: C dipende esplicitamente da B validato (vedi sotto), non è
> un'alternativa parallela ad A e B.

## Perché tre capability, non una — e non alla pari

Sono nate dalla stessa conversazione e condividono una direzione
architetturale comune — passare da regole piatte (`if X then never Y`) a
scoring contestuale — ma rispondono a domande diverse, e **non sono
sequenziate alla pari**: C dipende esplicitamente da B validato, non è
un'alternativa parallela.

- **A. Capsule Coverage Optimization** risponde a: *"con questi capi, quante
  situazioni del viaggio riesco a coprire, con il minor numero di pezzi
  distinti possibile?"* — è un problema di ottimizzazione combinatoria sul
  **guardaroba** rispetto alle **attività**.
- **B. Outfit Compatibility / Style Intelligence** risponde a: *"questi capi,
  messi insieme in QUESTO outfit, funzionano visivamente?"* — è un problema
  di giudizio estetico su un **singolo outfit già composto**.
- **C. Fashion Styling Knowledge Layer** (sequenziata **dopo** B, non
  parallela) risponde a: *"come vengono effettivamente combinati questi
  elementi nello styling reale, al di là della teoria del colore?"* — dà
  a B evidenza osservata da affiancare alla struttura teorica di Itten,
  ma **non è necessaria perché B funzioni** — è un potenziamento successivo,
  non una dipendenza del primo motore.

La A decide *quali capi entrano in valigia*. La B decide *se la combinazione
proposta per un giorno specifico è bella o è un errore di stile*. La C
arricchisce B con dati osservati, quando B è già validato. Sono
composabili (A restringe il pool su cui B lavora; C è opzionale sopra B)
ma non sono la stessa cosa, e non vanno implementate come se lo fossero:
una regressione nella B (es. un outfit che stona) non deve richiedere di
toccare la A, e C non va iniziata prima che B stessa sia in produzione e
verificata.

## Principio comune ad A e B

Determinato dalla correzione che hai fatto in sessione (nero+mattone come
scarpe+borsa mai, ma nero scarpe + abito marrone benissimo): **una regola
espressa come "mai" è quasi sempre una scorciatoia sbagliata per "quasi mai,
dipende dal contesto".** A e B sono progettate per non ripetere questo
errore — non producendo mai un divieto assoluto dove in realtà serve un
giudizio contestuale. Lo stesso principio vale per C (vedi "osservazione,
non apprendimento automatico delle regole" più sotto), espresso lì nella
sua forma specifica.

Tre livelli, sempre distinti, mai confusi:

| Livello | Cosa fa | Dove vive |
|---|---|---|
| **Deterministic layer** | Calcola feature misurabili e riproducibili (formalità numerica, distanza cromatica su Itten, presenza/assenza di categoria, conteggio colori) | Codice, testabile senza AI |
| **AI judgment layer** | Valuta ciò che richiede giudizio estetico reale (questa combinazione specifica funziona per questa occasione e questa persona?) | Prompt AI, riceve le feature del layer deterministico come contesto, non le ricalcola da zero |
| **Final scoring layer** | Combina i due sopra in uno score finale, versionato e verificabile | Codice — **l'AI non emette mai un punteggio finale da sola** (vedi B.4) |

## Nome onesto per quello che esiste oggi

**Importante da non fraintendere leggendo questo documento**: quello che
gira oggi in produzione (`suggestOutfitCore` + il `system` prompt in
`ai-suggest-outfit.functions.ts`) **non è** un Compatibility Score
multi-asse. È:
wardrobe → prompt con regole di stile → Gemini → 3-5 item_ids

cioè **AI outfit selection**, non **Multi-Axis Compatibility Engine**. Le
regole "Default: ..." introdotte in sessione sono una patch intermedia
onesta — meglio delle regole assolute che sostituiscono, ma ancora un
mega-prompt di istruzioni testuali, non feature calcolate e combinate in
uno score verificabile. Il resto di questo documento descrive cosa deve
sostituirlo/affiancarlo, non descrive cosa esiste già.

**Vincolo esplicito per le sessioni future**: non continuare ad aggiungere
regole al `system` prompt come se fosse la soluzione a lungo termine. Ogni
nuova regola di stile scritta come frase in inglese dentro quell'array è un
altro pezzo del problema che questo documento vuole risolvere, non un passo
verso la soluzione. Se emerge un nuovo caso di stile sbagliato, la domanda
giusta è "questa è una feature deterministica che manca (B.1) o un
giudizio che l'AI dovrebbe già saper fare con più contesto?", non "quale
frase aggiungo al prompt".

## Limitazione nota e non ancora risolta: troncamento del catalogo

`suggestOutfitCore` oggi fa `eligibleItems.slice(0, 200)` prima di costruire
il catalogo per l'AI. Con un guardaroba sopra i 200 capi eleggibili, i
primi 200 nell'ordine di arrivo dal DB vengono arbitrariamente privilegiati
— non è filtro né ranking, è un troncamento cieco. Accettabile oggi come
protezione di costo/token con guardaroba tipici, ma è in diretto conflitto
con il principio "il sistema deve filtrare/rankare, non troncare" che
guida tutto il resto di questo documento.

Non risolvibile bene senza la candidate generation di cui sotto — un
troncamento "arbitrario ma con parametro più alto" sposterebbe solo il
problema. Va risolto insieme a B.1/B.4, non prima e non a parte: la
`Candidate ranking` del pipeline sotto è esattamente il meccanismo che
sostituisce lo `slice(0, 200)` con qualcosa di intenzionale.

---

# A. Capsule Coverage Optimization

## Cosa esiste già (riuso, non si parte da zero)

- `buildCapsule()` in `trip-capsule.functions.ts` — oggi fa greedy fill per
  ruolo (Top/Bottom/Shoes/Bag) con target statici e jitter casuale per la
  varietà. Punto di partenza per il coverage reasoning, non da buttare.
- `REWEARABILITY`, `versatility()` — già una forma primitiva di "quanto
  vale questo capo nel capsule", da estendere, non da sostituire.
- La riserva scarpa elegante / scarpa da corsa (già implementata) è già un
  caso particolare di "occasione rara ma obbligatoria" (§A.2) — precedente
  diretto da generalizzare, non un'eccezione isolata.

## A.1 — Activity Coverage

Ogni capo riceve un punteggio di copertura: quante attività del viaggio è
in grado di coprire, dato formalità/stagione/day-evening compatibili.

- Una sneaker che copre 7 attività su 10 ha un vantaggio strutturale su un
  tacco che ne copre 2 — **ma il tacco non va eliminato per questo** (vedi
  A.2, necessità ≠ frequenza).
- Metrica: `coverage(item) = |{ requirements compatibili con questo capo }|`.
  Deterministico, riusa `eligibleFor()` già esistente requirement per
  requirement.

## A.2 — Occasioni rare ma obbligatorie

Un capo che copre una sola attività non è per questo "cattivo" — se
quell'attività è l'unica del viaggio con quel requisito e nessun altro capo
lo soddisfa, è **insostituibile**, non marginale.

- Non è `frequenza × compatibilità`, è `necessità × insostituibilità`.
- Precedente diretto già in produzione: `hasEleganceSignal()` +
  riserva scarpa elegante/sportiva in `buildCapsule()`. Generalizzare da
  "scarpa elegante" e "scarpa da corsa" (hardcoded) a un meccanismo che
  riconosce qualunque categoria/subcategoria come "unica copertura per
  questo requirement" e la riserva automaticamente.

## A.3 — Deduplicazione funzionale

Due capi che coprono esattamente lo stesso insieme di attività (stessa
formalità, stessa stagione, stesso day/evening, categoria affine — es. due
sneaker bianche) non vanno scelti entrambi solo perché entrambi eleggibili.

- `functional_overlap(itemA, itemB) = |coverage(A) ∩ coverage(B)| / |coverage(A) ∪ coverage(B)|`
- Overlap alto + stessa categoria → il secondo capo non aggiunge coverage
  reale, occupa solo spazio che potrebbe andare a una categoria scoperta.
  Non è un divieto: se non c'è nulla di meglio da mettere in quello slot,
  il duplicato resta preferibile a uno slot vuoto.

## A.4 — Essential / Recommended / Optional

Ogni capo nel capsule proposto riceve un livello:

- **Essential** — copre almeno una necessità che altrimenti resterebbe
  scoperta (nessun altro capo eleggibile la soddisfa).
- **Recommended** — aumenta significativamente le combinazioni possibili
  (alto coverage o alta versatilità) senza essere l'unica opzione.
- **Optional** — migliora varietà/stile ma è il primo candidato se serve
  liberare spazio.

Usato per la futura UX "Cosa posso lasciare a casa?" (§A.9) — non
implementata ora, ma il livello va calcolato comunque perché serve anche a
spiegare *perché* un capo è entrato in valigia (§A.7).

## A.5 — Numero di scarpe (e altri ruoli capped) dinamico, non fisso

`shoeTarget = min(perRoleTarget, 2)` oggi è una costante fissa. Da sostituire
con una funzione delle **esigenze**, non solo dei giorni:

- Un viaggio di 10 giorni solo mare può restare a 2 scarpe.
- Un viaggio di 5 giorni con yoga + trekking + resort + cena elegante ne può
  richiedere 4 — ognuna coperta da un `hasXSignal()` dedicato (pattern già
  stabilito con `hasEleganceSignal`).
- Il cap resta, ma cresce di uno per ogni "occasione rara obbligatoria"
  (§A.2) che nessuna scarpa già riservata copre.

## A.6 — Versatility Score esteso

`versatility()` oggi pesa colore neutro + formalità media + day/evening
"both". Da estendere con l'`activity coverage` di A.1: un capo che si combina
con molte altre categorie/colori nel capsule vale più di uno che ne combina
poche, a parità di formalità.

## A.7 — Outfit spiegato ("Riutilizzo intelligente")

Non implementazione di codice nuovo — è output aggiuntivo delle metriche
già calcolate in A.1/A.4: *"Questo blazer copre 5 outfit su 3 attività"*,
*"Questo vestito copre 2 cene + 1 serata resort"*. Da esporre in UI quando
A.1 e A.4 esistono, non prima.

## A.8 — Backup outfit (rimandato, dipendenza esplicita)

Per le categorie con un solo capo insostituibile (§A.2: es. un unico tacco
per un'unica cena elegante), offrire anche un'alternativa B se il guardaroba
la contiene. Dipende da A.2 essere implementato per primo — non ha senso
prima.

## A.9 — Variety ↔ Efficiency (personalizzazione futura)

Parametro di preferenza utente, separato da `style_boldness` (che è
un'altra cosa, vedi B.3): quanto il capsule deve minimizzare i capi
(efficiency) vs massimizzare la sensazione di indossare sempre qualcosa di
diverso (variety), anche a costo di qualche capo in più. Non decidere ora
la UI — solo notare che è un parametro distinto da tutto il resto qui sopra
e va tenuto separato nel modello dati quando arriverà.

---

# B. Outfit Compatibility / Style Intelligence Engine

## Cosa esiste già (riuso, non si parte da zero)

- `itten-wheel.ts` (`hexToHsl`, `getHarmonies`, `nearestWheelName`) — **il
  pezzo più concretamente riusabile di tutto questo documento**. Già in
  produzione nel Color Lab del guardaroba. Va collegato al motore outfit,
  non riscritto.
- `style_boldness` sul profilo — esiste già, oggi è solo una riga di testo
  nel prompt (`boldnessLine`). Da promuovere a leva che sceglie la
  **strategia di armonia**, non solo il tono del linguaggio nel prompt.
- Le regole "Default: ..." appena introdotte in `ai-suggest-outfit.functions.ts`
  (nero+navy, pattern doppio, denim, scarpa/borsa, scollo+gonna corta,
  formalità coerente) sono il **livello AI judgment** provvisorio, in
  attesa che il livello deterministico qui sotto le affianchi con feature
  numeriche invece di lasciare tutto al testo del prompt.

## B.1 — Gli assi (almeno questi)

Nota su "Color Harmony" e sul conteggio colori usato oggi nel prompt
(`"keep the total color count to about 3-4"`): quell'euristica è
**temporanea**, non la logica definitiva. `navy + light blue + white +
camel` e `fuchsia + orange + cobalt + lime` hanno lo stesso "conteggio
colori" ma sono situazioni opposte — la differenza è saturazione,
luminosità e relazione su Itten, non il numero di colori. Il conteggio
resta utile come guardrail grezzo finché B.1/B.4 non sono implementati, ma
va sostituito, non esteso con altre soglie ad-hoc.

| Asse | Deterministico? | Nota |
|---|---|---|
| Color Harmony | Sì (Itten) | `hexToHsl` + `getHarmonies` già calcolano questo |
| Itten Harmony Type | Sì | Monocromatica / analoga / complementare / split-complementary / triadica / tetradica / tonale — classificazione, non giudizio |
| User Boldness ("Quanto osare") | Input, non calcolo | Modula quale harmony type è preferita, vedi B.3 |
| Pattern Compatibility | Parzialmente | Dimensione/densità pattern misurabile da metadata se presente; "funziona insieme" resta giudizio AI |
| Exposure Balance | Sì | Lunghezza gonna + profondità scollo + trasparenza — enumerabile da attributi capo già esistenti (`length`, subcategory) |
| Formality Compatibility | Sì | Già esiste come numero 1-5 per capo, serve solo la distanza tra i capi dell'outfit, non solo il range vs requirement |
| Accessory Harmony | Parziale | Coordinamento pelle scarpa/borsa è deterministico (colore↔colore); "quanto nero è troppo nero" resta giudizio. Il prompt attuale già permette deroga esplicita quando la palette complessiva è coerente (es. abito marrone + scarpe nere + borsa bordeaux) — comportamento da preservare quando questo asse diventerà una feature calcolata, non solo testo nel prompt |
| Season / Context | Sì | Già esistente (`seasonBandsForTemp`, temperatura reale) |
| Occasion / Dress Code | Sì | Già esistente (`FORMALITY_RANGE`, `hasEleganceSignal`) |
| Style Coherence | AI | Se l'outfit "parla la stessa lingua stilistica" — richiede giudizio |
| Creativity / WOW potential | AI | Esplicitamente soggettivo, mai deterministico |

## B.2 — Formality Compatibility non è "tutto uguale"

Un outfit può avere pezzi a formalità diversa **di proposito** (contrasto
intenzionale, es. 8+7+4) — non deve diventare una regola che impone
uniformità. Il segnale utile è la **distanza tra i pezzi**, non il valore
assoluto: una distanza piccola-media può essere contrasto interessante, una
distanza enorme (10+2+1) è quasi sempre un errore. La soglia esatta non va
decisa ora — va calibrata quando esistono dati reali di outfit generati da
valutare, non a tavolino.

## B.3 — Boldness come strategia, non solo tono del prompt

Oggi `style_boldness` produce solo una riga di testo aggiunta al prompt
("lean into color and pattern"). Il design futuro:
1 — Very Safe: analoghi, neutri, tonalità vicine
2-3 — Conservative: analoghi + piccolo accento
4-5 — Balanced: analoghi + complementare controllato
6-7 — Bold: complementari / triadici più evidenti
8-10— Experimental: contrasti forti, split-complementary, combinazioni inaspettate

La stessa combinazione cromatica può essere perfetta per un utente a 8 e
sbagliata per un utente a 2 — **non è una proprietà della combinazione, è
una proprietà della combinazione rispetto al profilo.** Il boldness deve
poter modulare, non solo il colore, ma layering, mix pattern, uso di
statement piece — è un parametro di styling globale, non solo cromatico.

**Stato attuale, esplicitamente:** oggi `boldnessLine` è ancora solo testo
nel prompt ("lean into color and pattern" / "favor neutral, coordinated
colors") — non sceglie tra famiglie di armonia, non modula la tolleranza
al contrasto, non influenza un ranking di candidati perché quel ranking
non esiste ancora. Questo è corretto per lo stato attuale (deciso di non
implementare B ora) — ma è il gap più importante da chiudere quando si
passerà all'implementazione, perché è la leva con l'impatto percepito più
alto sul "questo outfit sembra fatto apposta per me" vs "questo outfit è
tecnicamente corretto ma generico".

**Funzione "oltre la comfort zone" (esplicita, opzionale in UI futura):**
anche un utente a boldness=2 può occasionalmente ricevere un suggerimento a
boldness=4 marcato esplicitamente come tale ("✨ Un po' fuori dal tuo
solito"), mai spacciato per la scelta standard. Struttura suggerita:
`Safe choice` / `Your style` / `Try something new` come varianti, non come
sostituzione silenziosa della preferenza dichiarata.

## B.4 — Regola di derivazione degli score (vincolo non negoziabile)
code → calcola le feature misurabili (Itten type, formality distance,
exposure score, color count, pattern size/density se disponibile)
AI → valuta SOLO ciò che richiede giudizio estetico reale, ricevendo
le feature del punto sopra come contesto — non le ricalcola,
non inventa un punteggio dal nulla
code → combina i due in uno score finale, versionato (così un cambio di
pesi è tracciabile e A/B-testabile, non un comportamento che
cambia silenziosamente col drift del modello AI)

L'AI non deve mai restituire un numero finale tipo "questo outfit è 91/100"
senza una struttura sottostante verificabile — se lo fa, quel numero non è
altro che testo generato, non uno score affidabile o riproducibile.

## B.4bis — Pipeline target (sostituisce/affianca la logica prompt-based attuale)
WARDROBE
↓
Candidate generation ← sostituisce lo slice(0, 200) arbitrario
↓
Deterministic filters ← season/formality/day-evening già esistenti
↓
Color / Itten engine ← hexToHsl + getHarmonies, già in produzione altrove
↓
Pattern / exposure / formality features
↓
User Boldness ─────┐ ← sceglie la famiglia di armonia ammessa, non solo il tono del testo
│
Fashion Styling │ ← input PARALLELO, non un prerequisito — vedi Sezione C.
Knowledge (C) ──────┤ Finché C non esiste, questo ramo è vuoto e la pipeline
[opzionale, │ funziona comunque solo con Itten + Boldness + contesto.
solo dopo C] │
↓
Candidate ranking ← sostituisce il troncamento con un ordine intenzionale
↓
AI stylist judgment ← riceve le feature sopra come contesto, non le ricalcola
↓
Compatibility + Creativity + WOW
↓
Final ranking

Questa è l'architettura a cui il prompt-based system di oggi deve arrivare
— per sostituzione dei singoli stadi, non per riscrittura totale in un
colpo solo. Ogni stadio è testabile ed evolvibile indipendentemente dagli
altri, che è esattamente ciò che il mega-prompt attuale non permette.

**Sul ramo Fashion Styling Knowledge**: entra nel `candidate ranking` come
segnale allo stesso livello di Boldness e contesto, non come filtro a
monte e non come regola che riscrive gli altri stadi — coerente con
"osservazione, non apprendimento automatico delle regole" della Sezione C.
La pipeline B è completa e funzionante anche senza quel ramo: C lo popola
in un secondo momento, non lo richiede per esistere.

## B.5 — Pattern hierarchy (raffinamento di quanto già nel prompt)

Non "mai mischiare pattern" — un pattern dominante + uno secondario/piccolo
può funzionare (blazer tartan + camicia micro-riga). Da modellare come:

- `pattern_scale` (grande/medio/piccolo/micro) — enumerabile se il dato
  esiste sul capo, altrimenti lasciato a giudizio AI.
- Due pattern alla stessa scala/intensità → quasi sempre overload.
  Scala molto diversa + uno chiaramente dominante → può funzionare.

## B.6 — Exposure Balance (non regola moralistica)

Già corretto nel prompt attuale ("non è un giudizio morale, è bilanciamento
visivo") — da rendere deterministico quando i dati lo permettono: lunghezza
gonna/vestito (già un campo `length`) + eventuale dato su scollatura, se mai
verrà classificato. Finché quel dato non esiste in modo affidabile, resta
giudizio AI guidato dal testo del prompt, non un blocco a metà.

---

# C. Fashion Styling Knowledge Layer (dopo B, non parallela)

**Dipendenza esplicita: non iniziare prima che B (Itten + Boldness +
compatibility + pattern + exposure + formality + accessories) sia
implementato, in produzione e verificato su dati reali.** Non è necessaria
perché il primo Multi-Axis Engine funzioni — è un potenziamento successivo
che dà a B evidenza osservata da affiancare alla struttura teorica, non un
prerequisito. Costruire questo insieme a B rischia esattamente quello che
questo documento vuole evitare: motore di scoring + raccolta dati +
knowledge base + pipeline di aggiornamento tutti insieme, senza aver
validato nemmeno il primo pezzo.

## Il pipeline concettuale
Fashion / Ecommerce / Editorial data
↓
Styling observations
↓
Normalize features
↓
AURA Style Knowledge
↓
┌────────────┼────────────┐
↓ ↓ ↓
Color Pattern Silhouette
↓ ↓ ↓
Material Formality Accessories
↓
AURA Style Engine
↓
User preferences
↓
Outfit ranking

## Tre livelli di conoscenza, mai confusi tra loro

1. **Regole deterministiche** — cose oggettive: questo è un mini dress,
   questo è un blazer, questo colore è complementare su Itten, questi due
   pattern sono entrambi high-contrast. Stesso layer deterministico già
   definito in B.1.
2. **Conoscenza stilistica osservata** — "questa combinazione viene
   frequentemente usata nello styling contemporaneo". Non una regola,
   un'evidenza con una confidence associata (vedi sotto).
3. **Preferenza individuale** — "questa persona ama Boldness 8". Già
   esistente come `style_boldness` (B.3).

`Fashion knowledge × user preference × context → outfit`. La C alimenta
solo il primo termine; il secondo e il terzo restano quelli già definiti
in B. Vedi il pipeline aggiornato in B.4bis per dove esattamente questo
ramo si innesta — come input parallelo al `candidate ranking`, non come
filtro a monte né come prerequisito perché B funzioni.

## Fonti multiple, pesate — mai trattate come equivalenti

| Fonte | Utilità per outfit quotidiani |
|---|---|
| E-commerce | Alta — outfit pensati per essere venduti/indossati |
| Lookbook brand | Alta — styling professionale, contestualizzato |
| Editorial | Media — creatività e trend, meno diretta come guida quotidiana |
| Street style | Media — combinazioni reali, ma qualità/coerenza variabile |
| Runway | Bassa per uso quotidiano — sperimentazione estrema, non un consiglio per "cosa mettere domani" |

Il punto non è ignorare runway/editorial, è **non confondere** "un brand
l'ha fatto in passerella" con "questa è una buona combinazione per andare
al lavoro domani" — sono segnali di natura diversa, con peso diverso.

## Osservazione, non apprendimento automatico delle regole

AURA non deve modificare le proprie regole ogni volta che trova qualcosa
online. Il modello è `osservazione → evidenza → pattern → confidence`,
mai `osservazione → nuova regola applicata direttamente`. Esempio di forma
dato:
navy + burgundy
observed: 2,481 outfits
contexts:
smart casual: 38%
business: 31%
evening: 22%
confidence: high

Questo è un **segnale** che il livello B.4 (final scoring layer, codice)
può pesare insieme al resto — non un comportamento che si attiva da solo
perché "trovato spesso online".

## Dove si aggancia a Itten (già in B)

Itten dà la struttura teorica (`navy + orange` = complementare, tipo di
contrasto noto); i dati fashion osservati danno evidenza di *come* quelle
relazioni vengono effettivamente usate nella pratica (`navy + burgundy`,
armonia più vicina/controllata, osservata più spesso in contesti business
che in contesti serali). Il boldness dell'utente (B.3) decide quale delle
due evidenze — teorica pura o osservata — pesa di più per quella persona
specifica. Le due cose insieme sono più potenti prese separatamente, ma **C
resta un potenziamento di B, non un sostituto**: senza dati fashion, B deve
comunque funzionare da solo con Itten + regole deterministiche.

## Vincolo non negoziabile: provenienza dati, licenze, copyright

Prima di qualunque uso sistematico di contenuti di siti terzi (e-commerce,
lookbook, editorial, street style, runway) va progettata esplicitamente la
parte di **licenze, termini d'uso, copyright e provenienza dei dati**. Non
è un dettaglio implementativo da risolvere dopo — è un prerequisito di
design alla pari delle soglie di scoring. Non si procede con scraping
indiscriminato: ogni fonte usata sistematicamente richiede una base legale
esplicita (API ufficiale con licenza, partnership, dati open/licenziati),
non semplicemente "il sito è pubblicamente accessibile".

## Nome onesto anche per questa capability

Da chiamare **"Fashion Styling Knowledge Layer"**, non "AI che impara dai
siti" — la seconda espressione implica apprendimento automatico continuo e
non supervisionato, che è esplicitamente ciò che questo design evita
(vedi "osservazione, non apprendimento automatico" sopra).

---

# Cosa NON fare ora (esplicito, per evitare fraintendimenti)

- **Non implementare il motore multi-asse.** Questo documento è la
  specifica, non il codice.
- **Non decidere ora le soglie numeriche esatte** (distanza formalità
  accettabile, quanti colori "sono troppi" in modo assoluto) — vanno
  calibrate su dati reali, non indovinate a tavolino, stesso principio già
  stabilito nel Benchmark Protocol per l'identità visiva.
- **Non implementare A e B insieme nello stesso PR/sessione** quando si
  passerà all'implementazione — sono capability separate, vanno testate
  separatamente per sapere quale delle due migliora o peggiora un
  comportamento osservato.
- **Non toccare il ranking generale già in produzione** (versatility(),
  eligibleFor(), i fix già fatti su borse/scarpe/materiali) come parte di
  questo lavoro — quello resta stabile finché A e/o B non vengono
  effettivamente implementati e verificati.
- **Non aggiungere altre regole di stile al `system` prompt** in
  `ai-suggest-outfit.functions.ts` come soluzione a nuovi casi che
  emergono — è esattamente il pattern che questo documento esiste per
  superare. Un nuovo caso di stile sbagliato è un segnale che manca una
  feature deterministica (B.1) o più contesto per il giudizio AI, non
  un'altra frase da infilare nell'array.
- **Non iniziare la Fashion Styling Knowledge Layer (C) prima che B sia
  in produzione e verificato.** Nessuno scraping, nessuna raccolta dati,
  nessuna pipeline di ingestion — anche solo prototipale — finché Itten +
  Boldness + compatibility + pattern + exposure + formality + accessories
  (B) non funzionano su dati reali.
- **Non usare contenuti di terzi sistematicamente senza aver prima
  progettato licenze/provenienza dati** — vale per C quando arriverà, non
  solo come nota a margine.
