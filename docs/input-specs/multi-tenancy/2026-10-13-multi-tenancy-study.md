# Studio: multi-tenancy in Construct

Data: 2026-10-13
Origine: richiesta di uno studio sulla multi-tenancy di Construct, con **separazione logica dei
dati nello stesso database** e **protezione di ogni tenant dagli altri**. L'isolamento a livello
di infrastruttura (macchine, cluster, un database per cliente) è escluso, salvo un confronto
breve.
Issue: [construct#12](https://github.com/frontiere-technologies/construct/issues/12) (In Progress),
[construct#28](https://github.com/frontiere-technologies/construct/issues/28) (implementazione, Backlog).

Fonti usate:

- **Il codice.** `sources/microservices/web-construct` e le migrazioni 0001–0043, lette
  direttamente.
- **Il database di sviluppo**, con sole letture (progetto Supabase `wmudfqrybbvxfvykztep`):
  - PostgreSQL 17.6;
  - 21 tabelle in `public`, tutte di proprietà di `postgres`;
  - l'app entra come `construct_app`;
  - RLS attiva su tutte, forzata su nessuna;
  - 20 policy, nessuna restrittiva;
  - ultima migrazione applicata: 0043.
- **La issue #12**: specifica e commento con gli obiettivi.
- **I requisiti TO-BE del 2026-10-07**
  ([multi-tenancy-requirements.md](multi-tenancy-requirements.md)), nati nell'inventario per
  l'app Flutter e ora raccolti in questa cartella.
- **Le specifiche RBAC** e la revisione d'architettura del 2026-07-31.
- **Le indicazioni pubbliche correnti**: documentazione PostgreSQL, Supabase, Drizzle e Next.js,
  OWASP, AWS, Azure, Crunchy Data, Citus. Gli indirizzi sono in fondo.

> **Come leggere il documento.**
> - **§1–3**: cosa si chiede, cosa c'è oggi e quale modello si sceglie.
> - **§4**: le difese una per una, ciascuna con il punto preciso del codice che tocca.
> - **§5**: l'ordine in cui farle.
> - **§6**: le decisioni da prendere prima di cominciare.
> - **§7**: l'elenco dei lavori, come checkbox.
> - **§8**: dove questo studio corregge o completa quello del 2026-10-07 e la #12.

## Sommario

**Raccomandazione.** Un solo database condiviso. Ogni tabella che appartiene a un cliente riceve
una colonna `id_tenant`. Il confine fra tenant lo fa rispettare **Postgres stesso** con la Row
Level Security (RLS), non solo il codice dell'app. Il tenant corrente entra nel database con
`set_config('app.tenant_id', …, true)` all'inizio di **ogni** transazione, e una funzione di
supporto **blocca la query con un errore** se il valore manca. È il modello che AWS, Crunchy Data
e OWASP indicano come base per un'applicazione B2B di queste dimensioni, ed è anche quello già
scelto dallo studio del 2026-10-07 (TB-DEC-01).

**Il punto di partenza è buono, ma la RLS di oggi non protegge niente.**

Cosa c'è già:

- l'app entra con un utente senza privilegi speciali (`construct_runtime`: niente BYPASSRLS, non
  proprietario delle tabelle), verificato da `boundary-check` e dal test del contratto di schema;
- la RLS è attiva su tutte le tabelle;
- le API automatiche di Supabase (Data API) sono chiuse con le revoche dei permessi;
- ogni ingresso dell'app dichiara il proprio controllo d'accesso, e un test lo verifica sul codice
  sorgente;
- non si usa nessuna cache di Next.js fra una richiesta e l'altra.

Però:

1. **Le policy di oggi sono tutte `using (true)` e permissive.** Lasciano passare tutto: servono
   solo a escludere i ruoli `anon` e `authenticated`. Postgres combina le policy permissive con
   un OR, quindi una policy di tenant aggiunta accanto a queste **non avrebbe nessun effetto**.
   Il confine va scritto come policy **RESTRICTIVE**, che si combina in AND con tutte le altre.
2. **Il proprietario delle tabelle vede tutto.** Le tabelle sono di `postgres`, che su Supabase ha
   **BYPASSRLS** (verificato sul database di sviluppo). Le migrazioni, gli script di manutenzione
   e chiunque usi quella connessione vedono tutti i tenant, e `FORCE ROW LEVEL SECURITY` non
   basta a impedirlo: BYPASSRLS vince su FORCE. La protezione vera è che l'app non usi mai quella
   connessione, ed è già così. In più c'è la possibilità di dare le tabelle a un proprietario
   dedicato senza BYPASSRLS (MT-DB-2).
3. **`replace_menu_entry_tags` è SECURITY DEFINER** con `search_path = public`. Gira con i
   permessi del proprietario, quindi scavalca qualunque policy, e riceve un id di voce di menu
   qualunque.
4. **Quasi tutte le letture fuori dalle transazioni** girano in autocommit: i servizi di
   `lib/**/…-service.ts`, `resolveActor`, il callback `jwt`. L'app passa per il pooler di
   Supavisor in modalità transazione (porta 6543), dove un `SET` di sessione passerebbe da un
   cliente all'altro. Perciò **ogni** accesso al database va chiuso in una transazione che imposta
   il tenant.
5. **Diversi vincoli e stati oggi sono unici per tutta l'installazione**:
   - una sola riga di tema (`app_theme`);
   - una sola lingua predefinita;
   - l'invariante "ultimo amministratore attivo", con una sola chiave di lock;
   - la lista `allowed_domains` e la sua cache in memoria;
   - le versioni del dizionario;
   - le voci di menu di sistema con id fissi 1–7.

   Con più tenant ognuno di questi diventa per tenant.

La **difesa in profondità** che si raccomanda è a quattro livelli, e ognuno deve reggere anche se
un altro sbaglia:

- **Database:** RLS restrittiva, chiavi esterne composte `(id_tenant, id)`, unicità per
  tenant.
- **Accesso ai dati:** un solo punto d'ingresso, `withTenant`. Il client `db` non viene più
  esportato.
- **Applicazione:** il tenant viene dal token rivalidato a ogni richiesta, oppure dall'host prima
  dell'accesso; mai dal corpo di una richiesta.
- **Test:** isolamento verificato su database, HTTP e concorrenza, e controllo automatico dello
  schema in CI.

**Stima complessiva:** settimane di lavoro per un sistema di sviluppo assistito dall'AI. Circa
metà è nello strato dati (§4.2–4.5), un quarto nei test (§4.9), il resto in applicazione,
identità e console di piattaforma.

**Prima di scrivere codice** vanno prese le decisioni di §6. Le più importanti:

- MT-DEC-02: ruoli di sistema copiati in ogni tenant oppure globali;
- MT-DEC-04: le funzionalità concesse a ogni tenant dalla piattaforma, come chiede la #12;
- MT-DEC-06: pooler in modalità transazione o sessione.

## 1. Cosa si chiede e cosa c'è già

### 1.1 La richiesta (#12)

| Punto della #12 | Dove lo copre questo studio |
|---|---|
| Il super admin crea e configura i tenant | §4.8, MT-PLAT-1 |
| Associazione automatica per dominio email e manuale per email | §4.7, MT-AUTH-3 |
| Il super admin definisce funzionalità globali e ruoli base | §4.5, §4.8, MT-DEC-02 |
| Il super admin decide quali funzionalità ogni tenant può usare | §4.8, MT-DEC-04 (**nuovo** rispetto allo studio del 2026-10-07) |
| L'admin del tenant crea ruoli propri e assegna solo le funzionalità concesse | §4.5, §4.8 |
| Un utente con più tenant sceglie il tenant corrente da un menu sempre presente ("Change organization") | §4.6, MT-APP-4 |
| Dopo l'accesso si entra nell'ultimo tenant usato | §4.6 |
| Il super admin può sempre intervenire | §4.8, MT-PLAT-3 |
| Dal commento: tabelle `tenants` e `user_tenants`, tenant predefinito per i dati esistenti, filtri sempre per tenant nel backend | §4.4, §5 |
| Dal commento: dipartimenti come albero facoltativo sotto il tenant | §4.8, MT-DEC-05 |
| Dal commento: audit log, indici su `id_tenant`, test contro le fughe fra tenant | §4.8, §4.3, §4.9 |

### 1.2 Cosa c'è nel repository

- **La multi-tenancy è stata esclusa di proposito**, con DEC-3 del
  [design RBAC del 2026-06-28](../../superpowers/specs/2026-06-28-rbac-module-design.md). Ne restano
  tracce senza logica:
  - il ruolo 2 "Tenant Super Administrator";
  - i campi `tenantValidationPending` e `multiTenancyEnabled`, sempre `false`
    (`lib/rbac/types.ts:196-197`, `lib/rbac/user-mappers.ts:47-48`).
- **Esistono già i requisiti TO-BE** del 2026-10-07, in
  [multi-tenancy-requirements.md](multi-tenancy-requirements.md):
  - §1, decisioni TB-DEC-01…05, TB-DEC-09, TB-DEC-10;
  - §2, voci MT-01…14;
  - §3, voci WL-02…04 (tenant, host e domini).

  Questo documento lo riprende e lo verifica contro il codice. Le differenze sono in §8.
- **La [specifica di rimedio d'architettura del 2026-08-02](../../superpowers/specs/2026-08-02-architecture-review-remediation-design.md:42)**
  dice che la RLS resta come difesa in profondità **senza policy per utente**, perché il database
  vede un'unica identità di server. Per i tenant questa scelta va **rivista**, ma non contraddetta:
  la policy di tenant non ha bisogno di un utente Postgres per ogni persona. Legge il tenant da
  una variabile della transazione impostata dal server.

## 2. Il modello: perché database condiviso con `id_tenant` e RLS

| Modello | Isolamento | Costo e operatività | Adatto a |
|---|---|---|---|
| Un database per tenant | massimo | N database, N migrazioni, N backup | pochi clienti che lo chiedono per contratto |
| Uno schema per tenant | medio | migrazioni ripetute N volte; non risolve il tenant che consuma risorse a scapito degli altri | centinaia di tenant, raramente consigliato oggi |
| **Tabelle condivise + `id_tenant` + RLS** | **logico, imposto dal database** | quello di oggi | **da decine a milioni di tenant** |

- **Cosa dicono le fonti.** AWS (Prescriptive Guidance) considera la RLS *necessaria* quando i
  tenant condividono le tabelle in Postgres. Crunchy Data indica la colonna di tenant come
  soluzione per i grandi numeri. Azure ricorda che molte squadre rinunciano alla RLS per la sua
  complessità. OWASP lascia la scelta al rischio. Qui la complessità è già in gran parte pagata:
  il ruolo senza privilegi e la RLS attiva esistono.
- **Limiti da accettare** (Azure):
  - ripristinare un solo tenant richiede di ripristinare tutto il database altrove e ricopiare le
    sue righe;
  - la residenza dei dati in una regione diversa e le chiavi di cifratura proprie non sono
    possibili in un database condiviso.

  Per i clienti che li chiedono si usa una **seconda installazione**, con lo stesso codice e un
  altro progetto Supabase. Il codice va scritto in modo che questo resti possibile senza
  modifiche.

## 3. Stato attuale rispetto all'isolamento

| Area | Oggi | Con i tenant |
|---|---|---|
| Utente con cui l'app entra nel database | `construct_runtime` NOLOGIN più un login che ne eredita solo i permessi, NOBYPASSRLS, non proprietario (`migrations/0002_runtime_boundary.sql:3-19`, `db.mjs:168-243`) | va bene così; resta la base |
| Proprietario delle tabelle | `postgres`: non è superuser su Supabase, ma ha **BYPASSRLS**, quindi ignora la RLS anche forzata | `postgres` resta fuori dall'app e dai processi automatici che toccano dati dei tenant; `FORCE` utile solo con un proprietario dedicato senza BYPASSRLS (MT-DB-2) |
| RLS | attiva su 21 tabelle su 21; policy `construct_runtime_server_access … using (true)` (`0002:60-66`) | policy RESTRICTIVE di tenant, più permissive per i permessi più fini |
| Funzioni | tutte INVOKER con `search_path=''`, tranne `replace_menu_entry_tags` (DEFINER, `search_path=public`, `schema.sql:2033-2043`) | nessuna DEFINER, oppure un elenco rivisto e controllato in CI |
| Vista | `role_list_view` con `security_invoker` (`0002:88`) | va bene; il filtro di tenant arriva dalle tabelle sotto |
| Connessione | un client per pod, porta 6543 (transazione), `prepare:false`, `max:20` (`lib/db.ts:15-17`) | ogni accesso in una transazione con il tenant impostato |
| Transazioni | poche (§3 del rapporto); letture e alcune scritture in autocommit, letture parallele con `Promise.all` | tutto dentro `withTenant`; le letture parallele in una stessa transazione vengono eseguite una dopo l'altra |
| Controllo degli ingressi | `guards/permission-declared.test.ts`: la prima istruzione di ogni server action, route handler e pagina protetta è un controllo d'accesso | stesso meccanismo, esteso al tenant |
| Middleware | `proxy.ts` esclude `/api`; i route handler si controllano da soli | il tenant prima dell'accesso va risolto in ogni handler pubblico |
| Cache fra richieste | nessuna cache Next.js; cache in memoria: `domainCache` (`lib/auth.ts:25`), dizionari (`lib/i18n/dictionary-service.ts:11,21`) | chiavi per tenant |
| Log | pino senza id di richiesta, utente o tenant (`lib/logger.ts:3-11`); audit solo nei log per l'i18n (`lib/i18n/audit.ts`) | tenant e id di richiesta in ogni riga; tabella di audit |
| Data API Supabase | permessi revocati a `anon` e `authenticated` (`0002:25-42`, `0005`) | disattivarla anche a livello di progetto (MT-OPS-2) |
| Versione Postgres | 17.6: contiene le correzioni di CVE-2024-10976 (17.1) e CVE-2025-8713 (17.6), due errori del motore RLS | tenere aggiornata la versione minore |

## 4. Le difese, una per una

### 4.1 Database: utenti, RLS restrittiva, funzione che blocca senza tenant

**Chi scavalca la RLS in Postgres:**

- i superuser;
- i ruoli con BYPASSRLS;
- il proprietario della tabella, se la RLS non è forzata.

Su Supabase sia `postgres` (il proprietario delle tabelle di Construct) sia `service_role` hanno
BYPASSRLS: il database di sviluppo lo conferma. Su questi due ruoli `FORCE ROW LEVEL SECURITY`
non ha effetto, perché BYPASSRLS vince. Ne seguono due regole:

- l'app non usa mai nessuno dei due, ed è già così;
- le migrazioni e gli script che girano come `postgres` vanno trattati come accessi di
  piattaforma: vedono tutti i tenant.

`FORCE` diventa utile solo se le tabelle passano a un proprietario dedicato senza BYPASSRLS
(MT-DB-2).

**La funzione che legge il tenant** deve bloccare la query se il valore manca. C'è una trappola
documentata: dopo che una variabile personalizzata è stata impostata una volta in una sessione,
anche solo in modo locale, rileggerla fuori dalla transazione restituisce **stringa vuota**, non
NULL. Con il pooler la sessione è condivisa, quindi il caso è reale.

```sql
create schema if not exists app_private;

create function app_private.current_tenant_id() returns bigint
language plpgsql stable parallel safe security invoker set search_path = '' as $$
declare v text := current_setting('app.tenant_id', true);
begin
  if v is null or v = '' then
    raise exception 'tenant context missing' using errcode = '42501';
  end if;
  return v::bigint;
end $$;

revoke all on function app_private.current_tenant_id() from public;
grant usage on schema app_private to construct_runtime;
grant execute on function app_private.current_tenant_id() to construct_runtime;
```

**Le policy, per ogni tabella dei tenant.** La chiamata alla funzione è racchiusa in
`(select …)`, così Postgres la calcola una volta per istruzione invece che per riga: Supabase
misura guadagni da centinaia a migliaia di volte.

```sql
drop policy construct_runtime_server_access on public.menu_entry;

create policy tenant_boundary on public.menu_entry
  as restrictive for all to construct_runtime
  using      (id_tenant = (select app_private.current_tenant_id()))
  with check (id_tenant = (select app_private.current_tenant_id()));

create policy runtime_access on public.menu_entry
  as permissive for all to construct_runtime
  using (true) with check (true);   -- il confine lo porta la policy restrittiva
```

Note:

- **Perché due policy.** Postgres vuole almeno una policy permissiva, altrimenti con le sole
  restrittive la tabella non restituisce niente. Quella permissiva resta `using (true)`, e il
  linter di Supabase la segnalerà (avvisi 0006 e 0024). Va documentata come eccezione voluta.
  Le policy più fini che arriveranno (per ruolo, per dipartimento) potranno solo **restringere**
  dentro il tenant, mai allargare fuori.
- **USING e WITH CHECK si comportano diversamente quando falliscono.** Se fallisce `USING`, la
  riga semplicemente non si vede (`UPDATE 0`). Se fallisce `WITH CHECK`, la scrittura dà errore.
  Per i test serve saperlo.
- **Le tabelle globali** (cataloghi) hanno solo una policy di lettura per `construct_runtime`.
  Le scritture sono riservate alle migrazioni o alla piattaforma (§4.8).
- **Quello che la RLS non copre:**
  - `TRUNCATE` e `REFERENCES`: l'app non deve avere né l'uno né l'altro, ed è già così, perché
    `0002` concede solo `select, insert, update, delete`;
  - le viste materializzate: non usarle sui dati dei tenant;
  - le chiavi esterne e i vincoli di unicità: controllano le righe ignorando le policy, e quindi
    possono rivelare se un valore esiste in un altro tenant. Si chiude con l'unicità per tenant
    (§4.3).

### 4.2 Il tenant in ogni transazione: `withTenant`

**Perché serve.** Con il pooler in modalità transazione, ogni transazione può finire su una
connessione diversa. Il tenant quindi va impostato **dentro** la stessa transazione che legge e
scrive:

- `set_config(..., true)` dura fino alla fine della transazione;
- fuori da una transazione esplicita dura **una sola istruzione**;
- un `SET` di sessione resterebbe sulla connessione per il cliente successivo.

**La forma raccomandata.** Il client `db` di `lib/db.ts` smette di essere esportato. Restano due
porte:

```ts
// lib/db/tenant-db.ts
import 'server-only'

export type TenantId = number & { readonly __brand: 'TenantId' }   // si ottiene solo da requireTenant()
export type TenantTx = Tx & { readonly __brand: 'TenantTx' }

export async function withTenant<T>(tenantId: TenantId, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error('invalid tenant')
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`)
    return fn(tx as TenantTx)
  })
}
// withPlatform(actor, reason, fn): solo per la console di piattaforma, scrive l'audit (§4.8)
// withAnonymousHost(host, fn): prima dell'accesso, risolve il tenant dall'host (§4.6)
```

Come si incastrano i pezzi:

- **`TenantId` lo crea solo il livello di autenticazione**, dopo aver verificato l'appartenenza.
  Un numero arrivato dalla richiesta non passa il controllo dei tipi.
- **I servizi in `lib/**/…-service.ts` e le azioni ricevono `TenantTx`**, non `db`.
- **Il valore va passato come parametro**, mai con `sql.raw`. L'esempio della documentazione di
  Drizzle usa `sql.raw(JSON.stringify(token))`, che apre la porta all'iniezione SQL.
- **Nel codice di oggi:**
  - le letture parallele con `Promise.all`, per esempio in `navigation-service.ts:15-23`,
    `users-service.ts:72` e `dictionary-service.ts:86-89`, dentro una transazione vengono
    eseguite una dopo l'altra. Il costo è basso, ma va misurato;
  - `resolveActor` e il callback `jwt` diventano transazioni brevi;
  - le funzioni `*_guarded` e `set_default_language` vanno chiamate dentro `withTenant`.
- **Il divieto va reso automatico**, non affidato alla memoria:
  - una regola ESLint `no-restricted-imports` vieta `postgres`, `drizzle-orm/postgres-js` e
    `@/lib/db` fuori dallo strato dati;
  - un test AST, sul modello di `guards/permission-declared.test.ts`, verifica che ogni ingresso
    ottenga il tenant con `requireTenant()` o dichiari un'eccezione
    (`allowAnonymousHost`, `allowPlatform`).

**Il pooler (MT-DEC-06).**

- La documentazione di Supabase raccomanda la modalità **sessione** (5432), o la connessione
  diretta, per server Node che restano accesi, e la modalità transazione (6543) per il
  serverless. Construct gira su Kubernetes con pod che restano accesi.
- Supabase avverte anche che postgres.js invia le query in sequenza senza aspettare le risposte
  (*pipelining*). In modalità transazione questo «può bloccare le query o restituire righe
  sbagliate».
- Con `withTenant` ogni accesso è comunque in una transazione esplicita, quindi entrambe le
  modalità sono corrette per il tenant. Il passaggio a 5432 elimina però un'intera classe di
  rischi:
  - stato di sessione condiviso;
  - pipelining;
  - istruzioni preparate (oggi `prepare: false`).

  In cambio limita le connessioni: 20 per pod moltiplicato per le repliche, da confrontare con il
  limite del piano Supabase.

### 4.3 Schema: `id_tenant`, chiavi composte, unicità per tenant, indici

- **`id_tenant bigint not null`** su ogni tabella dei tenant, con chiave esterna verso `tenant`.
- **`unique (id_tenant, id)` sulle tabelle a cui altre puntano**, e chiavi esterne **composte**
  `(id_tenant, id_x)`.
  - Le chiavi esterne si controllano ignorando la RLS. Senza chiavi composte, un errore in una
    funzione o in un'azione potrebbe collegare una riga del tenant A a una del tenant B.
  - Oggi i casi da coprire sono questi:
    - `user_role`→`role`;
    - `role_permission`→`role`;
    - `role_functionality`→`role` e `menu_entry`;
    - `menu_entry`→`menu_entry`, cioè il padre: oggi è `DEFERRABLE INITIALLY DEFERRED` e resta
      tale;
    - `menu_entry_tag`→`menu_entry`.
  - Le funzioni `apply_role_*_deltas` inseriscono coppie arbitrarie `(ruolo, voce)`: con le chiavi
    composte una coppia fra tenant diversi diventa impossibile anche in caso di errore.
- **Unicità per tenant** (`unique (id_tenant, …)`) al posto di quella globale, per esempio sul
  dominio in `allowed_domains` e sulla lingua predefinita. Chiude anche la fuga per cui un errore
  di duplicato rivela che un valore esiste in un altro tenant.
- **Indici che cominciano con `id_tenant`**, per esempio `(id_tenant, id_parent, order)` al posto
  di `menu_entry_parent_order_idx`. Supabase misura una differenza da 171 ms a meno di 0,1 ms
  sulla colonna filtrata dalla policy. Le query Drizzle filtrano **anche** esplicitamente per
  `id_tenant`, così la RLS resta la rete di sicurezza e non l'unico filtro.
- **Id numerici e sequenze globali.** Le sequenze `s_id_*` sono condivise, quindi gli id rivelano
  i volumi della piattaforma e si possono indovinare. OWASP API1 suggerisce id non indovinabili,
  ma il foglio di riferimento OWASP sulla multi-tenancy precisa che non sostituiscono il controllo
  d'accesso. Con la RLS e i 404 identici per "non esiste" e "è di un altro tenant", gli id
  numerici negli URL (`roleId`, `funcId`, `itemId`) restano accettabili. Un `public_id` UUID è un
  miglioramento facoltativo (MT-DB-9).

### 4.4 Classificazione delle tabelle

Riprende MT-07 dei requisiti, verificata sullo schema attuale.

| Tabella | Diventa | Note |
|---|---|---|
| `tenant` (nuova) | piattaforma | slug, nome, stato `active/suspended/archived/pending_deletion`; letta dall'app per risolvere l'host |
| `tenant_membership` (nuova, la `user_tenants` della #12) | per tenant | `(id_tenant, user_id)`, stato invitato / in attesa / attivo / disattivato, ultimo accesso; sostituisce `tenantValidationPending` |
| `tenant_domain` (nuova, da `allowed_domains`) | per tenant | dominio verificato o no, ingresso automatico sì o no, ruolo iniziale |
| `tenant_entitlement` (nuova) | per tenant, **scritta solo dalla piattaforma** | funzionalità concesse (MT-DEC-04) |
| `audit_event` (nuova) | per tenant (o di piattaforma) | §4.8 |
| `users` | **globale** | identità; `id_user_status` diventa la disattivazione globale, quella per tenant va in `tenant_membership` |
| `user_identity` (nuova) | globale | `(provider, issuer, subject)` per l'accesso OIDC; §4.7 |
| `password_set_tokens` | per tenant | l'invito porta al tenant che lo ha emesso; il reset password resta globale (MT-DEC-07) |
| `auth_rate_limit` | globale | aggiungere una dimensione per tenant sui tentativi per account |
| `role` | per tenant (MT-DEC-02) | SERVICE per tenant; SYSTEM vedi §4.5 |
| `role_history` | per tenant | nessun codice la legge; si può anche eliminare |
| `user_role` | per tenant | `(id_tenant, user_id, id_role)` |
| `permission` | **globale** | catalogo dei codici dichiarati nel sorgente (0041) |
| `role_permission` | per tenant | chiave composta verso `role`, semplice verso `permission` |
| `menu_entry`, `menu_entry_tag`, `role_functionality` | per tenant | ogni tenant ha il proprio menu; le voci di sistema si copiano da un modello (MT-08) |
| `app_language` | globale (catalogo) | più una nuova `tenant_language (id_tenant, id_language, is_active, is_default)` con una sola predefinita **per tenant** |
| `translation_key` | globale | |
| `translation_value` | globale | più una nuova `translation_override (id_tenant, id_translation_key, id_language, value)` |
| `dictionary_version` | per coppia tenant-lingua | oggi è una colonna di `app_language`, con trigger che la aumentano per tutti |
| `app_theme` | per tenant | da riga singola (`id boolean`) a `id_tenant` come chiave |
| `user_info` | — | non usata dal codice: eliminarla |
| `role_type`, `functionality_type`, `user_status` | globali | tabelle di tipo |
| `construct_schema_migration` | operativa | già esclusa dall'utente dell'app |

**Il controllo che impedisce di dimenticarsene.** In CI ogni tabella deve essere in **uno** di
due elenchi:

- "per tenant": `id_tenant` più RLS attiva più policy restrittiva;
- "globale": solo lettura per l'app.

Una tabella nuova non classificata fa fallire il test (MT-TEST-1).

### 4.5 Ruoli di sistema e invariante "ultimo amministratore"

**Oggi** i ruoli 0 (Utente registrato) e 1 (Amministratore) hanno id fissi, usati dal codice
(`lib/rbac/types.ts:6-7`, `lib/auth-policy.ts:19`, `auth-roles.ts:23`, `users-actions.ts:54`) e
dalle funzioni SQL (`0003_admin_invariant.sql:13,36,68`). Il ruolo 2 non ha logica.

**Due strade (MT-DEC-02):**

- **A. Ruoli SYSTEM globali, assegnazioni per tenant.** `role.id_tenant` è NULL per 0 e 1, e
  `user_role` porta il tenant.
  - Si cambia poco codice: gli id 0 e 1 restano.
  - In cambio:
    - la policy di `role` diventa `id_tenant is null or id_tenant = tenant corrente`, in lettura
      e con regole diverse in scrittura;
    - la chiave esterna composta `user_role(id_tenant, id_role)`→`role` non funziona per i ruoli
      con tenant NULL;
    - i permessi del ruolo 0 (`role_permission`) devono comunque portare il tenant.

  Le eccezioni si moltiplicano proprio nel punto più delicato.
- **B. Copia per tenant (raccomandata).** Alla creazione del tenant, il modello copia "Utente
  registrato" e "Amministratore del tenant" come righe di quel tenant, riconosciute da una
  colonna `system_key` (`REGISTERED`, `TENANT_ADMIN`) invece che dall'id.
  - Ogni riga di `role` ha un tenant, tutte le chiavi esterne sono composte e la policy è una
    sola.
  - Il costo è una tantum: sostituire `ROLE_ADMINISTRATOR = 1` e `ROLE_REGISTERED = 0` con una
    ricerca per `system_key` nel tenant corrente, nel codice e in 0003.

**Il ruolo 2** diventa "Amministratore di piattaforma" (TB-DEC-03). Raccomandazione: **non** come
ruolo dentro i tenant, ma come attributo dell'identità globale, per esempio
`users.is_platform_admin` o una tabella `platform_admin`. Un tenant non deve poterlo assegnare e
nemmeno vedere.

**L'invariante "ultimo amministratore attivo" diventa per tenant:**

- conteggio per tenant;
- lock con chiave a due numeri, `pg_advisory_xact_lock(49374202, id_tenant)`, così due tenant non
  si aspettano a vicenda;
- un amministratore attivo vuol dire: membro attivo del tenant, identità globale attiva, ruolo
  `TENANT_ADMIN` in quel tenant.

### 4.6 Applicazione: da dove arriva il tenant, token, ingressi, cache

**Risoluzione del tenant:**

- **Prima dell'accesso:** solo dall'**host** (sottodominio `{slug}.<dominio>` o dominio
  personalizzato, come in MT-04 e WL-02). Riguarda:
  - il layout radice (tema e i18n prima del login, `app/layout.tsx`);
  - `/api/i18n/languages` e `/api/i18n/dictionary` (anonimi);
  - `register`, `forgot-password` e `set-password`.

  `proxy.ts` esclude `/api`, quindi ogni handler pubblico risolve il tenant da solo con
  `withAnonymousHost`. Un host sconosciuto mostra "organizzazione non trovata" (TB-DEC-05).
- **Dopo l'accesso:** `activeTenantId` nel JWT, scritto nel callback `jwt` accanto a `userId`
  (`lib/auth.ts:211`). Il token però è solo un **suggerimento**:
  - a ogni richiesta `resolveUserAuthorization` e `resolveActor` rileggono l'appartenenza attiva
    a quel tenant, come oggi rileggono stato e ruoli;
  - così la revoca resta immediata;
  - `Actor` (`lib/rbac/actor.ts:9-14`) porta il `TenantId` verificato.
- **Mai dal corpo della richiesta.** Nessuna server action né route handler accetta `id_tenant`
  come argomento. Gli id di oggetti che arrivano dal client (`roleId`, `idParent`, `userId` in
  `send-invite`) restano possibili, ma la RLS e le chiavi composte li rendono innocui se sono di
  un altro tenant.
- **Cambio di tenant (MT-05):**
  1. una server action verifica l'appartenenza;
  2. chiama `unstable_update({ activeTenantId })`;
  3. il callback `jwt` **riverifica** prima di scriverlo.

  Auth.js avverte che i dati di `update()` arrivano dal client e vanno validati. Sul web, se i
  tenant hanno domini diversi, si passa dal dominio di autenticazione centrale (TB-DEC-09).
- **Il menu laterale** oggi usa `session.user.roleIds` (`app/(protected)/layout.tsx:10`). Deve
  usare i ruoli **del tenant corrente**, riletti nella stessa richiesta.

**Ingressi.** Il meccanismo di oggi (`guards/permission-declared.test.ts`) è già quello che
raccomandano Next.js e OWASP: ogni server action e route handler fa i propri controlli, e
`proxy.ts` non è un confine di sicurezza (CVE-2025-29927 permetteva di saltare il middleware). Si
estende con `requireTenant()`.

**Cache.** Oggi non c'è nessuna cache di Next.js fra richieste, ed è un vantaggio da conservare.
Da cambiare:

- **`domainCache`** (`lib/auth.ts:25-39`): una sola lista globale con validità di 60 secondi.
  Diventa una mappa dominio → tenant, oppure va interrogata per tenant.
- **I dizionari** (`lib/i18n/dictionary-service.ts:11,21`) hanno chiave per lingua. Diventano
  `(id_tenant, codice lingua)` se i tenant possono sovrascrivere le traduzioni (TB-DEC-04).
- **Il trigger `translation_key_bump_versions`** aumenta la versione di tutte le lingue: con
  tenant e sovrascritture va ripensato.
- **`revalidatePath('/', 'layout')`**, in 12 punti, svuota la cache di navigazione di tutti a ogni
  modifica. Non fa uscire dati, ma con molti tenant pesa: valutarlo dopo.
- **Regola per il futuro:** ogni funzione con `'use cache'` riceve `tenantId` come argomento ed
  etichette `t:{id}:…`, e il controllo d'accesso si fa **fuori** dalla cache.

**Log.** Ogni riga deve avere `requestId`, `userId` e `tenantId` verificato, con un logger figlio
creato all'ingresso. Senza questi dati un incidente fra tenant non è nemmeno ricostruibile.

### 4.7 Identità e accesso

- **Identità globale con appartenenza per tenant** (TB-DEC-02, #12): confermata.
- **Non riconoscere gli account dall'email negli accessi OIDC.** Oggi il primo accesso cerca o
  crea l'utente **per email** (`lib/auth.ts:188-204`). Con un solo provider Entra fissato su una
  directory (`AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`) il rischio è contenuto. Con i provider per
  tenant (MT-09) diventa il caso "nOAuth": il claim `email` è modificabile o non verificato, e
  così si prende il controllo di un account da un'altra directory. Semperis lo ha trovato in circa
  il 10% di oltre 100 applicazioni SaaS. Microsoft dice di non usare mai `email`,
  `preferred_username` o `unique_name` per autorizzare.

  **Raccomandazione:**
  - tabella `user_identity` con chiave `(provider, issuer, subject)`, e per Entra `(tid, oid)`;
  - l'email resta un attributo;
  - l'unione con un account esistente avviene solo dopo una verifica.
- **Ingresso automatico per dominio** (la "associazione automatica" della #12):
  - solo per domini **verificati con un record DNS TXT**, ricontrollati periodicamente;
  - crea un'appartenenza "in attesa" o con il ruolo iniziale del tenant, **mai** amministratore;
  - non prende mai possesso di un account che esiste già.

  Un dominio scaduto e ricomprato ha dato accesso ad account Google-SSO in diverse applicazioni
  (Truffle, 2025).
- **Inviti come "oracolo".** Oggi `prepareInvitation` restituisce `null` se l'utente esiste già con
  una password (`lib/auth-invitations.ts:25`). Con identità globale, un admin del tenant A
  scoprirebbe che una persona ha un account per il tenant B. L'invito per tenant crea
  un'appartenenza "invitato" e risponde sempre allo stesso modo.
- **La griglia utenti** (`lib/rbac/users-service.ts:60-80`) oggi elenca **tutti** gli utenti. Deve
  partire da `tenant_membership`.

### 4.8 Piattaforma, funzionalità concesse, assistenza, audit

- **Console di piattaforma** (MT-10). Lavora sulle tabelle di piattaforma (`tenant`,
  `tenant_domain`, `tenant_entitlement`, i modelli) con `withPlatform`. **Non** si raccomanda un
  utente Postgres con BYPASSRLS per l'app.
  - Le letture fra tenant (per esempio il numero di utenti attivi per la griglia dei tenant) si
    fanno con funzioni dedicate che restituiscono solo aggregati, oppure entrando in ogni tenant
    con `withTenant`.
  - Ogni operazione di piattaforma scrive l'audit.
- **Funzionalità concesse a ogni tenant (MT-DEC-04, dalla #12).** La piattaforma decide quali
  codici del catalogo, e quali voci del menu modello, un tenant può usare
  (`tenant_entitlement`). L'admin del tenant crea ruoli e assegna solo quello che gli è stato
  concesso.
  - Si fa rispettare in due punti:
    - nelle guardie anti-escalation già esistenti (`lib/rbac/grant-guards.ts:28-80`), che
      aggiungono il controllo "concesso al tenant";
    - con una chiave esterna composta `role_permission(id_tenant, codice)`→`tenant_entitlement`,
      oppure con un trigger.
  - Va chiarito se l'admin del tenant può anche **creare** voci di menu proprie, o solo assegnare
    quelle della piattaforma: la #12 non lo dice.
- **Accesso di assistenza** (MT-11, "il super admin può sempre intervenire"). Si entra nel tenant
  con:
  - `withTenant(target)`;
  - motivo obbligatorio;
  - durata limitata;
  - fascia visibile;
  - audit con **due** identità: chi opera e per conto di chi.

  Microsoft definisce l'impersonazione pericolosa proprio senza questi elementi.
- **Audit** (PERM-12, commento della #12). Tabella `audit_event` con:
  - `id_tenant`;
  - attore e attore reale;
  - evento, oggetto, prima e dopo, istante.

  Si scrive **nella stessa transazione** della modifica, così non c'è modifica senza audit. Oggi
  l'audit esiste solo come righe di log per l'i18n (`lib/i18n/audit.ts:9-14`).
- **Dipartimenti (MT-DEC-05).** Albero facoltativo sotto il tenant, **dentro** il confine:
  - ogni tabella ha `id_tenant` e chiavi composte;
  - la policy restrittiva di tenant resta com'è;
  - la visibilità per dipartimento è una policy **permissiva** in più, oppure si gestisce nel
    codice.

  Il modello consigliato è lo stesso di `menu_entry` (padre e figlio). `ltree` o una tabella di
  chiusura servono solo se le query sull'albero diventano pesanti. Raccomandazione: **rimandarlo**
  a dopo il primo rilascio multi-tenant, verificando però che lo schema lo permetta.

### 4.9 Test che dimostrano l'isolamento

OWASP chiede di provare l'isolamento **con lo stesso utente, lo stesso percorso di connessione e
la stessa modalità del pooler** dell'applicazione. Le basi ci sono già:

- il test d'integrazione gira con l'utente limitato dell'app;
- `schema-contract.integration.test.ts` confronta il catalogo vero con il modello Drizzle;
- l'E2E pytest ha due persone di test.

Cosa aggiungere:

1. **Controllo dello schema** (estende `schema-contract` e `db.mjs boundary-check`). Per ogni
   tabella:
   - classificata come per tenant oppure globale;
   - se per tenant: `id_tenant not null`, RLS attiva (e forzata, se si fa MT-DB-2), almeno una policy
     **RESTRICTIVE** con `USING` e `WITH CHECK`, indice che comincia con `id_tenant`.

   In più, su tutto lo schema:
   - nessuna funzione SECURITY DEFINER fuori da un elenco rivisto;
   - tutte le viste con `security_invoker`;
   - l'utente dell'app non è proprietario e non ha BYPASSRLS.

   Oggi `boundary-check` verifica i privilegi ma **non** la RLS.
2. **Test nel database.** Due tenant di prova A e B, eseguiti come utente dell'app:
   - con il contesto di A, leggere, modificare o cancellare righe di B tocca 0 righe;
   - inserire con `id_tenant = B` dà errore;
   - senza contesto ogni query dà errore 42501;
   - dopo una transazione con A, la transazione successiva **sulla stessa connessione** non ha
     più contesto.
3. **Test HTTP** (pytest). Una persona del tenant A ripete ogni ingresso con id validi del
   tenant B: server action, route handler, pagine con parametri. Deve ricevere sempre 404 o 403,
   e mai dati di B nel corpo della risposta. L'elenco degli ingressi c'è già (§4 del rapporto),
   e il test AST può generarlo.
4. **Test di concorrenza.** Richieste di A e B alternate e in parallelo **attraverso il pooler
   reale**: nessuna risposta deve contenere righe con l'`id_tenant` sbagliato. Serve contro il
   pipelining di postgres.js (§4.2).
5. **Test di ripristino ed esportazione** di un singolo tenant, con due tenant presenti
   (MT-14).

## 5. Percorso di migrazione

Ordine raccomandato. Ogni passo si può rilasciare da solo e lascia l'app funzionante con **un
solo tenant**.

1. **Decisioni** di §6.
2. **Rimozione dei rischi di oggi**, utili anche senza tenant:
   - `replace_menu_entry_tags` diventa INVOKER con `search_path=''`;
   - controllo della RLS in `boundary-check` e nel contratto di schema;
   - eliminazione di `user_info`;
   - log con id di richiesta.
3. **Strato dati:**
   - `withTenant`, con il tenant "predefinito" fisso;
   - `db` non più esportato;
   - regola ESLint e test AST.

   Tutto il codice passa per la nuova porta **prima** che lo schema cambi.
4. **Schema:**
   - tabella `tenant` con il tenant predefinito (id 1), più `tenant_membership` riempita con gli
     utenti di oggi;
   - `id_tenant default 1` sulle tabelle per tenant; con un valore fisso Postgres non riscrive la
     tabella;
   - `not null` in tre passi: CHECK `NOT VALID`, poi `VALIDATE`, poi `SET NOT NULL`;
   - `unique (id_tenant, id)` con `CREATE UNIQUE INDEX CONCURRENTLY`;
   - chiavi esterne composte `NOT VALID` e poi `VALIDATE`;
   - unicità e indici per tenant.

   Le tabelle sono piccole, quindi i passi senza lock lungo sono prudenza più che necessità.
5. **RLS di tenant attiva mentre esiste un solo tenant.** Postgres non ha una modalità "solo
   registra". Se il contesto manca da qualche parte, il risultato è un **errore**, non una fuga,
   perché non c'è un altro tenant da cui prendere dati. Si attiva tabella per tabella; l'abilitazione prende un
   lock esclusivo, quindi va fatta con `lock_timeout`.
6. **Togliere il `default 1`**, così ogni inserimento deve indicare il tenant.
7. **Ruoli di sistema, invariante, lingue, tema, domini per tenant** (§4.4–4.5).
8. **Identità** (`user_identity`) e **appartenenze** con stati, inviti per tenant, ingresso per
   dominio verificato.
9. **Test di isolamento** (§4.9), con un secondo tenant di prova.
10. **Solo con i test verdi:** creazione di tenant reali, console di piattaforma, selettore di
    tenant, brand per host (#3, #11).

## 6. Decisioni da prendere

Vanno prese prima di MT-DB-*. Riprendono le decisioni TB-DEC dei [requisiti](multi-tenancy-requirements.md#1-decisioni-dimpianto), che restano valide salvo
dove indicato.

- [ ] ID=MT-DEC-01, Severity=Critical, Complexity=Low, Priority=P0, Estimate=minutes, Title=Confermare il modello condiviso con RLS, Fix description=Confermare TB-DEC-01 (database condiviso, `id_tenant`, RLS) aggiungendo tre regole che lo studio del 2026-10-07 non diceva: policy di tenant **RESTRICTIVE**, `postgres` (che ha BYPASSRLS) tenuto fuori da app e job, funzione `current_tenant_id()` che blocca con errore anche sulla stringa vuota. Aggiornare la nota della specifica 2026-08-02 (:42): niente policy per utente, ma sì policy per tenant.
- [ ] ID=MT-DEC-02, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Ruoli di sistema copiati per tenant o globali, Fix description=Raccomandata la strada B di §4.5: copie per tenant riconosciute da `system_key`, così tutte le righe di `role` hanno un tenant e tutte le chiavi esterne sono composte. Alternativa A: ruoli 0 e 1 globali con `id_tenant` NULL (meno codice da cambiare, più eccezioni in RLS e chiavi esterne).
- [ ] ID=MT-DEC-03, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Amministratore di piattaforma fuori dai tenant, Fix description=Il ruolo 2 diventa un attributo dell'identità globale (`platform_admin`), non un ruolo dentro i tenant. Decidere se può entrare in un tenant per assistenza (MT-PLAT-3) o vedere solo metadati e aggregati.
- [ ] ID=MT-DEC-04, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Funzionalità concesse per tenant, Fix description=Dalla #12: la piattaforma decide codici e voci di menu concessi a ogni tenant; l'admin del tenant assegna solo quelli. Decidere: (a) granularità della concessione (codice del catalogo, cartella del menu modello, o entrambi); (b) se l'admin del tenant può creare voci di menu proprie o solo usare quelle della piattaforma; (c) cosa succede ai ruoli quando la piattaforma toglie una concessione (revoca a cascata o concessione "spenta").
- [ ] ID=MT-DEC-05, Severity=Low, Complexity=Medium, Priority=P2, Estimate=hours, Title=Dipartimenti sotto il tenant, Fix description=Raccomandato rimandarli al dopo-rilascio, verificando che lo schema li permetta (tabella ad albero con `id_tenant`, policy permissiva in più dentro il confine). Chiedere a chi ha scritto la #12 se servono per il primo cliente.
- [ ] ID=MT-DEC-06, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Pooler in modalità sessione o transazione, Fix description=Con `withTenant` entrambe sono corrette. Raccomandata la modalità sessione (5432) per i pod che restano accesi, come indica Supabase: elimina stato condiviso, pipelining di postgres.js e il vincolo `prepare:false`. Verificare il limite di connessioni del piano contro `max:20` moltiplicato per le repliche. Se si resta su 6543, il test di concorrenza (MT-TEST-4) è obbligatorio.
- [ ] ID=MT-DEC-07, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Password e reset con identità globale, Fix description=Con identità globale la password è una sola: il reset avviato dal tenant A cambia la password usata anche per il tenant B. Decidere se va bene (raccomandato, è il comportamento atteso da chi ha un account solo) e come si presenta il brand nella mail di reset (quello del tenant da cui è partito).
- [ ] ID=MT-DEC-08, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Selettore di tenant sempre visibile o solo con più tenant, Fix description=La #12 lo vuole "sempre presente"; i requisiti (MT-05) solo con più di un tenant. Raccomandato: voce "Cambia organizzazione" sempre nel pannello utente, disattivata con un solo tenant.
- [ ] ID=MT-DEC-09, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Id pubblici non indovinabili, Fix description=Con RLS e 404 uniformi gli id numerici negli URL sono accettabili. Decidere se aggiungere un `public_id` UUID per URL e API (consigliato da OWASP API1, non necessario per l'isolamento). Raccomandato: non ora, ma ammesso nello schema.

## 7. Lavori

### 7.1 Rischi da togliere subito (utili anche senza tenant)

- [ ] ID=MT-DB-1, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=`replace_menu_entry_tags` da DEFINER a INVOKER, Fix description=Ridefinire la funzione `security invoker set search_path = ''` con nomi qualificati, come tutte le altre (DB-6 della specifica 2026-08-02). Oggi gira come `postgres` e scavalca qualunque policy (`schema.sql:2033-2043`).
- [ ] ID=MT-DB-2, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=hours, Title=Proprietario delle tabelle senza BYPASSRLS, Fix description=Oggi le tabelle sono di `postgres`, che su Supabase ha BYPASSRLS: `FORCE ROW LEVEL SECURITY` da solo non lo ferma. Valutare un ruolo proprietario dedicato `NOLOGIN NOBYPASSRLS` (le migrazioni fanno `SET ROLE` su di esso), più `FORCE` sulle tabelle dei tenant: così anche le migrazioni rispettano le policy e devono dichiarare il tenant quando toccano dati. Costo: policy per il ruolo proprietario sulle migrazioni che scrivono semi (traduzioni, menu modello). Se non si fa, documentare che `postgres` è un accesso di piattaforma e tenerlo fuori da job e script automatici.
- [ ] ID=MT-TEST-1, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=RLS nel controllo dello schema e in boundary-check, Fix description=Estendere `schema-contract.integration.test.ts` e `db.mjs boundary-check` (stesse sonde, "change one, change the other"): RLS attiva su ogni tabella (e forzata, se si fa MT-DB-2), policy presenti, nessuna funzione DEFINER fuori da un elenco, viste `security_invoker`, utente dell'app non proprietario. Prepara la classificazione per tenant/globale di MT-TEST-2.
- [ ] ID=MT-OPS-1, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Id di richiesta e contesto nei log, Fix description=Logger figlio per richiesta con `requestId` e `userId` (poi `tenantId`) in `lib/logger.ts`; propagarlo a servizi e azioni.
- [ ] ID=MT-OPS-2, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Data API di Supabase disattivata, Fix description=L'app non la usa. Disattivarla a livello di progetto in tutti gli ambienti, oltre alle revoche di 0002/0005. Dal 2026-10-30 Supabase non concede più automaticamente i permessi ad `anon` e `authenticated` sulle tabelle nuove, ma le tabelle esistenti li conservano: le revoche restano necessarie.
- [ ] ID=MT-DB-3, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Eliminare `user_info` e valutare `role_history`, Fix description=`user_info` non è usata dal codice; `role_history` è scritta da un trigger e mai letta. Meno tabelle da classificare e proteggere.

### 7.2 Strato dati

- [ ] ID=MT-DB-4, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=days, Title=`withTenant` come unica porta verso il database, Fix description=Nuovo `lib/db/tenant-db.ts` con `withTenant`, `withPlatform`, `withAnonymousHost` e i tipi `TenantId`/`TenantTx`; `db` non più esportato. Portare tutti gli accessi di oggi (23 server action, i route handler, i servizi, i callback di Auth.js) dentro una transazione. Tenant fisso "predefinito" finché lo schema non cambia.
- [ ] ID=MT-DB-5, Severity=High, Complexity=Low, Priority=P0, Estimate=hours, Title=Divieto automatico di scavalcare `withTenant`, Fix description=Regola ESLint `no-restricted-imports` (vieta `postgres`, `drizzle-orm/postgres-js` e il client fuori dallo strato dati) e test AST sul modello di `guards/permission-declared.test.ts`: ogni ingresso ottiene il tenant con `requireTenant()` o dichiara `allowAnonymousHost`/`allowPlatform`.
- [ ] ID=MT-DB-6, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Tabelle di tenant, appartenenze e `id_tenant`, Fix description=Tabelle `tenant`, `tenant_membership`, `tenant_domain`, `tenant_entitlement`, `tenant_language`, `translation_override`, `audit_event`; `id_tenant` sulle tabelle per tenant di §4.4 con tenant predefinito 1; `not null` in tre passi; `unique (id_tenant, id)`; chiavi esterne composte; unicità e indici che cominciano con `id_tenant`.
- [ ] ID=MT-DB-7, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=days, Title=Funzione `current_tenant_id()` e policy restrittive, Fix description=Schema `app_private` con la funzione di §4.1; su ogni tabella per tenant: sostituire `construct_runtime_server_access` con la coppia restrittiva + permissiva; sulle globali: sola lettura per l'app. Attivare mentre esiste un solo tenant. Documentare l'eccezione ai linter Supabase 0006/0024.
- [ ] ID=MT-DB-8, Severity=High, Complexity=Medium, Priority=P0, Estimate=days, Title=Ruoli di sistema e invariante per tenant, Fix description=Secondo MT-DEC-02: `system_key` al posto degli id 0 e 1 nel codice (`types.ts`, `auth-policy.ts`, `auth-roles.ts`, `users-actions.ts`) e in 0003; conteggio dell'ultimo amministratore per tenant con lock `pg_advisory_xact_lock(49374202, id_tenant)`; ruolo 2 rimosso dai ruoli di tenant (MT-DEC-03).
- [ ] ID=MT-DB-9, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=days, Title=Lingue, traduzioni e tema per tenant, Fix description=Lingua predefinita unica per tenant (`tenant_language`), `set_default_language` per tenant, sovrascritture delle traduzioni, versione del dizionario per coppia tenant-lingua con trigger da rivedere, `app_theme` con `id_tenant` come chiave e `saveAppTheme` con WHERE. Reset E2E (`db.mjs test-reset-e2e`) per tenant.
- [ ] ID=MT-DB-10, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Modello per la creazione dei tenant, Fix description=Funzione o servizio di piattaforma che crea un tenant copiando voci di menu di sistema (oggi 1–7, protette da `is_immutable`), ruoli di sistema, tema e lingue predefinite, poi invita il primo amministratore (MT-08 dei requisiti).

### 7.3 Applicazione e identità

- [ ] ID=MT-APP-1, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=days, Title=Tenant nel token rivalidato a ogni richiesta, Fix description=`activeTenantId` nel JWT; `resolveUserAuthorization` e `resolveActor` rileggono l'appartenenza attiva e i ruoli **di quel tenant**; `Actor` porta il `TenantId`; il menu laterale usa i ruoli del tenant corrente; nessun ingresso accetta `id_tenant` dal client.
- [ ] ID=MT-APP-2, Severity=High, Complexity=Medium, Priority=P0, Estimate=days, Title=Tenant dall'host prima dell'accesso, Fix description=Risoluzione da sottodominio o dominio personalizzato per layout radice, `/api/i18n/languages`, `/api/i18n/dictionary`, `register`, `forgot-password`, `set-password`. Host sconosciuto: "organizzazione non trovata" (TB-DEC-05). Base per #3.
- [ ] ID=MT-APP-3, Severity=High, Complexity=Low, Priority=P0, Estimate=hours, Title=Cache in memoria con chiave di tenant, Fix description=`domainCache` (`lib/auth.ts:25`) diventa per tenant o mappa dominio→tenant; dizionari e versioni (`dictionary-service.ts:11,21`) con chiave `(tenant, lingua)`. Regola scritta per ogni futura `'use cache'`: `tenantId` come argomento, etichette `t:{id}:…`, controllo d'accesso fuori.
- [ ] ID=MT-APP-4, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=days, Title=Cambio di tenant, Fix description=Voce "Cambia organizzazione" nel pannello utente (MT-DEC-08); server action che verifica l'appartenenza e chiama `unstable_update`; il callback `jwt` riverifica; ricordare l'ultimo tenant in `tenant_membership`; ricaricare menu, tema, lingue.
- [ ] ID=MT-AUTH-1, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Identità OIDC per issuer e subject, Fix description=Tabella `user_identity (provider, issuer, subject)`, per Entra `(tid, oid)`; il primo accesso non cerca più l'utente per email (`lib/auth.ts:188-204`); unione con account esistente solo dopo verifica. Prerequisito dei provider per tenant (MT-09).
- [ ] ID=MT-AUTH-2, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Inviti e griglia utenti per tenant, Fix description=L'invito crea un'appartenenza "invitato" nel tenant e risponde sempre allo stesso modo, anche se l'identità esiste già (oggi `auth-invitations.ts:25` lo rivela); la griglia utenti e `send-invite` partono da `tenant_membership`; disattivazione per tenant separata da quella globale.
- [ ] ID=MT-AUTH-3, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Ingresso automatico per dominio verificato, Fix description=`tenant_domain` con verifica DNS TXT ripetuta periodicamente; ingresso automatico solo su domini verificati, con appartenenza "in attesa" o ruolo iniziale, mai amministratore, mai presa di possesso di un account esistente. Sostituisce `allowed_domains`.

### 7.4 Piattaforma e audit

- [ ] ID=MT-PLAT-1, Severity=Medium, Complexity=High, Priority=P1, Estimate=days, Title=Console di piattaforma, Fix description=Griglia e dettaglio dei tenant, ciclo di vita (attivo, sospeso, archiviato, in eliminazione), domini, amministratori, funzionalità concesse; tutto con `withPlatform` e audit. Letture fra tenant solo come aggregati.
- [ ] ID=MT-PLAT-2, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Funzionalità concesse rispettate, Fix description=Secondo MT-DEC-04: `tenant_entitlement` e controllo "concesso al tenant" in `grant-guards.ts`, più vincolo nel database (chiave esterna composta o trigger) su `role_permission` e `role_functionality`.
- [ ] ID=MT-PLAT-3, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=days, Title=Accesso di assistenza registrato, Fix description=Ingresso dell'amministratore di piattaforma in un tenant con motivo, scadenza, fascia visibile e audit con attore reale e attore per conto di; il tenant vede gli accessi (MT-11 dei requisiti).
- [ ] ID=MT-PLAT-4, Severity=High, Complexity=Medium, Priority=P1, Estimate=days, Title=Tabella di audit nella stessa transazione, Fix description=`audit_event` con `id_tenant`, attore, attore reale, evento, oggetto, prima/dopo, istante, scritto dentro la transazione della modifica; collegare le azioni RBAC, utenti, menu, tema, lingue e piattaforma. Sostituisce l'audit solo-log di `lib/i18n/audit.ts`.

### 7.5 Test

- [ ] ID=MT-TEST-2, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=hours, Title=Classificazione obbligatoria delle tabelle, Fix description=Elenco esplicito per tenant/globale nel contratto di schema; per le tabelle per tenant: `id_tenant not null`, RLS attiva, policy RESTRICTIVE con USING e WITH CHECK, indice che comincia con `id_tenant`. Una tabella non classificata fa fallire la CI.
- [ ] ID=MT-TEST-3, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=days, Title=Test di isolamento nel database, Fix description=Tenant A e B; come utente dell'app: con A, righe di B invisibili e non modificabili; inserimento con tenant B in errore; senza contesto errore 42501; contesto assente nella transazione successiva sulla stessa connessione.
- [ ] ID=MT-TEST-4, Severity=High, Complexity=Medium, Priority=P0, Estimate=days, Title=Test di concorrenza attraverso il pooler, Fix description=Richieste di A e B in parallelo sulla stessa porta usata in produzione; nessuna risposta con righe dell'altro tenant. Obbligatorio se si resta su 6543 (MT-DEC-06).
- [ ] ID=MT-TEST-5, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Test HTTP fra tenant su ogni ingresso, Fix description=Persona del tenant A ripete ogni server action, route handler e pagina con parametri usando id del tenant B: sempre 404/403, mai dati di B. Secondo tenant e relative persone nei fixture pytest; elenco degli ingressi generato dal test AST.
- [ ] ID=MT-TEST-6, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=days, Title=Esportazione, ripristino ed eliminazione di un tenant, Fix description=Esportazione completa di un tenant (con `withTenant`, rispettando la RLS), prova di ripristino di un solo tenant con due presenti, eliminazione definitiva a cascata sulle chiavi composte (MT-14 dei requisiti; GDPR art. 28(3)(g)).

### 7.6 Operatività

- [ ] ID=MT-OPS-3, Severity=Medium, Complexity=Low, Priority=P2, Estimate=hours, Title=Limiti per tenant, Fix description=`statement_timeout` impostato in `withTenant`; limite di frequenza dei tentativi di accesso anche per tenant; quote facoltative (utenti, ruoli, voci) controllate nello strato dati (MT-13 dei requisiti).
- [ ] ID=MT-OPS-4, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Versione Postgres aggiornata, Fix description=Il database di sviluppo è su 17.6, che contiene le correzioni delle due falle RLS note (CVE-2024-10976, CVE-2025-8713). Verificare la stessa versione in produzione e tenere aggiornata la versione minore.

## 8. Differenze rispetto allo studio del 2026-10-07 e alla #12

Lo studio del 2026-10-07 ([requisiti](multi-tenancy-requirements.md)) è confermato nell'impianto. Questo documento
aggiunge o corregge:

| Punto | 2026-10-07 | Qui |
|---|---|---|
| Forma delle policy | "RLS con variabile di transazione" | policy **RESTRICTIVE**: una permissiva accanto alle `using (true)` di oggi non avrebbe effetto |
| Proprietario delle tabelle | non trattato | `postgres` ha BYPASSRLS e vede tutto anche con FORCE: va tenuto fuori dall'app e dai job; proprietario dedicato da valutare (MT-DB-2) |
| Variabile mancante | non trattato | la funzione blocca anche sulla **stringa vuota**, non solo su NULL |
| Funzioni DEFINER | non trattato | `replace_menu_entry_tags` va corretta; elenco controllato in CI |
| Connessioni | non trattato | ogni accesso in transazione; pooler da decidere (MT-DEC-06) |
| Chiavi esterne | non trattato | **composte** con `id_tenant`, perché ignorano la RLS |
| Ruoli di sistema | "valgono in ogni tenant" (MT-03) | raccomandata la **copia per tenant** con `system_key` (MT-DEC-02) |
| Amministratore di piattaforma | ruolo 2 ridefinito | attributo dell'identità globale, non ruolo di tenant |
| Identità OIDC | non trattato | chiave `(issuer, subject)`, mai l'email (nOAuth) |
| Domini | "domini ammessi per tenant" | **verificati con DNS**, ingresso mai come amministratore |
| Funzionalità concesse per tenant | assenti (solo limiti numerici in MT-13) | **nuove**, dalla #12 (MT-DEC-04) |
| Dipartimenti | assenti | dalla #12, rimandati ma ammessi nello schema (MT-DEC-05) |
| Selettore di tenant | solo con più tenant | la #12 lo vuole sempre presente (MT-DEC-08) |
| Audit | PERM-12 | richiesto anche dalla #12; nella stessa transazione, con attore reale |

## Fonti

**PostgreSQL**

- RLS: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- CREATE POLICY: https://www.postgresql.org/docs/current/sql-createpolicy.html
- `set_config` e `current_setting`: https://www.postgresql.org/docs/current/functions-admin.html
- `SET`: https://www.postgresql.org/docs/current/sql-set.html
- ALTER TABLE: https://www.postgresql.org/docs/current/sql-altertable.html
- CREATE FUNCTION: https://www.postgresql.org/docs/current/sql-createfunction.html
- CREATE VIEW: https://www.postgresql.org/docs/current/sql-createview.html
- Variabile vuota dopo la prima impostazione (risposta di Tom Lane):
  https://www.postgresql.org/message-id/CA%2BQ86ij0KDCB0G45G509-8q0DNR611gcKG-sSM83GA1EBL7boA%40mail.gmail.com
- CVE-2024-10976: https://nvd.nist.gov/vuln/detail/CVE-2024-10976
- CVE-2025-8713: https://security-tracker.debian.org/tracker/CVE-2025-8713

**Supabase**

- Connessioni e pooler: https://supabase.com/docs/guides/database/connecting-to-postgres
- postgres.js e pipelining: https://supabase.com/docs/guides/database/postgres-js
- Prestazioni RLS: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
- RLS e ruoli: https://supabase.com/docs/guides/database/postgres/row-level-security,
  https://supabase.com/docs/guides/database/postgres/roles
- Linter: https://supabase.com/docs/guides/database/database-advisors
- Data API: https://supabase.com/docs/guides/database/hardening-data-api
- Cambio dei permessi automatici (2026-10-30):
  https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically

**Drizzle**

- https://orm.drizzle.team/docs/rls
- https://orm.drizzle.team/docs/connect-supabase

**Next.js**

- Proxy: https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- Sicurezza dei dati: https://nextjs.org/docs/app/guides/data-security
- `'use cache'`: https://nextjs.org/docs/app/api-reference/directives/use-cache
- CVE-2025-29927: https://nvd.nist.gov/vuln/detail/cve-2025-29927

**Auth.js**

- https://authjs.dev/reference/nextjs

**OWASP**

- Multi-Tenant Security Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
- API1:2023: https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization
- ASVS 5.0 V8: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md

**AWS**

- SaaS Lens: https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html
- RLS: https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/
- Prescriptive Guidance: https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/rls.html

**Azure**

- Archiviazione dei dati: https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/storage-data
- Identità: https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/identity
- Validazione dei claim: https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation

**Crunchy Data**

- https://crunchydata.com/blog/designing-your-postgres-database-for-multi-tenancy
- https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres

**Citus**

- https://docs.citusdata.com/en/stable/use_cases/multi_tenant.html

**Identità**

- nOAuth: https://www.semperis.com/blog/noauth-abuse-alert-full-account-takeover/
- Domini scaduti e Google SSO: https://thehackernews.com/2025/01/google-oauth-vulnerability-exposes.html
- Verifica dei domini: https://workos.com/docs/domain-verification
