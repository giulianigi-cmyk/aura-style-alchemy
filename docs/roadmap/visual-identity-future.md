# AURA — Roadmap: Visual Identity (rimandato deliberatamente)

> Da committare in `docs/roadmap/visual-identity-future.md`
> Scopo di questo documento: elencare cosa **non** si costruisce ora, e perché — così nessuno lo riscopre da zero tra sei mesi, e nessuno lo confonde con una decisione già presa.
> Nessuna voce qui è congelata (vedi `docs/ADR/001-visual-identity.md`) né in esecuzione (vedi `docs/benchmarks/001-visual-identity-benchmark.md`).

---

## Ricerca visiva nel guardaroba

**Cosa sarebbe**: "trovami tutti i blazer simili a questo", "cerca questo capo nel guardaroba", "qual è il capo più simile che possiedo?".

**Perché è rimandata**: stessa infrastruttura della deduplicazione (stesso embedding, stessa tabella `visual_embeddings`, pgvector già pronto) — cambia solo l'interfaccia utente sopra, non il livello sotto. Non c'è motivo di costruirla prima che la deduplicazione stessa sia validata in produzione.

**Trigger per riprenderla**: la deduplicazione è in produzione da un periodo ragionevole senza problemi aperti, e c'è una richiesta reale (propria o di utenti) per la ricerca per somiglianza.

---

## Modelli alternativi oltre DINOv2-Base

**Cosa sarebbe**: confronto sistematico con FashionCLIP, SigLIP o altri modelli fashion-specific, anche se il Benchmark Protocol ha già dato PASS su DINOv2-Base.

**Perché è rimandata**: il benchmark risponde a "questa tecnologia funziona per il caso d'uso?", non "qual è il massimo assoluto ottenibile?". Se DINOv2-Base passa i criteri di separazione, cercare oltre è ottimizzazione a rendimento decrescente.

**Trigger per riprenderla**: il benchmark fallisce anche dopo aver ottimizzato preprocessing e rappresentazione (fase 3 del protocollo), oppure dati reali di produzione mostrano un tasso di falsi positivi/negativi che DINOv2-Base non risolve.

---

## Rappresentazioni avanzate (patch pooling, combinazione CLS+patch)

**Cosa sarebbe**: usare i vettori per-patch di DINOv2 invece del solo vettore globale (CLS token), potenzialmente più adatti a distinguere capi molto simili (stesso colore/categoria, brand diverso).

**Perché è rimandata**: è la fase 2 del Benchmark Protocol — si testa solo se il preprocessing ottimizzato (fase 1) non basta da solo.

**Trigger per riprenderla**: già previsto nel protocollo stesso, non serve un trigger separato.

---

## Worker automatico di retry avanzato

**Cosa sarebbe**: un sistema che rileva job bloccati in `processing`, applica backoff esponenziale, distingue errori transitori (cold-start GPU) da errori permanenti, alerta automaticamente.

**Perché è rimandata**: l'ADR (D6) prevede solo `pg_cron` + scrittura condizionata come meccanismo minimo. Un sistema di recupero automatico più sofisticato è complessità anticipata per un problema che potrebbe non presentarsi quasi mai.

**Trigger per riprenderla**: i fallimenti osservati in produzione superano una frequenza che rende insostenibile il retry manuale del singolo capo.

---

## Migrazione o affiancamento di un secondo provider

**Cosa sarebbe**: usare un provider diverso da Hugging Face Inference Endpoints (es. Replicate, endpoint self-hosted) per costo, latenza o affidabilità.

**Perché è rimandata**: l'interfaccia (`Embedding Provider Interface`, D1 dell'ADR) rende il cambio possibile senza toccare il resto dell'app, ma resta comunque un lavoro non banale (nuova configurazione, nuovo adapter, nuova validazione operativa) — non lo si fa preventivamente.

**Trigger per riprenderla**: costi osservati fuori scala rispetto alle stime, oppure problemi di affidabilità/latenza ricorrenti con HF in produzione.

---

## Garanzie contrattuali sul trattamento dati (DPA con provider terzo)

**Cosa sarebbe**: verifica formale dei termini di trattamento dati di Hugging Face per foto di utenti reali (rilevante se AURA ha utenti oltre alla fase di sviluppo/test personale).

**Perché è rimandata**: in fase di validazione con dati propri il rischio è basso; diventa rilevante solo quando ci sono utenti reali le cui foto (corpo, volto, capi) transitano su un servizio terzo.

**Trigger per riprenderla**: prima di aprire la funzione a utenti reali oltre il founder stesso — non dopo.

---

## Nota generale

Ogni voce qui sopra ha un trigger esplicito. Se una voce viene ripresa, si sposta prima nel Benchmark Protocol (se è ancora un'ipotesi da validare) o direttamente nell'ADR (se è già chiaro che va implementata) — non si implementa direttamente da qui.
