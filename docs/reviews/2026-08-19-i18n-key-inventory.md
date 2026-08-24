# Review — Inventario automatico delle chiavi i18n (2026-08-19)

Scope: rilevamento delle chiavi di traduzione seedate e mai referenziate dal codice, e viceversa.
Include un prototipo funzionante dello strumento e i risultati che produce oggi sul repo. Nessuna
modifica applicata.

Documenti correlati: [2026-08-19-icon-picker-cleanup.md](2026-08-19-icon-picker-cleanup.md),
[2026-08-19-ui-primitives-and-theming.md](2026-08-19-ui-primitives-and-theming.md).

## Sommario

L'analisi è partita da tre chiavi orfane nel namespace `icon_picker`, scoperte indagando il
componente morto di DEAD-1. Costruendo un prototipo di inventario per verificarle, il numero reale è
risultato molto più alto: **19 chiavi seedate e mai referenziate dal codice**, che diventeranno **22**
quando DEAD-1 sarà completato (il file morto è l'unico a referenziare le tre chiavi `icon_picker`, e
quindi oggi le maschera).

Fra queste, almeno una non è semplice disordine: `auth.login.error_password_not_set` è seedata con
descrizione "Login error: PasswordNotSet", ma la stringa `PasswordNotSet` **non esiste in nessun
punto del codice** — né come errore prodotto dal livello di autenticazione, né nella mappa
`ERROR_KEYS` di `Login.tsx` che traduce i codici di errore in chiavi. È un messaggio utente
progettato, tradotto in due lingue e mai collegato. Questo è il motivo per cui vale la pena
automatizzare l'inventario: non serve a fare pulizia estetica, serve a far emergere comportamenti
progettati e mai cablati.

**Approccio scelto: nessuna cancellazione di dati.** Lo strumento produce un inventario e fallisce
solo sui casi che sono bug certi. Le chiavi orfane restano nel database e diventano un output
diagnostico invece di un problema invisibile. Questo evita completamente la questione delle migration
— nessuna riga da cancellare significa nessuna migration da scrivere e nessun rischio di toccare
`0001_baseline.sql`, che è immutabile per contratto
(`docs/runbooks/production-deployment.md`: *"never edit an applied migration"*).

Oggi non esiste nulla di simile: l'unico inventario è
`docs/superpowers/plans/2026-07-28-i18n-label-inventory.md`, compilato a mano una volta durante il
Task 15 e ormai fermo. Un guard automatico lo sostituisce e non invecchia.

## Task

- [✅] ID=I18N-1, Severity=Low, Complexity=Medium, Priority=P2, Title=Guard automatico sull'inventario delle chiavi i18n, Fix description=Aggiunto `sources/devops/i18n-key-inventory.test.mjs`, eseguito da `npm run test:i18n-keys` e inserito in `.github/workflows/quality.yml` accanto a `test:docs-contract`. Fallimento duro sulle chiavi referenziate e non seedate, report informativo sulle 22 orfane. Nessun dato cancellato, nessuna migration nuova.
- [✅] ID=I18N-2, Severity=Medium, Complexity=Low, Priority=P2, Title=`auth.login.error_password_not_set` è un messaggio mai raggiungibile, Fix description=Deciso di **non cablare**. Il codice contiene tre misure anti-enumerazione convergenti (hash fittizio in `auth-policy.ts`, ragione del rifiuto solo nel log in `auth.ts`, risposta indistinguibile in `forgot-password/route.ts`): mostrare quel messaggio direbbe a un attaccante che l'indirizzo esiste ed è un invito in attesa. La chiave resta seedata e non referenziata per scelta, annotata come tale nell'inventario di I18N-1.

---

## I18N-1 — Guard automatico sull'inventario delle chiavi

**Severity** Low · **Complexity** Medium · **Priority** P2

### Come sono seedate le chiavi

Tutte le chiavi vivono in `sources/devops/db/migrations/0001_baseline.sql`, in **16 blocchi** di
questa forma:

```sql
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"errors.page_title", "namespace":"errors","module":"core","description":"...","it":"...","en":"..."},
    ...
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
```

