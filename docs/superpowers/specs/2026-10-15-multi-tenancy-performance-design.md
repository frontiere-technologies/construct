# Specifica — Multi-tenancy, prestazioni dopo il pezzo 1 (2026-10-15)

Nasce dalle misure che chiudono il pezzo 1
([specifica](2026-10-13-multi-tenancy-foundations-design.md), MTF-RISK-2 e MTF-RISK-3): dopo la
migrazione del database di sviluppo, le pagine sono da 2,4 a 2,7 volte più lente. Le decisioni
sono state prese con il proprietario del progetto il 2026-10-15.

## Sommario

**Il problema.** Il pezzo 1 ha messo ogni query in una transazione aperta da `withTenant` o
`withGlobal`. È corretto per l'isolamento, ma ogni transazione aggiunge viaggi verso il database:
inizio, `set_config`, fine. In più il callback `jwt` di Auth.js gira 4–5 volte per pagina e ogni
volta apre una transazione, e le letture che prima andavano in parallelo ora vanno in serie.

Misure del 2026-10-15 sul database di sviluppo (server di sviluppo, mediana di 10 caricamenti):

| Pagina | Prima del pezzo 1 | Dopo il pezzo 1 |
|---|---|---|
| `/` | 690 ms | 1635 ms (+137%) |
| `/user-management` | 798 ms | 2185 ms (+174%) |
| `/functionalities` | 702 ms | 1723 ms (+145%) |

Un viaggio verso il database di sviluppo, dal portatile, costa circa 70 ms. I tempi misurati
coincidono con il conto dei viaggi fatto sul codice.

**L'obiettivo.** Per ogni pagina, il percorso critico non supera di oltre il 20% i viaggi verso il
database che faceva prima del pezzo 1. L'obiettivo è in viaggi e non in millisecondi, così vale
ovunque giri la produzione. Le misure in millisecondi restano come conferma.

**Cosa non cambia.** L'isolamento del pezzo 1 resta tutto: `withTenant` e `withGlobal` sono le sole
porte, ogni query sta in una transazione, il tenant vale solo nella transazione, `prepare: false`,
nessuna modifica a migrazioni, policy o ruoli.

**Dopo questo lavoro** la produzione può seguire i tre rilasci con `apply --to` descritti nel
README. Questo lavoro è solo codice: si rilascia in una volta.

## Come si contano i viaggi

