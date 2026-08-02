# AURA — Benchmark Protocol: Visual Identity

> Da committare in `docs/benchmarks/001-visual-identity-benchmark.md`
> Scopo di questo documento: **solo il protocollo sperimentale**. Le decisioni già congelate sono in `docs/ADR/001-visual-identity.md` e non si ridiscutono qui.
> Domanda a cui questo protocollo deve rispondere: **"posso usare questa tecnologia in produzione?"** — non "qual è l'architettura ottimale in assoluto".

---

## Dataset

- [ ] 30 capi totali, scelti includendo casi difficili (vedi sotto)
- [ ] 3 foto per capo minimo, in condizioni diverse:
  - [ ] luce diversa (naturale / artificiale)
  - [ ] piegato
  - [ ] appeso
  - [ ] indossato (outfit scan)
- [ ] 30 coppie "stesso capo" (foto diverse dello stesso oggetto)
- [ ] almeno 15-20 coppie "capi diversi ma simili" — casi difficili deliberati:
  - [ ] due camicie bianche diverse
  - [ ] due jeans blu diversi
  - [ ] due blazer neri diversi (brand diversi)
  - [ ] due sneakers bianche diverse

I casi difficili contano più del numero totale di foto: sono quelli che decidono se il sistema è utile o no.

---

## Metriche (due, mai una sola)

- [ ] **Intra-item consistency**: quanto resta simile lo stesso capo tra le sue foto in condizioni diverse (luce, posa, stato).
- [ ] **Inter-item separability**: quanto restano distinguibili capi diversi ma visivamente simili.

Un solo numero aggregato non è sufficiente — nasconde *quale* dei due problemi c'è, se c'è.

Diagnosi:

| Intra | Inter | Interpretazione |
|---|---|---|
| Alta | Alta | PASS |
| Alta | Bassa | Modello/rappresentazione poco discriminativi |
| Bassa | Alta | Preprocessing instabile (luce/posa/crop) |
| Bassa | Bassa | Rivedere l'intera pipeline prima di cambiare un solo componente |

---

## Ordine degli esperimenti (sequenza greedy, non fattoriale completo)

Non testare tutte le combinazioni insieme. Fermarsi al primo PASS.

```
1. Preprocessing (baseline: DINOv2-Base + CLS token, fisso)
   □ variante A: crop rettangolare
   □ variante B: segmentazione + rimozione sfondo
   □ variante C: con/senza normalizzazione ombra
        ↓
   Misura intra + inter → PASS? → FERMATI, vai a "Decisione finale"
        ↓ FAIL
2. Rappresentazione (preprocessing migliore fissato)
   □ CLS token (baseline)
   □ pooling patch token
   □ combinazione CLS + patch
        ↓
   Misura intra + inter → PASS? → FERMATI
        ↓ FAIL
3. Modello (preprocessing + rappresentazione migliori fissati)
   □ DINOv2-Base (baseline)
   □ FashionCLIP o altra alternativa fashion-specific
        ↓
   Misura intra + inter → PASS? → FERMATI
        ↓ FAIL
4. Se tutti e tre falliscono: fermarsi e rivalutare la strategia
   (non è un problema di parametri, è un problema di approccio)
```

---

## Criterio di stop (relativo, non percentuali a tavolino)

> **PASS** = il valore peggiore osservato di intra-item consistency supera il valore migliore osservato di inter-item similarity tra capi diversi ma simili.

Non usare soglie fisse decise ora (es. "95%"): nessun dato reale le sostiene ancora. Il criterio è la separazione tra i due gruppi, misurata sul dataset di test — stesso principio già validato nella prima versione del criterio di successo, applicato ora alle due metriche separate invece che a una sola.

**Raggiunto il PASS**: ulteriori ottimizzazioni (patch pooling, modelli alternativi) si rimandano fino a quando dati reali di produzione mostrano un problema — non si continua a cercare il massimo assoluto.

---

## Decisione finale

- [ ] PASS con preprocessing (fase 1) → si procede, rappresentazione e modello restano DINOv2-Base + CLS
- [ ] PASS con rappresentazione (fase 2) → si procede, si aggiorna l'ADR con la rappresentazione scelta
- [ ] PASS con modello alternativo (fase 3) → si procede, si aggiorna l'ADR con il modello scelto
- [ ] FAIL su tutte e tre → si sospende l'implementazione, si torna a rivalutare la strategia con dati reali alla mano

Ogni PASS che comporta una scelta diversa dalla baseline (DINOv2-Base + CLS) richiede un aggiornamento esplicito di `docs/ADR/001-visual-identity.md` — nuova voce, non riscrittura silenziosa.

---

## Stato

- [ ] Non eseguito
- [ ] In corso
- [ ] Completato — risultato: ______

Data prevista: ______
Ultima esecuzione: ______
