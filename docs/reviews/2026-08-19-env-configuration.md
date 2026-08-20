# Review — Variabili d'ambiente, file `.env` e script (2026-08-19)

Scope: collocazione delle variabili d'ambiente fra i file `.env`, coerenza fra `.env.template` e i
file locali reali, ed eseguibilità degli script (`build`, `test:integration`, `pytest`) partendo
dall'ambiente documentato.

Origine: indagine partita dal fallimento di `npm run build` durante THEME-1, in
[2026-08-19-ui-primitives-and-theming.md](2026-08-19-ui-primitives-and-theming.md).

## Sommario

Il problema d'ingresso era che `npm run build` non era eseguibile in locale: falliva su
`assertSafeAuthConfiguration` con *"Test authentication must not be configured in production"*.

La causa non era la guardia, che funziona correttamente, ma **la collocazione delle variabili**.
`.env.local` è caricato da `next dev`, `next build` e `next start` allo stesso modo, quindi
`AUTH_TEST_CREDENTIALS=true` raggiungeva il build in modalità produzione. La guardia fail-closed era
diventata un ostacolo invece di una protezione, e l'unico modo di lavorare era azzerare i flag a mano
ogni volta.

Indagando è emerso che il disallineamento era più ampio: tre variabili morte in `.env.local` (fra cui
una service-role key che bypassa RLS, orfana dalla rimozione di `@supabase/supabase-js` nel commit
`b9f3edf`), una riga `NODE_ENV` inerte che rendeva incomprensibile il fallimento, `.env.template`
andato alla deriva rispetto ai file reali in entrambe le direzioni, `CLAUDE.md` che dichiarava uno
stack non più vero, e i test che scrivono sul database non eseguibili per variabili mancanti.

Cinque punti su otto sono stati risolti (commit `761b144`). Restano ENV-4, ENV-7 ed ENV-8, più la
parte di ENV-1 che richiede un'azione sulla dashboard Supabase.

### La regola che risolve la classe di problemi

Next carica file diversi a seconda del comando, e `process.env` batte sempre i file `.env`:

| File | `next dev` | `next build` / `next start` |
|---|---|---|
| `.env.development.local` | sì | **no** |
| `.env.production.local` | no | sì |
| `.env.local` | sì | sì |
| `.env` | sì | sì |

Quindi la domanda per ogni variabile non è "dove la metto" ma **"chi la legge, e in quale comando
deve esistere"**. `.env.development.local` è l'unico posto che un build di produzione non vede.

## Task