- Con `prepare: false`, postgres.js manda ogni istruzione **con parametri** in due viaggi (prima
  la descrizione, poi l'esecuzione); un'istruzione **senza parametri** va in uno.
- Inizio e fine transazione costano un viaggio ciascuno.
- Il **percorso critico** è la somma dei viaggi che la pagina deve aspettare uno dopo l'altro:
  proxy, layout principale (il ramo più lungo fra quelli in parallelo), layout protetto, pagina.
- Il dettaglio di oggi, richiesta per richiesta, è nella mappa raccolta il 2026-10-15 e riassunto
  nella §3.

## Decisioni

- [✅] ID=MTP-DEC-1, Title=Obiettivo in viaggi, Requirement=Per `/`, `/user-management` e `/functionalities` il percorso critico non supera del 20% i viaggi di prima del pezzo 1 (17, 28, 26): al massimo 20, 33, 31.
- [✅] ID=MTP-DEC-2, Title=Riduzioni mirate, Requirement=Si interviene sulle cause (sessione ripetuta, autorizzazione in più query, `set_config` costoso, transazioni minuscole, letture in serie) senza cambiare l'architettura del pezzo 1. Scartate: una transazione per richiesta (MTF-DEC-6, connessioni occupate per tutto il rendering) e gli statement preparati (MTF-DEC-7, incompatibili con il pooler in modalità transazione).
- [✅] ID=MTP-DEC-3, Title=Tenant nel testo dopo la verifica, Requirement=`withTenant` scrive il numero del tenant nel testo di `set_config` invece di passarlo come parametro, solo dopo averlo verificato come intero sicuro e positivo. È un'eccezione motivata al vincolo del pezzo 1 "valore come parametro, mai `sql.raw`": nel testo può finire solo un intero. La specifica del pezzo 1 va aggiornata con questa eccezione.
- [✅] ID=MTP-DEC-4, Title=Revoca immediata invariata, Requirement=Ogni richiesta rilegge l'autorizzazione dal database; la memoria per richiesta (`cache()` di React) evita solo di rileggerla più volte nella stessa richiesta, e non condivide nulla fra richieste.
- [✅] ID=MTP-DEC-5, Title=Budget verificato da un test, Requirement=Un client di test conta le istruzioni e i viaggi; il callback `jwt`, `resolveActor` e i caricamenti delle tre pagine hanno un tetto. Superarlo fa fallire il test.

## 1. Perimetro

### 1.1 Dentro

1. Sessione memorizzata per richiesta (§2.1).
2. Autorizzazione in una sola istruzione, per il callback `jwt` e per `resolveActor` (§2.2).
3. `set_config` senza parametro e inviato insieme alla prima query (§2.3).
4. Meno transazioni minuscole: preferenze dell'utente e pagina utenti (§2.4).
5. Letture indipendenti di nuovo insieme (§2.5).
6. Test del budget di viaggi, test d'ordine sotto concorrenza, misura finale (§4).
7. Aggiornamento della specifica del pezzo 1: eccezione di MTP-DEC-3, chiusura di MTF-RISK-2 e
   MTF-RISK-3 con i numeri finali.

### 1.2 Fuori

- La griglia utenti caricata dal client (`POST /api/rbac/users-grid`) e la lettura della sessione
  dopo l'idratazione (`GET /api/auth/session`): non sono sul percorso critico della pagina. Il
  callback `jwt` più leggero (§2.2) le alleggerisce comunque.
- Cache fra richieste (`'use cache'`, cache di processo dell'autorizzazione): cambierebbero la
  garanzia di revoca immediata.
- Il proxy: `cache()` non vale lì; il suo costo scende con §2.2 e §2.3.

### 1.3 Criteri di successo

- [✅] ID=MTP-OK-1, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Budget rispettato, Fix description=Il test dei viaggi passa con i tetti di §3 e il percorso critico stimato delle tre pagine resta entro MTP-DEC-1. **Esito (2026-10-20):** tetti del test rispettati (`withTenant` vuota 3, callback `jwt` 5, `resolveActor` 5, menu 6, albero 5, pagina utenti 11 viaggi in totale); percorso critico stimato 17, 31, 25 contro 20, 33, 31. **Correzione dopo la revisione finale:** la misura iniziale (16, 27, 23) dava un credito di sovrapposizione anche a due letture con parametri messe in coda insieme, ma postgres.js 3.4.9 con `prepare: false` non le sovrappone (vedi §2.5): la seconda aspetta la fine della prima. Il percorso critico senza quel credito è 17, 31, 25, sempre entro l'obiettivo.
- [✅] ID=MTP-OK-2, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Misura confermata, Fix description=Sul database di sviluppo, con lo stesso metodo del 2026-10-15, ogni pagina resta entro il 20% del tempo di prima del pezzo 1 (al massimo circa 830, 960, 840 ms), o la differenza residua è spiegata e accettata dal proprietario. **Esito (2026-10-20), accettato dal proprietario:** stessa giornata, stesso metodo, database di sviluppo: `development` (pezzo 1 senza ottimizzazione) 1560, 1979, 1557 ms; con l'ottimizzazione 796, 1012, 798 ms (−49%); proxy da 455 a circa 195 ms. Contro la misura del 2026-10-15 prima del pezzo 1 (690, 798, 702 ms, fatta con un viaggio da 72 ms invece dei 45 di oggi): +15%, +27%, +14%. La differenza residua di `/user-management` è accettata: l'obiettivo in viaggi è raggiunto, il resto è lavoro del server da indagare se servirà.
- [✅] ID=MTP-OK-3, Severity=Critical, Complexity=Low, Priority=P0, Estimate=minutes, Title=Isolamento invariato, Fix description=Contratto di schema, test di isolamento, test di concorrenza nelle due modalità del pooler, `boundary-check` e guardie passano senza modifiche alle attese. **Esito (2026-10-20):** contratto di schema, isolamento, concorrenza nelle due modalità del pooler (con il nuovo test d'ordine) e `boundary-check` verdi.
- [✅] ID=MTP-OK-4, Severity=High, Complexity=Low, Priority=P0, Estimate=hours, Title=Nessun cambiamento visibile, Fix description=Unit, integrazione ed E2E passano senza cambiare le attese, comprese revoca immediata, 403 e pagine anonime. **Esito (2026-10-20):** unit (a parte le 8 Sidebar note), integrazione 170/170, E2E 144/144.

## 2. Interventi

### 2.1 Sessione memorizzata per richiesta

- Nuova funzione `getSession()` = `cache(() => auth())`, accanto ad `auth` in `lib/auth.ts` o in
  un modulo dedicato.
- La usano tutti i chiamanti lato server che oggi chiamano `auth()`:
  - `lib/i18n/server.ts` (lingua del profilo);
  - `lib/appearance-server.ts`;
  - `app/(protected)/layout.tsx`;
  - `lib/rbac/auth-guard.ts` (`currentActor`).
- Il proxy (`proxy.ts`) resta su `auth()`: fuori dal rendering `cache()` non memorizza.
- Una regola (ESLint o guardia AST) impedisce di chiamare `auth()` lato server fuori da
  `getSession`, dal proxy e dalle route di Auth.js, così il guadagno non si perde.

Effetto: il callback `jwt` gira 2 volte per pagina (proxy e rendering) invece di 4–5.

### 2.2 Autorizzazione in una sola istruzione

- `selectUserAuthorization(tx, userId)` legge con **un'unica istruzione** i due ruoli di sistema
  del tenant (`system_key`), lo stato dell'utente e i suoi ruoli nel tenant. Il risultato è lo
  stesso di oggi (`accountActive`, `roleIds`, `isAdmin`), con gli stessi casi limite: utente
  inesistente, ruoli di sistema mancanti (`system roles missing`).
- L'inserimento del ruolo base al primo accesso (`ensureRegisteredRole`) resta com'è: avviene solo
  all'accesso.
- `resolveActor` usa un'istruzione allargata che restituisce anche i codici dei permessi dei ruoli
  (oggi una lettura in più per i non amministratori). Comportamento e messaggi delle guardie
  invariati.
- `getSystemRoleIds(tx)` resta per gli altri usi (azioni sugli utenti, pagina utenti).

Effetto: un giro del callback `jwt` costa come prima del pezzo 1 (4 viaggi invece di 9).

### 2.3 `set_config` senza parametro, inviato insieme alla prima query

- `withTenant`, dopo la verifica attuale (`Number.isSafeInteger(tenantId) && tenantId > 0`),
  manda `select set_config('app.tenant_id', '<n>', true)` come istruzione **senza parametri**,
  con il numero scritto nel testo, e **non ne aspetta la risposta** prima di chiamare la funzione.
- postgres.js scrive le istruzioni senza parametri sulla connessione senza aspettare la risposta
  precedente (un'istruzione con parametri invece sì, vedi §2.5); la prima query della funzione parte subito dopo, sulla stessa connessione. Postgres
  esegue le istruzioni di una connessione nell'ordine in cui arrivano, quindi il tenant è impostato
  prima di qualunque lettura.
- La promessa di `set_config` viene attesa insieme al risultato della funzione: se fallisce,
  l'errore arriva al chiamante e la transazione si interrompe, come oggi.
- Il resto di `withTenant` non cambia: opzioni della transazione, log del 42501, tipi.
- La guardia AST continua a vietare la stringa `app.tenant_id` fuori da `lib/db/` e dai test.

Effetto: `set_config` passa da 2 viaggi a circa 0 sul percorso critico di ogni `withTenant`.

### 2.4 Meno transazioni minuscole

- **Preferenze dell'utente.** La lingua del profilo (`lib/i18n/server.ts`) e l'aspetto
  (`lib/appearance-server.ts`) leggono la stessa riga di `users`. Un unico caricamento memorizzato
  per richiesta (`getUserPreferences(userId)`, una `withGlobal`) restituisce entrambi i dati.
- **Pagina utenti.** In `app/(protected)/user-management/page.tsx`, l'elenco dei ruoli
  (`getAllRoles`) e i ruoli assegnabili (`assignableRoleIds`) stanno nella stessa `withTenant`.
- **Layout principale.** L'elenco delle lingue e la sessione partono insieme, invece che uno dopo
  l'altro, dove il codice lo permette senza cambiare il risultato.

### 2.5 Letture indipendenti di nuovo insieme

Dentro una transazione, le letture che non dipendono l'una dall'altra si lanciano insieme
(`Promise.all`), così postgres.js le mette in coda sulla stessa connessione:

- menu laterale (`getSidebarMenu`: voci e funzionalità concesse);
- albero delle funzionalità (`getNavigationSubtree`: voci ed etichette);
- concessioni dei ruoli (`grantsForRoles`, `assignableRoleIds`);
- pagina utenti (`loadUserManagementPage`: ruoli e ruoli di sistema).

**Quando la sovrapposizione è reale.** Con `prepare: false` un'istruzione con parametri passa
prima da una richiesta di descrizione (`describeFirst`): postgres.js non la scrive finché la
connessione non è libera, e la transazione mette in attesa tutte le istruzioni successive fino a
quando la connessione non si svuota (postgres.js 3.4.9, `connection.js` e `index.js`). Quindi:

- le istruzioni **senza parametri** messe in coda insieme si sovrappongono davvero: `set_config` e
  la prima lettura, voci e concessioni del menu, voci ed etichette dell'albero, ruoli e ruoli di
  sistema nella pagina utenti;
- una lettura **con parametri** dopo un'altra lettura con parametri **non** si sovrappone, resta
  in serie con 2 viaggi ciascuna: le due letture di `grantsForRoles` e quelle di
  `assignableRoleIds` (`functionalityIdsForRoles` e `grantsForRoles`).

Il `Promise.all` resta comunque utile in quei punti (non costa nulla e rende le letture
indipendenti), ma non ne va contato il guadagno nel percorso critico.

Ogni ramo di un `Promise.all` dentro una transazione deve essere una sola istruzione, oppure
attendere tutto ciò che avvia, e va atteso con `allInTransaction` (`lib/db/`), che non
lascia terminare la transazione finché un ramo può ancora inviare istruzioni.

I commenti MTF-RISK-3 nel codice vanno aggiornati di conseguenza.

## 3. Budget dei viaggi

Viaggi sul percorso critico, contati con le regole sopra.

| Pagina | Prima del pezzo 1 | Oggi | Obiettivo (MTP-DEC-1) | Stima dopo |
|---|---|---|---|---|
| `/` | 17 | 41 | ≤ 20 | ~17 |
| `/user-management` | 28 | 75 | ≤ 33 | ~31 |
| `/functionalities` | 26 | 65 | ≤ 31 | ~25 |

La stima non dà credito di sovrapposizione alle letture con parametri messe in coda insieme (§2.5):
una prima misura che lo dava aveva trovato 16, 27, 23, un valore ottimistico.

Tetti per il test (MTP-DEC-5), in viaggi, da confermare nel piano dopo una prima misura del
client di test:

| Operazione | Oggi | Tetto |
|---|---|---|
| un giro del callback `jwt` (utente esistente) | 9 | 4 |
| `resolveActor` (amministratore e non) | 9–11 | 4 |
| una `withTenant` vuota | 4 | 2 |
| `getSidebarMenu` | 7 | 4 |
| `getNavigationSubtree` | 6 | 3 |
| transazione della pagina utenti (ruoli e ruoli assegnabili) | 5 + 11 | 7 |

## 4. Test

### 4.1 Unit

- `withTenant`:
  - il testo di `set_config` contiene solo il numero verificato, senza parametri;
  - `0`, negativi, `NaN`, decimali e infinito sono rifiutati prima di toccare il database;
  - `set_config` è inviato prima che la funzione parta, e un suo errore arriva al chiamante.
- `getSession`: dentro la stessa richiesta `auth()` è chiamato una volta sola.
- `selectUserAuthorization` e l'istruzione di `resolveActor`: stessi risultati di oggi nei casi
  amministratore, utente normale, utente disattivato, utente inesistente, ruoli di sistema mancanti.

### 4.2 Integrazione

- **Ordine garantito:** dentro `withTenant` la prima query vede già il tenant anche se
  `set_config` non è stato atteso. Il test di concorrenza esistente (400 transazioni alternate,
  con scritture, nelle due modalità del pooler) continua a non vedere righe dell'altro tenant.
- **Budget:** un client di test con il registro delle istruzioni di postgres.js conta istruzioni
  e viaggi delle operazioni di §3 e fallisce se si supera il tetto.
- **Isolamento:** contratto di schema, test di isolamento, `boundary-check` invariati.

### 4.3 E2E e browser

- L'E2E completo passa senza modifiche alle attese.
- Nel browser, sul database di sviluppo: accesso, menu, Utenti, Ruoli, Funzionalità, Tema, pagine
  anonime.

### 4.4 Misura finale

Stesso metodo del 2026-10-15: server di sviluppo sul database di sviluppo, sessione da
amministratore nel riquadro del browser, 2 caricamenti di riscaldamento e 10 misurati per
`/`, `/user-management`, `/functionalities`, mediana. I numeri chiudono MTF-RISK-2 e MTF-RISK-3
nella specifica del pezzo 1.

## 5. Rischi

- [✅] ID=MTP-RISK-1, Severity=High, Complexity=Low, Priority=P0, Estimate=hours, Title=Ordine di set_config e prima query, Fix description=Se postgres.js o Drizzle non scrivessero `set_config` sulla connessione prima della prima query, una query potrebbe partire senza tenant (42501, mai un tenant sbagliato, perché il valore è valido solo nella transazione). Lo verifica il test d'ordine di §4.2 nelle due modalità del pooler; se fallisce, si torna ad aspettare `set_config` (1 viaggio invece di 0). **Chiuso:** il test d'ordine (200 transazioni, `tx.execute` e query di Drizzle, entrambe le modalità del pooler) passa; la transazione aspetta sempre la fine della funzione (`Promise.allSettled`).
- [✅] ID=MTP-RISK-2, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Memoria per richiesta fuori dal rendering, Fix description=`cache()` di React non memorizza nelle route e nelle azioni server fuori dal rendering: lì `getSession` richiama `auth()` ogni volta. È accettato, perché route e azioni chiamano la sessione una volta; il test del budget lo conferma. **Chiuso:** accettato; una guardia impedisce chiamate dirette ad `auth()` lato server.
- [✅] ID=MTP-RISK-3, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=Istruzione unica più complessa, Fix description=Unire ruoli di sistema, stato e ruoli in una sola istruzione rende la query meno leggibile. Va commentata e coperta dai casi limite di §4.1. **Chiuso:** istruzione commentata e coperta da test di integrazione su amministratore, utente normale, senza ruoli, disattivato, inesistente, ruoli di sistema mancanti e revoca.
- [✅] ID=MTP-RISK-4, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Misure su server di sviluppo, Fix description=Il server di sviluppo aggiunge tempo di compilazione e ricarica i moduli. Le misure si confrontano solo con quelle fatte con lo stesso metodo. **Chiuso:** il confronto finale è stato fatto nella stessa giornata fra `development` e il branch.
