# Piano: modifiche al backend senza accesso diretto a Supabase

## Contesto
L'app AURA gira su Lovable Cloud (backend Supabase gestito). Per policy di sicurezza, l'ID progetto, l'URL Supabase e il link al dashboard non vengono condivisi con l'utente. Questo non blocca le modifiche, ma richiede di agire attraverso i canali sicuri della piattaforma.

## Opzioni per fare modifiche al backend

1. **Chiedere a me (Lovable agent) di eseguire migration/policy/query**
   - SQL migrations tramite `supabase--migration`
   - Query di lettura con `supabase--read_query`
   - Modifiche RLS/policies/funzioni
   - Gestione storage, bucket, auth settings

2. **Usare la UI di Lovable Cloud nel progetto**
   - Database → tabelle, RLS policies, SQL editor visuale
   - Storage → bucket, policy, upload
   - Auth → provider, email templates, impostazioni
   - Secrets → variabili d'ambiente

3. **Se hai bisogno di un export dati**
   - Cloud → Advanced settings → Export data
   - Lovable prepara l'export e ti avvisa quando è pronto

## Cosa serve sapere
Per procedere, ho bisogno che l'utente mi dica:
- Quale tabella, policy, funzione o configurazione vuole modificare
- Se si tratta di una migration strutturale, di un fix dati, o di una configurazione auth/storage
- Se preferisce che io esegua direttamente o che lo faccia tramite la UI Cloud

## Prossimo passo
L'utente specifica la modifica richiesta; io la eseguo con gli strumenti Lovable Cloud o indico i passaggi nella UI Cloud.