- [✅] ID=ENV-1, Severity=Medium, Complexity=Low, Priority=P0, Title=Rimuovere le variabili Supabase morte, Fix description=Rimosse `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` da `.env.local`: nessuna è letta da alcuna riga di codice. **Resta da fare all'utente:** revocare la service-role key dalla dashboard Supabase (vedi sotto).
- [✅] ID=ENV-2, Severity=High, Complexity=Low, Priority=P1, Title=Spostare le variabili solo-dev in `.env.development.local`, Fix description=`AUTH_TEST_CREDENTIALS`, `NEXT_PUBLIC_AUTH_TEST_MODE` ed `EMAIL_DEV_OVERRIDE` spostate. Verificato: `npm run build` compila senza interventi manuali, `next dev` registra ancora il provider `test` e mostra il pulsante di login di test.
- [✅] ID=ENV-3, Severity=Low, Complexity=Low, Priority=P1, Title=Togliere `NODE_ENV` da `.env.local`, Fix description=Rimossa. Verificato con controprova che nessuno script dipendeva da quella riga.
- [ ] ID=ENV-4, Severity=Medium, Complexity=Low, Priority=P1, Title=Database usa-e-getta per i test che scrivono, Fix description=Creare un progetto Supabase separato, popolare `TEST_DATABASE_URL` e `TEST_DATABASE_DISPOSABLE=1` in `.env.local` e in `sources/tests/e2e/.env.test`, applicare le migration e promuovere l'account admin. **Richiede una decisione umana:** vedi sotto.
- [✅] ID=ENV-5, Severity=Low, Complexity=Low, Priority=P2, Title=Riallineare `.env.template`, Fix description=Riscritto con la tabella di caricamento per comando, l'indicazione del file di destinazione per ogni variabile, `EMAIL_DEV_OVERRIDE` documentato, la nota su `sources/tests/e2e/.env.test` e il divieto esplicito su `NODE_ENV`.
- [✅] ID=ENV-6, Severity=Low, Complexity=Low, Priority=P3, Title=Correggere lo stack dichiarato in `CLAUDE.md`, Fix description=Rimosso `@supabase/supabase-js`, sostituito con Drizzle su Postgres e la nota che Supabase resta solo come host.
- [✅] ID=ENV-7, Severity=Low, Complexity=Low, Priority=P3, Title=Eliminare il sourcing manuale dell'env nei test di integrazione, Fix description=`vitest.integration.config.ts` carica l'env con `loadEnv('test', ...)` di Vite (nessuna dipendenza nuova), con precedenza all'ambiente già presente. Le credenziali del database usa-e-getta vanno in `.env.test.local`, fuori da `.env.local` e quindi fuori da ogni processo Next. Comando in `CLAUDE.md` e `.env.template` aggiornati.
- [ ] ID=ENV-8, Severity=Low, Complexity=Medium, Priority=P3, Title=Guard automatico sul contratto delle variabili d'ambiente, Fix description=Test che confronta le variabili lette nel codice con quelle documentate in `.env.template`, fallendo su quelle lette e non documentate e riportando quelle documentate e non lette.

---

## ENV-1 — Variabili Supabase morte (parte residua)

**Stato** file già ripulito · **Resta** un'azione sulla dashboard, non eseguibile da qui

