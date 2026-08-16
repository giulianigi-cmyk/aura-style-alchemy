Questa è l'architettura a cui il prompt-based system di oggi deve arrivare
— per sostituzione dei singoli stadi, non per riscrittura totale in un
colpo solo. Ogni stadio è testabile ed evolvibile indipendentemente dagli
altri, che è esattamente ciò che il mega-prompt attuale non permette.

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
