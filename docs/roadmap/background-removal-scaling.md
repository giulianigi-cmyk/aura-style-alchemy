# AURA — Roadmap: Background Removal Scaling (rimandato deliberatamente)

Da committare in `docs/roadmap/background-removal-scaling.md`

Scopo di questo documento: descrivere l'architettura server-side per la rimozione sfondo che **non si costruisce ora**, e perché — così nessuno la riscopre da zero più avanti, e nessuno la confonde con una decisione già presa. Nessuna voce qui è congelata come implementazione, solo come intenzione futura.

## Stato attuale (soluzione per la fase MVP)

Rimozione sfondo interamente client-side, via `@imgly/background-removal` (WASM in-browser), modello quantizzato (`isnet_quint8`), eseguito su web worker. Zero costo marginale, zero infrastruttura aggiuntiva. Nessun fallback automatico a un servizio a pagamento: se il WASM fallisce, l'immagine originale viene conservata e l'utente può ritagliare a mano.

**Perché questa è la scelta giusta ora:** con il volume utenti attuale, qualunque soluzione server-side (self-hosted o a consumo) introduce un costo — fisso o variabile — per un problema che oggi non giustifica quel costo. Coerente con il principio già applicato nel resto di AURA: non si costruisce complessità anticipata per un problema che potrebbe non presentarsi.

## Architettura futura (da costruire solo quando i trigger scattano)


- **Primary:** modello di background removal open-source su Hugging Face Inference Endpoint — stessa infrastruttura/fatturazione già in uso per gli embedding visivi (DINOv2), un modello in più invece di un provider nuovo da imparare e gestire.
- **Fallback:** remove.bg, solo per i casi in cui il modello primario fallisce — non più motore principale.
- **Orchestrazione:** `scan_jobs`, la stessa tabella/coda già costruita per il batch scan — nessuna nuova infrastruttura di code.
- **Cache:** stessa immagine già processata → risultato riusato, non ricalcolato.
- **Ordine nella pipeline di batch scan:** detection/segmentation → crop → background removal, **dopo** l'analisi AI del capo, non prima — così il riconoscimento lavora sull'immagine originale (più informazione), e lo scontorno resta un passaggio di presentazione finale, non una dipendenza del riconoscimento.

## Trigger per riprenderla

Non un numero di utenti da solo — il volume da solo non è necessariamente il problema. Passare alla pipeline server-side quando **almeno una** di queste condizioni è vera:

- il background removal WASM mostra un tasso di fallimento in produzione superiore a una soglia concordata;
- i tempi di elaborazione su dispositivi reali diventano un problema percepibile dagli utenti;
- il volume di immagini rende il caricamento batch (fino a 150 foto) poco affidabile lato client;
- AURA supera una soglia di utenti attivi concordata più avanti, con dati reali di costo/affidabilità alla mano;
- emerge un requisito che il client-side non può soddisfare (es. qualità richiesta più alta di quella del modello quantizzato).

## Nota generale

Implementare oggi solo ciò che serve per il problema attuale. Progettare oggi ciò che servirà quando il problema cambierà. Implementare la seconda parte — questo documento — solo quando i dati lo giustificano, non per anticipazione.