Le altre migration (0002-0005) non contengono seed di traduzioni. In totale **323 chiavi seedate**.

Due proprietà rilevanti per il progetto dello strumento:

1. **`apply_translation_seed` è puramente additiva.** La funzione fa
   `insert ... on conflict (key) do nothing` sia su `translation_key` sia su `translation_value`.
   Non cancella e non aggiorna nulla. Conseguenza pratica: rimuovere una chiave dal testo di un seed
   non la rimuove da nessun database già seedato. È un altro motivo per cui la strada della
   cancellazione è inefficace, oltre che vietata dal contratto sulle migration.
2. **`sources/devops/db/schema.sql` è uno snapshot generato**, non una fonte indipendente: è la
   concatenazione delle migration, prodotta da `db.mjs schema-write` e verificata da
   `npm run schema:check`. Lo strumento deve leggere **solo** `migrations/`, altrimenti conta ogni
   chiave due volte.

### Come sono referenziate le chiavi nel codice

La firma è `type TranslateFn = (key: string, params?: TranslationParams) => string`
(`lib/i18n/types.ts`). Verificato sul sorgente:

- **Nessun uso di template literal** in `t()`: `grep -rn 't(`'` non restituisce nulla. Questo elimina
  l'intera classe di falsi negativi da chiavi costruite a runtime.
- **Una sola indirezione**, in `components/Login.tsx:11-17`: una mappa `ERROR_KEYS` che associa
  codici di errore a chiavi. I valori sono string literal, quindi restano visibili a una scansione
  testuale.
- Le etichette delle voci di navigazione **non** usano chiavi di traduzione: `navigation_item` porta
  un proprio JSONB `item_translation` inline. Nessun falso positivo da quella parte.

Ne segue la scelta implementativa più robusta: **non** cercare le chiamate `t('...')`, ma tutte le
string literal che hanno *forma* di chiave di traduzione. Cattura anche le indirezioni come
`ERROR_KEYS`, al prezzo di alcuni falsi positivi identificabili (sotto).

Il formato è già codificato in `lib/i18n/key-format.ts`, che rispecchia il CHECK constraint
`translation_key_format` del database:

```js
/^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)+$/
```

Lo strumento deve riusare quella regex, non riscriverla.

### Vincolo di scoping: seed contro codice, non database contro codice

Le chiavi possono essere create a runtime dall'interfaccia di amministrazione
(`components/i18n/translations/CreateTranslationKeyModal.tsx`). Quelle chiavi sono legittime e non
compaiono in alcun seed.

Lo strumento deve quindi confrontare **seed contro sorgente**, entrambi artefatti versionati in Git,
e **non** interrogare il database. Un guard che leggesse il DB segnalerebbe come anomale tutte le
chiavi create dagli utenti, e produrrebbe risultati diversi su ogni ambiente. Come effetto
collaterale positivo, il test resta puramente statico: nessuna dipendenza da un DB attivo, quindi
gira in CI insieme agli unit test e non fra gli integration test.

### Risultati del prototipo (baseline attuale)

Il prototipo, eseguito sul repo allo stato di questa review:

```
blocchi seed: 16
chiavi seedate: 323
stringhe a forma di chiave nel sorgente: 315
```

**Seedate ma non referenziate — 19.** Da rivedere una per una: alcune sono disordine, altre
funzionalità mai cablate.

```
auth.login.error_password_not_set      <- vedi I18N-2: comportamento mai cablato
common.labels.actions
common.states.saved
errors.bad_request
errors.unauthorized
functionalities.locale.de              <- le 10 chiavi functionalities.locale.* sembrano
functionalities.locale.en                 sostituite da locale.label, che arriva dai dati
functionalities.locale.es                 (TranslationsAccordion.tsx:33) e non da t()
functionalities.locale.fr
functionalities.locale.it
functionalities.locale.nl
functionalities.locale.pt
functionalities.locale.ro
functionalities.locale.sk
translation.filter.complete_only
translation.filter.missing_only
validation.invalid_format               <- lib/validations.ts usa validation.password.*,
validation.required                        validation.email.*, validation.phone.*: queste tre
validation.too_long                        generiche non sono referenziate
```