Tre variabili non erano lette da nessuna riga di codice, verificato su tutto `sources/`:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Il loro
consumatore era `@supabase/supabase-js`, rimosso dal commit `b9f3edf` ("remove @supabase/supabase-js
now that every call site uses Drizzle"). Sono rimaste orfane da allora.

### Urgenza: bassa, non è mai stata esposta

Verificato sulla storia git: `.env.local` non è mai stato tracciato in alcun commit su alcun branch,
e il prefisso JWT `eyJhbGciOiJIUzI1NiIs` non compare in nessun commit. Il solo *nome*
`SUPABASE_SERVICE_ROLE_KEY` appare in codice, documenti e template k8s, che è normale.

Il controllo copre questo repository e nient'altro: un'esposizione altrove (variabile di CI, file
condiviso, altra macchina) non è verificabile da qui.

### Cosa resta da fare, e perché non posso farlo io

Una service-role key bypassa RLS. Rimuoverla dal file non la invalida: se è ancora attiva sul
progetto Supabase, resta una credenziale valida senza alcun consumatore legittimo.

Dalla documentazione Supabase, la `service_role` legacy **non è ruotabile**: *"it is no longer
possible to rotate the legacy anon, service and JWT secrets"*, perché derivata dal JWT secret del
progetto. Il percorso attuale è sostituirla con una *secret key* (`sb_secret_...`) da
Dashboard → Settings → API Keys, spostare i consumatori e poi eliminare la vecchia.

Nel caso di Construct non serve nemmeno la sostituzione: non esiste un consumatore da migrare, quindi
la chiave va semplicemente disabilitata o eliminata.

Lo stato del progetto è già pronto per farlo: convivono la `anon` legacy e una publishable key
moderna (`sb_publishable_...`), quindi il nuovo sistema di API key è attivo.

- [ ] Verificare che nessun altro consumatore usi la `service_role` — altri servizi, job di CI, automazioni, altre applicazioni sullo stesso progetto Supabase.
- [ ] Disabilitare o eliminare la `service_role` legacy da Dashboard → Settings → API Keys. **L'eliminazione di una secret key è irreversibile.**

**Scadenza correlata:** le chiavi legacy `anon`/`service_role` funzionano fino alla fine del 2026.
Construct non usa nessuna delle due, ma la `anon` legacy risulta ancora attiva sul progetto: se
qualcos'altro la sta usando, va migrato alla publishable key entro l'anno.

---

## ENV-4 — Database usa-e-getta per i test che scrivono

**Severity** Medium · **Complexity** Low · **Priority** P1

### Cosa blocca oggi

Due suite non sono eseguibili:

```
npm run test:integration  →  Error: TEST_DATABASE_URL is required for mutating integration tests
uv run pytest             →  Set TEST_DATABASE_URL to a dedicated disposable database
```

`sources/tests/e2e/.env.test` manca `TEST_DATABASE_URL` e `TEST_DATABASE_DISPOSABLE` rispetto al
proprio `.env.test.example`, che è tracciato e li elenca. Le stesse due variabili mancano in
`.env.local`, dove servono per la suite di integrazione: sono due file letti da processi diversi
(Vitest e pytest), quindi vanno popolati entrambi.

I tre punti di controllo richiedono la stringa esatta `"1"` — vuoto, `0`, `true` bloccano tutti:

| File | Controllo |
|---|---|
| `lib/test-database.ts:6` | `if (env.TEST_DATABASE_DISPOSABLE !== '1') throw` |
| `sources/devops/db/db.mjs:50` | `if (process.env.TEST_DATABASE_DISPOSABLE !== '1') throw` |
| `sources/tests/e2e/conftest.py:25` | `if os.getenv("TEST_DATABASE_DISPOSABLE") != "1": pytest.exit(...)` |

### Perché richiede una decisione umana

`TEST_DATABASE_DISPOSABLE=1` non è configurazione: è la conferma esplicita che il database indicato
può essere distrutto. Impostarlo su un URL sbagliato distrugge dati. Non è un valore che un assistente
possa certificare al posto di una persona, e per questo ENV-4 resta aperto anche se meccanicamente
banale.

Va inoltre preferito un **progetto Supabase separato**, non un altro database dentro il progetto che
serve `DATABASE_URL`. Il controllo anti-errore confronta i due URL per uguaglianza esatta di stringa,
quindi due connection string diverse verso lo stesso database — il pooler sulla 6543 e la connessione
diretta sulla 5432, o lo stesso database con un utente diverso — passerebbero il controllo. Un
progetto separato rende l'errore impossibile invece che improbabile.

### Cosa non serve preparare

Il database va creato **vuoto**. `node sources/devops/db/db.mjs test-apply` applica le stesse
migration checksummate e costruisce tabelle, indici, funzioni, policy RLS e tutti i dati di
riferimento. Nessun dump da importare, nessun seed da caricare a mano.

L'unica eccezione sono gli utenti, e in gran parte si risolve da sé — la procedura completa è ora
documentata in `README.md`, sezione "Bootstrapping the two E2E accounts on a fresh database":
il provider di test crea la riga utente al primo login e `users.id_user_status` vale `2` (Active) per
default, quindi l'account non-admin non richiede nulla; il ruolo Administrator va concesso una volta
con un `insert` diretto, perché su un database fresco non esiste un admin che possa concederlo
dall'interfaccia.

### Passi

- [ ] Creare un progetto Supabase separato e sacrificabile.
- [ ] Popolare `TEST_DATABASE_URL` e `TEST_DATABASE_DISPOSABLE=1` in `sources/microservices/web-construct/.env.local` e in `sources/tests/e2e/.env.test`.
- [ ] `node sources/devops/db/db.mjs test-apply`.
- [ ] Primo login di test con `TEST_EMAIL`, poi promuoverlo ad Administrator come da README.
- [ ] `npm run test:integration` verde.
- [ ] `uv run pytest sources/tests/e2e` verde.

---

## ENV-7 — Eliminare il sourcing manuale dell'env

**Severity** Low · **Complexity** Low · **Priority** P3

`CLAUDE.md` documenta il comando dei test di integrazione così:

```bash
set -a && . ./.env.local && set +a && npm run test:integration
```

Il sourcing manuale serve perché Vitest, a differenza di Next, non legge i file `.env`. Funziona, ma
è cerimonia che si dimentica: senza il prefisso il comando falla con un errore su
`TEST_DATABASE_URL` che non suggerisce la causa vera.

Il posto naturale è `vitest.integration.config.ts`, che già esiste e ha un commento esteso sulle
proprie scelte. Caricare l'env lì rende `npm run test:integration` autosufficiente.

Da decidere: quali file caricare e in quale ordine. Se si replica la precedenza di Next
(`.env.development.local` prima di `.env.local`) si ottiene coerenza con l'applicazione; se si carica
solo `.env.local` il comportamento è più semplice da spiegare. **Raccomandazione:** solo `.env.local`,
perché i test di integrazione non devono dipendere da flag di sviluppo.

### Criteri di accettazione

- [ ] `npm run test:integration` funziona senza prefisso di sourcing.
- [ ] Il comando in `CLAUDE.md` è aggiornato di conseguenza.
- [ ] Le variabili già presenti nell'ambiente continuano a prevalere sui file, come fa Next.

---

## ENV-8 — Guard automatico sul contratto delle variabili d'ambiente

**Severity** Low · **Complexity** Medium · **Priority** P3

### Perché

Dei sei problemi trovati in questa indagine, cinque erano forme di deriva silenziosa fra ciò che il
codice legge e ciò che i file documentano:

| Problema | Direzione della deriva |
|---|---|
| tre variabili Supabase in `.env.local` | documentate/presenti ma non lette da nessuno |
| `EMAIL_DEV_OVERRIDE` assente dal template | letta dal codice ma non documentata |
| `LOG_LEVEL` nel template, assente nei file locali | documentata ma non configurata |
| `TEST_DATABASE_*` nel template, assenti nei file locali | documentate ma non configurate |
| `NODE_ENV` in `.env.local` | presente ma inerte |

Un guard automatico le avrebbe intercettate tutte al primo commit invece che mesi dopo, per caso,
durante un fix su un tema.

### Progetto

Sullo stesso modello di I18N-1 in
[2026-08-19-i18n-key-inventory.md](2026-08-19-i18n-key-inventory.md), e con lo stesso precedente
strutturale (`sources/devops/docs-contract.test.mjs`, eseguito da `npm run test:docs-contract`).

- **Lato codice:** estrarre le occorrenze di `process.env.X` e `env.X` da `sources/`. Attenzione ai
  falsi positivi: `lib/auth-policy.ts` e `lib/test-database.ts` ricevono l'ambiente come parametro
  tipizzato (`AuthEnvironment`, `DatabaseEnvironment`) invece di leggere `process.env` direttamente,
  quindi una scansione sul solo `process.env.` le manca.
- **Lato documentazione:** estrarre i nomi di variabile da `.env.template`, incluse le righe
  commentate della sezione `[SOLO DEV]`.
- **Fallimento duro** su una variabile letta dal codice e non presente nel template: è la direzione
  che produce bug silenziosi in un ambiente nuovo.
- **Report informativo** sulla direzione opposta, con una lista di esclusioni commentate per le
  variabili legittimamente non lette da questo codice (`MIGRATION_DATABASE_URL`,
  `CONSTRUCT_RUNTIME_DB_*`, le `SMTP_*` quando `MAIL_PROVIDER=resend`).

Non deve leggere i file `.env` reali: sono gitignorati e diversi su ogni macchina. Il contratto è
fra **codice e template**, entrambi versionati.

### Criteri di accettazione

- [ ] Il test gira senza database e senza file `.env` presenti.
- [ ] Falla se una variabile letta dal codice non è nel template, salvo esclusioni commentate.
- [ ] Riporta le variabili del template non lette dal codice.
- [ ] Sul repo allo stato attuale: verde.
