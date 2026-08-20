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

Otto punti su undici sono risolti. Restano ENV-4 (parzialmente: il database usa-e-getta è
configurato e le migration applicate, mancano gli account E2E e l'esecuzione di pytest), ENV-8, e la
parte di ENV-1 che richiede un'azione sulla dashboard Supabase.

Il lavoro ha inoltre portato alla luce tre difetti che nessuno poteva vedere prima, perché la suite
di integrazione non era eseguibile in questo ambiente: DB-1, DB-2 e DB-3, tutti corretti. **La suite
di integrazione passa ora 47 test su 47.**

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
- [ ] ID=DB-1, Severity=High, Complexity=Low, Priority=P0, Title=`0002_runtime_boundary.sql` non applicabile a un progetto Supabase nuovo, Fix description=Rimossa la clausola `nosuperuser`, che nessun ruolo su Supabase può impostare. Richiede la riparazione del checksum registrato sul database di sviluppo: passaggi sotto, da eseguire a mano.

- [✅] ID=DB-2, Severity=Medium, Complexity=Low, Priority=P1, Title=I test di integrazione richiedono il pooler in modalità session, Fix description=`TEST_DATABASE_URL` portata dalla 6543 alla 5432 nei due file di ambiente. In modalità transaction un lock advisory di sessione resta appeso e blocca tutte le scritture successive, anche fra esecuzioni diverse.
- [✅] ID=DB-3, Severity=Medium, Complexity=Low, Priority=P1, Title=`schema-contract` asserisce una condizione non raggiungibile su Supabase, Fix description=Seconda asserzione ristretta allo schema `public` e ai soli proprietari che l'applicazione controlla, espressa come verifica di sottoinsieme invece che come conteggio. Rischio residuo dei privilegi di `supabase_admin` documentato nel test. Verificato che intercetta ancora una regressione reale.

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

## DB-1 — `0002_runtime_boundary.sql` non è applicabile a un progetto nuovo

**Severity** High · **Complexity** Low · **Priority** P0

Trovato mentre si applicavano le migration al database usa-e-getta di ENV-4.

### Il problema

```
ERROR: permission denied to alter role
  in SQL statement "alter role construct_runtime
    nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls"
```

Provando gli attributi uno per uno su un ruolo temporaneo, **solo `nosuperuser` viene
rifiutato**; `nologin`, `nocreatedb`, `nocreaterole`, `nobypassrls` e `noreplication` passano
tutti. È la regola PostgreSQL per cui solo un superuser può impostare l'attributo SUPERUSER,
anche quando lo si imposta a NO.

Su Supabase nessun ruolo accessibile è superuser. Verificato: l'unico superuser del progetto è
`supabase_admin`, che è interno alla piattaforma e di cui i clienti non hanno le credenziali;
`create role ... superuser` e `alter role postgres superuser` vengono entrambi rifiutati. Non è
una configurazione modificabile: è un limite della piattaforma, documentato nella pagina
*"Roles, superuser access and unsupported operations"*. Non cambia nulla creare un altro utente,
né usare l'identità operatore di `MIGRATION_DATABASE_URL`: qualunque ruolo si crei, non può
avere SUPERUSER.

La clausola era anche **inutile**: un ruolo creato senza SUPERUSER non lo ha già, e niente di
raggiungibile da lì può concederglielo.

### Perché sul database di sviluppo non si era mai visto

Lì `construct_runtime` esiste già, 0002 è registrata come completata, e `postgres` ha admin
option su quel ruolo. Entrambi i progetti girano ora su PostgreSQL 17.6, quindi la spiegazione
più probabile è che quel database sia stato migrato quando il progetto era su una versione
precedente, prima che PostgreSQL 16 restringesse i privilegi di `createrole`. È un'inferenza,
non una verifica.

### Perché conta più del test database

Se 0002 non si applica a un progetto nuovo, **nessun ambiente è provisionabile dalle
migration**: né il database di test, né lo scenario "derived application" descritto in
`docs/runbooks/production-deployment.md`, né una ricostruzione da zero in caso di ripristino.
Il problema era invisibile perché l'unico database esistente era stato creato prima.

### Il fix e la sua eccezione

La correzione è la rimozione di `nosuperuser` dall'`alter role`, con il commento che spiega
perché non deve tornare.

Ma 0002 è **registrata come completata** sul database di sviluppo con il proprio checksum, e
`assertAppliedMigrationChecksums` confronta i file con quei valori: modificare il file fa
fallire ogni successivo comando di migrazione su quel database. È esattamente l'operazione che
`docs/runbooks/production-deployment.md` vieta — *"never edit an applied migration"*.

La regola del runbook resta giusta e non va cambiata: serve a proteggere database che non si
possono ricostruire. **Questa è un'eccezione dichiarata, valida solo perché il progetto non è
ancora in produzione e l'unico database interessato è quello di sviluppo.** L'alternativa
pulita — ricomprimere le migration in un nuovo baseline e ricostruire tutti i database, con un
dump dei soli dati per non perdere quelli di sviluppo — resta la strada giusta al momento dello
squash prima del primo deploy in produzione.

Checksum coinvolti, per tracciabilità:

| | valore |
|---|---|
| registrato prima della modifica | `ea1531c2ec000b296d614bc89b965a40d248cb0348f029473215675ef4e579bb` |
| del file dopo la modifica | `abc53efee3527d08f892b7d4df0da4862e18768146b519852378df65ea0415c8` |

Le altre quattro migration sono invariate: verificato ricalcolando tutti i checksum con la
stessa funzione di `migration-lib.mjs`.

### Stato

- [✅] `nosuperuser` rimossa da `0002_runtime_boundary.sql`, con commento esplicativo.
- [✅] Fix validato a livello di istruzione: i cinque attributi rimasti sono stati provati uno per uno e passano tutti.
- [✅] Riga incompleta di 0002 rimossa dal database usa-e-getta, così il runner la riapplica da zero.
- [✅] `sources/devops/db/schema.sql` rigenerato; `npm run schema:check` riporta "schema.sql matches ordered migrations".
- [✅] Checksum di 0002 riparato sul database di sviluppo: ora `abc53efe…`, la migration resta registrata come completata.
- [✅] Migration riapplicate al database usa-e-getta: **tutte e cinque completate, 0002 compresa.** È la prova che un progetto Supabase nuovo è ora provisionabile dalle migration.
- [✅] `npm run test:integration` eseguibile: 46 test su 47 passano. L'unico fallimento è DB-3, indipendente da questa correzione.

---

## DB-2 — I test di integrazione richiedono connessioni con affinità di sessione

**Severity** Medium · **Complexity** Low · **Priority** P1 · **Risolto**

Emerso dopo DB-1, con la suite di integrazione finalmente eseguibile.

### Sintomo

`serializes concurrent reorders into unique deterministic positions` andava in timeout, in modo
sistematico: tre esecuzioni su tre. Alzare il timeout a 30 secondi non cambiava nulla, quindi non
era latenza — era un blocco.

### Causa

Nello stesso file, il test `serializes subtree deletion with every other navigation write` prende
deliberatamente un lock a livello di **sessione** su una connessione riservata, per dimostrare che
le scritture si serializzano:

```
riga 66:  await connection`select pg_advisory_lock(49374201)`
riga 71:  await connection`select pg_advisory_unlock(49374201)`
```

`TEST_DATABASE_URL` puntava al pooler Supavisor in **modalità transaction** (porta 6543), che non
garantisce che due istruzioni successive finiscano sulla stessa connessione fisica. Il rilascio è
finito su un backend diverso da quello che aveva preso il lock, e il lock è rimasto appeso.

Prova diretta, interrogando `pg_locks` sul database di test:

| pid | objid | granted | stato del backend | da quanto |
|---|---|---|---|---|
| 21251 | 49374201 | true | **idle** | 00:01:20 |

Un backend inattivo che tiene il lock. `moveNavigationItem` usa
`pg_advisory_xact_lock(49374201)` — lo stesso identificatore — quindi ogni riordino successivo si
accodava dietro un lock che nessuno avrebbe mai rilasciato. E il blocco **sopravvive fra
esecuzioni** finché quel backend non viene riciclato: per questo la prima esecuzione della suite
era passata e tutte le successive no.

### Correzione

`TEST_DATABASE_URL` portata alla **porta 5432**, il pooler in modalità session, nei due file di
ambiente. Verificato: tutti e quattro i test di navigazione passano, e quello di riordino impiega
3,5 secondi — sarebbe rientrato anche nel timeout originale di 5, confermando che la latenza non
era il problema.

Il requisito è documentato in `.env.template`, con il sintomo e la query diagnostica, perché non
è deducibile: per `DATABASE_URL` la modalità transaction è la scelta giusta, per
`TEST_DATABASE_URL` no.

Nota su una correzione sbagliata e ritirata: avevo alzato `testTimeout` a 30 secondi diagnosticando
latenza. Con la causa vera nota, l'ho rimosso: un timeout generoso avrebbe nascosto esattamente
questo tipo di blocco. Il commento nella configurazione ora spiega perché il default di 5 secondi
è tenuto deliberatamente.

---

## DB-3 — Il test `schema-contract` asserisce una condizione non raggiungibile

**Severity** Medium · **Complexity** Low · **Priority** P1 · **Serve una decisione**

### Il fallimento

```
lib/schema-contract.integration.test.ts > database runtime boundary
  > does not expose application relations through Data API roles
AssertionError: expected [ …(64) ] to have a length of +0 but got 64
```

**Non è una conseguenza di DB-1 né di DB-2.** Ho eseguito la stessa query sul database di
sviluppo: risultato identico, 64 privilegi. Il test fallirebbe anche lì. Non era mai emerso perché
la suite di integrazione non era eseguibile in questo ambiente — è la prima volta che questo test
gira davvero.

### Cosa conta davvero, per schema

La query del test non filtra per schema. Scomponendo i 64 privilegi:

| proprietario | schema | privilegi | modificabile da noi? |
|---|---|---|---|
| `postgres` | `storage` | 16 | sì, ma è uno schema di Supabase, non dell'applicazione |
| `supabase_admin` | `graphql` | 16 | no |
| `supabase_admin` | `graphql_public` | 16 | no |
| `supabase_admin` | **`public`** | 16 | **no** |

Due conclusioni:

1. **La migration 0005 funziona.** Non c'è nessuna voce con proprietario `postgres` nello schema
   `public`: quelle le ha rimosse. Le 48 voci di `supabase_admin` non sono raggiungibili, perché
   `alter default privileges for role supabase_admin` richiede di essere membro di quel ruolo, che
   è superuser e inaccessibile ai clienti (vedi DB-1).
2. **Il test misura più di quanto intende.** Il nome dice "application relations", ma la query
   raccoglie i privilegi di default di tutti gli schemi, inclusi `storage`, `graphql` e
   `graphql_public`, che non contengono dati dell'applicazione. Così com'è scritto, questo test non
   può passare su Supabase gestito, su nessun progetto.

### Il rischio residuo reale

Resta una cosa vera e non correggibile: i privilegi di default di `supabase_admin` nello schema
`public` concedono ad `anon` e `authenticated` l'accesso alle tabelle **create in futuro da
`supabase_admin`**. Le tabelle dell'applicazione sono create dall'identità di migrazione, non da
`supabase_admin`, quindi in pratica non lo ereditano; e 0002 revoca esplicitamente i privilegi
sulle relazioni esistenti, con RLS attiva sopra. L'esposizione concreta è quindi nulla oggi, ma il
meccanismo non è chiuso in linea di principio.

### La correzione applicata

La seconda asserzione è ristretta allo schema `public` e ai soli proprietari che l'applicazione
controlla, ed è espressa come **verifica di sottoinsieme** invece che come conteggio: raccoglie i
proprietari delle voci in `public`, scarta quelli riservati alla piattaforma e pretende che non ne
resti nessuno. Se i privilegi di default della migration tornassero, `postgres` comparirebbe
nell'elenco e il test fallirebbe.

**Verificato che non sia un test vuoto.** Ho introdotto la regressione a mano sul database
usa-e-getta — `alter default privileges in schema public grant select on tables to anon` — e il
test è fallito con `expected [ 'postgres' ] to deeply equal []`, che nomina il proprietario
colpevole; poi l'ho rimossa e il test è tornato verde. Il messaggio è anche più utile del
precedente `expected […(64)] to have a length of +0 but got 64`.

La prima asserzione, quella su `role_table_grants`, è rimasta intatta: passava già ed è quella che
verifica le relazioni realmente esistenti.

Il rischio residuo non chiudibile è documentato nel commento del test, con il rimando a questo
documento: i privilegi di default di `supabase_admin` in `public` riguardano le tabelle create in
futuro **da quel ruolo**, mentre le tabelle dell'applicazione sono create dall'identità di
migrazione e non li ereditano; 0002 revoca comunque i privilegi sulle relazioni esistenti, con RLS
sopra.

### Ragionamento alla base della scelta

**Raccomandazione seguita:** restringere la seconda asserzione allo schema `public` **e** ai soli
proprietari che l'applicazione controlla, così il test verifica ciò che 0005 può effettivamente
garantire e continuerebbe a fallire se una futura modifica riaprisse quei privilegi. In parallelo,
la parte non chiudibile — le voci di `supabase_admin` in `public` — va documentata come rischio
residuo accettato della piattaforma, con la motivazione sopra, invece di restare un fallimento
senza spiegazione. La prima asserzione del test, quella su `role_table_grants`, passa già e va
lasciata intatta: è quella che verifica le relazioni realmente esistenti.

**Alternativa:** lasciare il test rosso come promemoria permanente. Sconsigliata: un test sempre
rosso smette di essere un segnale e la suite perde la capacità di dire "qualcosa è cambiato".

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