Le tre chiavi `icon_picker.select_placeholder`, `icon_picker.empty`, `icon_picker.no_results` **non**
compaiono in questo elenco perché sono referenziate da `components/IconPicker.tsx`, il file morto di
DEAD-1. Completato quel task, l'elenco passa da 19 a 22. È una dipendenza da tenere presente
nell'ordine di esecuzione: se il guard viene introdotto con una whitelist prima di DEAD-1, la
whitelist andrà aggiornata subito dopo.

**Referenziate ma non seedate — 11, tutti falsi positivi.** Sono le due classi di falso positivo da
gestire:

```
err.details, err.hint                       <- campi di log strutturato (lib/logger.ts, pino)
language.create, language.update,           <- nomi di eventi di audit
language.delete, language.activate,            (lib/i18n/language-actions.ts,
language.deactivate, language.set_default,      lib/i18n/translation-actions.ts)
translation_key.create, translation_key.delete,
translation_value.save
```

Sono stringhe con la stessa forma delle chiavi i18n ma semantica diversa. Vanno escluse. Due strade:
escludere per prefisso (`err.`) e per file (`lib/logger.ts`, i moduli `*-actions.ts`), oppure
restringere la scansione ai soli argomenti di `t(...)` accettando di gestire `ERROR_KEYS` come caso
speciale. **Raccomandazione: la prima**, con l'elenco delle esclusioni commentato riga per riga nel
test. È esplicito, e quando qualcuno aggiunge un nuovo evento di audit il test fallisce e lo
costringe a dichiararlo — che è il comportamento desiderabile.

### Decisione di progetto: cosa fa fallire il test

Le due direzioni non hanno la stessa gravità.

- **Referenziata ma non seedata = bug.** A runtime `t()` non trova la chiave e l'etichetta mostrata
  degrada alla chiave stessa. L'utente vede `roles.form.create_title` invece di "Crea nuovo ruolo".
  Il test **deve fallire**, con l'elenco delle esclusioni note come unica valvola.
- **Seedata ma non referenziata = da rivedere, non necessariamente sbagliata.** Può essere un residuo,
  una funzionalità non ancora cablata (I18N-2), o una chiave tenuta consapevolmente per un lavoro
  imminente. Far fallire il test qui costringerebbe a mantenere una whitelist di 22 voci dal primo
  giorno, con l'effetto tipico: la whitelist diventa il posto dove si nascondono i problemi.

**Raccomandazione:** fallimento duro su una direzione, report informativo sull'altra. Se in futuro
l'elenco delle orfane scende vicino a zero, si può stringere anche quella direzione.

### Dove implementarlo

Lo strumento legge da entrambi i lati del confine (migration in `sources/devops/`, sorgente in
`sources/microservices/web-construct/`), quindi appartiene a `sources/devops/`, dove esiste già il
precedente: `sources/devops/docs-contract.test.mjs`, un test `node:test` che risolve i percorsi dalla
radice del repo con `resolve(import.meta.dirname, '../..')` ed è eseguito da
`npm run test:docs-contract`.

Da fare:

1. Nuovo file `sources/devops/i18n-key-inventory.test.mjs`, sullo stesso modello.
2. Nuovo script in `sources/microservices/web-construct/package.json`, accanto a
   `test:docs-contract`: `"test:i18n-keys": "node --test ../../devops/i18n-key-inventory.test.mjs"`.
3. Inserirlo nella pipeline di qualità dove girano già gli altri guard.

Alternativa scartata: un test Vitest dentro `web-construct` che risale a `../../devops`. Funziona, ma
mette un test che legge SQL di deployment fra gli unit test del frontend, e rompe la simmetria col
precedente esistente.

### Prototipo

Verificato funzionante, produce i risultati riportati sopra. È una base da cui partire, non il
prodotto finito: mancano le esclusioni, la distinzione fra errore e report, e la struttura in
`node:test`.

