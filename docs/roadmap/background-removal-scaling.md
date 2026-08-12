# AURA — Roadmap: Background Removal Scaling (rimandato deliberatamente)

Da committare in `docs/roadmap/background-removal-scaling.md`

Scopo di questo documento: descrivere l'architettura server-side per la rimozione sfondo che **non si costruisce ora**, e perché — così nessuno la riscopre da zero più avanti, e nessuno la confonde con una decisione già presa. Nessuna voce qui è congelata come implementazione, solo come intenzione futura.

## Stato attuale (soluzione per la fase MVP)

Rimozione sfondo interamente client-side, via `@imgly/background-removal` (WASM in-browser), modello quantizzato (`isnet_quint8`), eseguito su web worker. Zero costo marginale, zero infrastruttura aggiuntiva. Nessun fallback automatico a un servizio a pagamento: se il WASM fallisce, l'immagine originale viene conservata e l'utente può ritagliare a mano.

**Perché questa è la scelta giusta ora:** con il volume utenti attuale, qualunque soluzione server-side (self-hosted o a consumo) introduce un costo — fisso o variabile — per un problema che oggi non giustifica quel costo. Coerente con il principio già applicato nel resto di AURA: non si costruisce complessità anticipata per un problema che potrebbe non presentarsi.

## Architettura futura (da costruire solo quando i trigger scattano)