```js
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const KEY_RE = /^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)+$/

// chiavi seedate: solo migrations/, mai schema.sql (snapshot generato)
const seeded = new Set()
for (const f of readdirSync(migDir).filter(n => n.endsWith('.sql'))) {
  const sql = readFileSync(join(migDir, f), 'utf8')
  for (const block of sql.matchAll(/apply_translation_seed\(\$seed\$([\s\S]*?)\$seed\$/g))
    for (const k of block[1].matchAll(/"key"\s*:\s*"([^"]+)"/g)) seeded.add(k[1])
}

// chiavi referenziate: ogni string literal a forma di chiave in app/ components/ lib/ context/
// (cattura anche le indirezioni come ERROR_KEYS in Login.tsx)
for (const m of src.matchAll(/['"]([a-z0-9_]+(?:\.[a-z0-9_]+)+)['"]/g))
  if (KEY_RE.test(m[1])) used.set(m[1], file)
```

### Criteri di accettazione

- [✅] Il test gira senza database attivo e senza variabili d'ambiente.
- [✅] Fallisce se una chiave referenziata nel sorgente non è seedata, salvo esclusioni dichiarate ed esplicitamente commentate.
- [✅] Riporta l'elenco delle chiavi seedate e non referenziate, con il conteggio.
- [✅] Legge solo `migrations/`, mai `schema.sql`; aggiungere una migration con seed non richiede modifiche al test.
- [✅] Riusa la regex di `lib/i18n/key-format.ts` invece di duplicarla.
- [✅] Sul repo allo stato attuale: verde, con 22 orfane riportate (DEAD-1 è già stato fatto).
- [✅] Nessuna riga cancellata dal database, nessuna migration nuova.

### Rischi

Il rischio principale è la deriva della lista di esclusioni: se cresce senza controllo, il guard
smette di guardare. Mitigazione: ogni esclusione deve avere un commento che ne spiega la ragione, e
la lista va rivista quando supera una decina di voci.

---

## I18N-2 — `auth.login.error_password_not_set` non è raggiungibile

**Severity** Medium · **Complexity** Low · **Priority** P2

### Evidenza

La chiave è seedata in `sources/devops/db/migrations/0001_baseline.sql:958`, con descrizione
`"Login error: PasswordNotSet"` e traduzioni complete:

- IT: *"Imposta prima la tua password tramite il link ricevuto via email."*
- EN: *"Set your password first using the link you received by email."*

La stringa `PasswordNotSet` non compare in nessun file `.ts` o `.tsx` del progetto. In particolare
`components/Login.tsx:11-17` mappa solo quattro codici:

```tsx
const ERROR_KEYS: Record<string, string> = {
  CredentialsSignin:  'auth.login.error_credentials',
  AccessDenied:       'auth.login.error_access_denied',
  OAuthSignin:        'auth.login.error_oauth_signin',
  OAuthCallback:      'auth.login.error_oauth_callback',
  Default:            'auth.login.error_default',
}
```

Il messaggio è quindi irraggiungibile per costruzione: qualunque errore diverso dai quattro codici
mappati ricade su `Default`.

### Impatto

Un utente invitato che tenta di accedere prima di aver impostato la password riceve il messaggio
generico *"Si è verificato un errore durante l'accesso. Riprova."* invece dell'istruzione precisa che
gli dice cosa fare. Riprovare non risolverà, perché il problema non è transitorio: deve usare il link
ricevuto via email. Il costo è supporto utente evitabile su un flusso — quello di invito — che è
funzionalità attiva del prodotto (`0004_invitation_lifecycle.sql`).

### Da chiarire prima del fix

Va determinato se il livello di autenticazione sia in grado di distinguere il caso. NextAuth
normalizza gli errori delle credenziali in `CredentialsSignin`, quindi far arrivare un codice
distinto fino alla pagina di login potrebbe richiedere una modifica al provider, non solo
l'aggiunta di una riga in `ERROR_KEYS`. Le due possibilità:

1. **Il caso è distinguibile.** Cablare il codice e aggiungere la voce in `ERROR_KEYS`. Fix piccolo.
2. **Il caso non è distinguibile senza rivelare informazioni.** Distinguere "password non impostata"
   da "credenziali errate" comunica a un attaccante che l'indirizzo esiste ed è in stato di invito:
   è enumerazione di account. In questo caso la scelta corretta potrebbe essere proprio quella
   attuale, e allora la chiave va documentata come deliberatamente non usata invece di essere
   cablata.

**Nota:** questa seconda ipotesi è plausibile ma non l'ho verificata. Va deciso da chi conosce
l'intenzione originale del flusso di invito prima di scrivere codice. Se l'esito è "non cablare",
la chiave entra nelle esclusioni documentate di I18N-1 con la motivazione, e il caso è chiuso
correttamente invece di restare un'anomalia senza spiegazione.

### Decisione (2026-08-20): non cablare

Verificata l'ipotesi 2, ed è quella giusta. Il codice non si limita a *non* distinguere il caso:
contiene tre misure separate, tutte con lo stesso scopo, che tenerlo indistinguibile è deliberato.

1. **`lib/auth-policy.ts:26-29` confronta contro un hash fittizio.** `verifyCredentialCandidate`
   passa a bcrypt `candidate?.passwordHash ?? DUMMY_PASSWORD_HASH`, cioè esegue il confronto anche
   quando l'utente non ha password e anche quando non esiste affatto. Un hash finto costa lavoro
   inutile: l'unica ragione per pagarlo è pareggiare i tempi di risposta fra "account inesistente",
   "account senza password" e "password sbagliata". È una difesa contro l'enumerazione per timing,
   e presuppone che quella distinzione non debba essere osservabile.
2. **`lib/auth.ts:117-119` calcola la ragione e la manda solo nel log.** La variabile `reason` vale
   `unknown | passwordless | inactive | password`, finisce in `log.warn` e poi `authorize` ritorna
   `null` in tutti e quattro i casi. La distinzione esiste già, lato server, e si è scelto
   consapevolmente di non farla uscire: è il server a doverla sapere, non il client.
3. **`app/api/auth/forgot-password/route.ts:38-40` fa la stessa scelta nel flusso gemello**, con il
   commento esplicito *"Always return 200 — do not leak whether the email exists"*, e salta proprio
   gli utenti senza `passwordHash`.

Cablare `PasswordNotSet` fino alla pagina di login contraddirebbe tutte e tre nello stesso flusso.
Il messaggio *"Imposta prima la tua password tramite il link ricevuto via email"* è, letto da un
attaccante, la conferma che quell'indirizzo esiste **ed è un invito in attesa** — un bersaglio più
interessante di un account qualsiasi, perché ha un token di attivazione in circolazione. Sarebbe un
oracolo di enumerazione più informativo di quello che le tre misure sopra sono lì a impedire.

C'è anche un secondo motivo, indipendente dalla sicurezza: **il messaggio direbbe una cosa non
azionabile.** Manda l'utente al link ricevuto via email, ma se quel link è scaduto la rotta
forgot-password si rifiuta di mandargliene un altro, perché salta chi non ha `passwordHash`. Chi
legge il messaggio non ha comunque un percorso self-service: serve un amministratore che rimandi
l'invito. Un messaggio preciso che porta a un vicolo cieco non è meglio di un messaggio generico.

**Esito:** la chiave `auth.login.error_password_not_set` resta seedata e resta non referenziata, per
scelta. Non si cancella (contratto sulle migration: `apply_translation_seed` è additiva e
`0001_baseline.sql` è immutabile) e non si cabla. Entra nell'inventario di I18N-1 come orfana
**annotata**, con questa motivazione riportata dallo strumento stesso, così chi rilegge il report fra
sei mesi trova la spiegazione accanto alla riga invece di dover rifare questa indagine.

**Se un giorno si volesse davvero aiutare quell'utente**, la strada compatibile con la postura
attuale non passa dalla pagina di login: è un rinvio dell'invito richiesto dall'amministratore, o un
messaggio generico identico per tutti del tipo "se l'indirizzo è registrato riceverai istruzioni",
che è esattamente ciò che forgot-password già fa. In nessuno dei due casi serve questa chiave.

---

## I18N-1 — Come è stato implementato (2026-08-20)

File: [`sources/devops/i18n-key-inventory.test.mjs`](../../sources/devops/i18n-key-inventory.test.mjs).
Comando: `npm run test:i18n-keys`. Gira in `.github/workflows/quality.yml` subito dopo
`test:docs-contract`, ed è elencato fra i controlli statici nella sezione "Verification" del README.

Quattro test, e uno di questi non è quello previsto dalla review:

1. **Il formato della chiave è quello dichiarato.** La regex non è copiata: viene estratta
   testualmente da `lib/i18n/key-format.ts` con `/^const KEY_RE = \/(.+)\/$/m`, e il test fallisce
   con un messaggio esplicito se l'estrazione non trova più nulla. Importare il modulo non era
   praticabile — è TypeScript con un import relativo senza estensione, che Node senza loader non
   risolve — e copiare la regex avrebbe creato la quarta copia della stessa definizione dopo il
   CHECK constraint, `key-format.ts` e `schema.sql`.
2. **Entrambi i lati del confronto sono visibili.** Questo test non era nei criteri di accettazione
   e l'ho aggiunto perché senza di esso il guard ha un modo silenzioso di non funzionare: se la
   scansione del sorgente smettesse di trovare qualcosa — un rename di cartella, un cambio di
   estensione — il test principale confronterebbe l'insieme vuoto contro i seed e resterebbe
   **verde**. Asserisce quindi soglie minime: 16 blocchi seed, 300 chiavi seedate, 250 referenziate.
   Il lato opposto si protegge da sé: se fosse la lettura dei seed a rompersi, ogni chiave usata
   risulterebbe non seedata e il test fallirebbe rumorosamente.
3. **Ogni chiave referenziata è seedata.** Fallimento duro, con l'elenco delle chiavi e il file che
   le usa.
4. **Inventario delle orfane.** Solo report, con conteggio.

### Due scelte non previste dalla review

**I file di test sono scansionati a parte e non fanno mai fallire il guard.** La review non lo
prevedeva, ma i dati lo impongono: i file `*.test.ts(x)` contengono 21 letterali a forma di chiave
che chiavi non sono. Alcuni sono chiavi inventate apposta (`a.b`, `nope.nothing`, `welcome.message`
in `lib/i18n/translator.test.ts`), altri non c'entrano nulla — gli indirizzi IP di
`lib/auth-rate-limit.test.ts` e `lib/rbac/embedded-check.test.ts` (`10.0.0.8`, `93.184.216.34`),
o `example.com` e `frontiere.it`. Includerli avrebbe significato 21 esclusioni al primo giorno, cioè
esattamente la lista che si gonfia fino a non guardare più niente. I riferimenti dei test vengono
comunque raccolti, e servono a qualcosa: l'inventario segnala quando una chiave è tenuta in vita
**solo** da un test, come `functionalities.locale.en` e le due `translation.filter.*`.

**Le esclusioni sono legate al file, non solo al prefisso.** La review suggeriva prefisso *oppure*
file; sono richiesti entrambi insieme. `language.` è escluso solo dentro
`lib/i18n/language-actions.ts`: la stessa stringa in un componente fa fallire il guard. Verificato
con controprova — un file che referenzia `language.create` fuori dal suo modulo fa fallire il test.
Le esclusioni restano tre.

### Verifica

- [✅] Sul repo attuale: **verde**, 4 test su 4, e riporta **22 chiavi orfane** — il numero che la
  review prevedeva dopo DEAD-1, che nel frattempo è stato completato.
- [✅] Controprova sulla direzione che deve fallire: un file con `t('zzz_guard_proof.never_seeded')`
  fa fallire il test con il messaggio *"these keys are used but never seeded, so t() renders the key
  itself"* e il percorso del file colpevole.
- [✅] Controprova sulle esclusioni: `language.create` fuori da `lib/i18n/language-actions.ts` fa
  fallire il test. L'esclusione non tracima.
- [✅] Nessun database, nessuna variabile d'ambiente: il test gira a repo pulito in ~80 ms.
- [✅] `auth.login.error_password_not_set` compare nel report **con la motivazione di I18N-2
  accanto**, e il test fallisce se un giorno quella chiave venisse cablata senza rimuovere
  l'annotazione — cioè senza riaprire la decisione che l'annotazione registra.
