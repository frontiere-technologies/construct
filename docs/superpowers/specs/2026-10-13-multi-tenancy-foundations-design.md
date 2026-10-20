# Specifica — Multi-tenancy, pezzo 1: le fondamenta dell'isolamento (2026-10-13)

Nasce dalla richiesta di rendere Construct multi-tenant
([construct#12](https://github.com/frontiere-technologies/construct/issues/12),
[construct#28](https://github.com/frontiere-technologies/construct/issues/28)), con separazione
logica dei dati nello stesso database e protezione di ogni tenant dagli altri.

Si appoggia su due documenti già scritti:

- i [requisiti TO-BE](../../input-specs/multi-tenancy/multi-tenancy-requirements.md):
  TB-DEC-*, MT-*, WL-02…04;
- lo [studio del 2026-10-13](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-study.md),
  che li verifica contro il codice e le indicazioni pubbliche. Gli ID MT-DEC-*, MT-DB-*, MT-TEST-*
  citati qui vengono da lì.

Le decisioni sono state prese con il proprietario del progetto il 2026-10-13. Quello che resta
fuori da questo pezzo è nel
[documento delle cose rimandate](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-deferred.md).

## Sommario

**Construct è un modello di partenza.** La multi-tenancy deve essere una capacità pronta, che
ogni applicazione derivata accende o no. Per questo lo schema è **sempre** multi-tenant: chi non
vuole i tenant ha un solo tenant, invisibile, e non paga niente in complessità d'uso.

Il lavoro è diviso in sei pezzi, ognuno con specifica, piano e implementazione propri:

1. **fondamenta dell'isolamento** (questo documento);
2. tenant e appartenenze;
3. identità e accesso;
4. tenant corrente;
5. piattaforma;
6. domini dedicati e brand per host.

**Dopo questo pezzo:**

- ogni accesso ai dati passa per un confine di tenant che **PostgreSQL fa rispettare da sé** (Row
  Level Security restrittiva e forzata);
- il codice dell'app raggiunge il database solo attraverso `withTenant` o `withGlobal`;
- ogni tabella è classificata, e una tabella nuova è di tenant se non viene dichiarata globale;
- l'isolamento è dimostrato da test nel database e da test di concorrenza attraverso il pooler.

Per chi usa l'app non cambia niente: esiste solo il tenant predefinito.

**Il vincolo di portabilità.** Deve funzionare su **qualunque PostgreSQL 15 o successivo**
(installato in proprio, AWS RDS, Azure, Neon, Supabase), senza codice specifico di Supabase. Le
viste `security_invoker`, già usate, richiedono la 15; il database di sviluppo è sulla 17.6.

## Decisioni

- [✅] ID=MTF-DEC-1, Title=Database condiviso, `id_tenant` e RLS restrittiva, Requirement=Le tabelle dei tenant hanno `id_tenant`; il confine è una policy **RESTRICTIVE** con `USING` e `WITH CHECK` su `app_private.current_tenant_id()`, che dà errore 42501 se il tenant manca o è vuoto. Conferma TB-DEC-01 e MT-DEC-01.
- [✅] ID=MTF-DEC-2, Title=Schema sempre multi-tenant, Requirement=Anche un'applicazione derivata senza tenant ha lo stesso schema e lo stesso isolamento, con un solo tenant invisibile. Un'impostazione per spegnere le funzioni di tenant nell'interfaccia arriverà nel pezzo 5.
- [✅] ID=MTF-DEC-3, Title=Qualunque PostgreSQL 15+, Requirement=Niente codice specifico di un fornitore. Le revoche ai ruoli di Supabase (`anon`, `authenticated`) restano condizionali, come già sono in 0001, 0002 e 0005.
- [✅] ID=MTF-DEC-4, Title=Proprietario dedicato senza BYPASSRLS, Requirement=`construct_owner` (NOLOGIN, NOBYPASSRLS) possiede tutti gli oggetti; RLS **forzata** su tutte le tabelle; le migrazioni lavorano come `construct_owner` e rispettano le policy. Comportamento identico su ogni fornitore (MT-DB-2).
- [✅] ID=MTF-DEC-5, Title=Ruoli di sistema copiati per tenant, Requirement=Ogni tenant ha le proprie righe "Utente registrato" e "Amministratore del tenant", riconosciute da `role.system_key` (`REGISTERED`, `TENANT_ADMIN`) e non più dagli id 0 e 1 (MT-DEC-02, strada B).
- [✅] ID=MTF-DEC-6, Title=Transazione esplicita, Requirement=Il tenant arriva alla query come transazione passata per parametro (`withTenant(tenantId, tx => …)`), non da un contesto implicito. Scartati AsyncLocalStorage (errori solo a runtime, invisibile a `'use cache'`) e una transazione per richiesta (connessioni occupate per tutta la pagina).
- [✅] ID=MTF-DEC-7, Title=Pooler scelto dalla configurazione, Requirement=Il codice è corretto sia in modalità sessione sia in modalità transazione: ogni query sta in una transazione esplicita, nessuno stato di sessione, `prepare: false` sempre. L'URL di connessione decide (MT-DEC-06).
- [✅] ID=MTF-DEC-8, Title=Tabelle nuove di tenant per default, Requirement=`app_private.protect_tenant_table()` rende una tabella di tenant in un colpo; una tabella globale va dichiarata con `app_private.declare_global_table()` e un motivo. Il contratto di schema fallisce su ogni tabella né di tenant né dichiarata.
- [✅] ID=MTF-DEC-9, Title=Via `role_history` e `user_info`, Requirement=`role_history` è scritta da un trigger e mai letta; `user_info` non è usata. Si eliminano, con il trigger e la vecchia `replace_user_roles` già sostituita dalla variante `_guarded`. L'audit vero arriva nel pezzo 5.
- [✅] ID=MTF-DEC-10, Title=`id_tenant` preso dal contesto, Requirement=La colonna ha come valore predefinito `app_private.current_tenant_id()`: gli inserimenti non passano il tenant esplicitamente, e `WITH CHECK` lo verifica comunque.
- [✅] ID=MTF-DEC-11, Title=Nessun filtro esplicito obbligatorio, Requirement=Le query non devono scrivere `where id_tenant = …`. La garanzia è la RLS verificata in CI, `withTenant` non aggirabile, e i test. Ogni tabella di tenant ha un indice che comincia con `id_tenant`, che il filtro della policy usa.
- [✅] ID=MTF-DEC-12, Title=Classificazioni provvisorie, Requirement=Lingue e traduzioni restano globali e scrivibili fino al pezzo 2; `password_set_tokens` e `allowed_domains` fino al pezzo 3. Il registro ne riporta il motivo.

## 1. Perimetro

### 1.1 Dentro

1. **Rischi di oggi:**
   - `replace_menu_entry_tags` diventa INVOKER con `search_path = ''`;
   - via `user_info`, `role_history` con il suo trigger, e `replace_user_roles`.
2. **Ruolo `construct_owner`**, proprietario di tutti gli oggetti, ed esecutore delle migrazioni
   che lavora come lui.
3. **Schema `app_private`:**
   - `current_tenant_id()`;
   - il registro `table_class`;
   - `protect_tenant_table()` e `declare_global_table()`.
4. **Tabella `tenant`** con il tenant predefinito (id 1).
5. **`id_tenant` sulle tabelle di tenant**, con chiavi esterne composte, chiavi primarie e indici
   che cominciano con `id_tenant`.
6. **`role.system_key`**, e funzioni dell'invariante "ultimo amministratore" per tenant.
7. **RLS forzata su tutte le tabelle**, policy di tenant o globali al posto delle
   `construct_runtime_server_access … using (true)`.
8. **Strato dati applicativo:**
   - `withTenant`, `withGlobal`, `TenantTx`, `GlobalTx`, `TenantId`;
   - `resolveRequestTenant()` che restituisce il tenant predefinito;
   - `Actor.tenantId`;
   - servizi con la nuova firma;
   - client non più esportato.
9. **Regola ESLint e test AST** che impediscono di scavalcare lo strato dati.
10. **Test:**
    - contratto di schema e `boundary-check` estesi;
    - test di isolamento nel database;
    - test di concorrenza attraverso il pooler, in entrambe le modalità.

### 1.2 Fuori

Tutto quello che segue è nel
[documento delle cose rimandate](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-deferred.md):

- appartenenze e loro stati;
- lingue, traduzioni e tema scelti per tenant;
- identità OIDC, inviti e domini per tenant;
- tenant nel token, cambio di tenant e risoluzione dall'host;
- console di piattaforma, funzionalità concesse, audit e interruttore dell'interfaccia;
- test HTTP fra tenant;
- id di richiesta nei log;
- `public_id` UUID e dipartimenti.

### 1.3 Criteri di successo

- [✅] ID=MTF-OK-1, Severity=High, Complexity=Low, Priority=P0, Estimate=hours, Title=Nessun cambiamento visibile, Fix description=L'E2E pytest e i test di integrazione esistenti passano senza modifiche al loro comportamento atteso.
- [✅] ID=MTF-OK-2, Severity=Critical, Complexity=Low, Priority=P0, Estimate=minutes, Title=Classificazione obbligatoria, Fix description=Il contratto di schema fallisce se una tabella di `public` non è registrata, o se una tabella di tenant non rispetta le regole di §2.4.
- [✅] ID=MTF-OK-3, Severity=Critical, Complexity=Low, Priority=P0, Estimate=minutes, Title=Isolamento nel database, Fix description=Con il contesto di A le righe di B sono invisibili e non modificabili; senza contesto ogni tabella di tenant dà 42501.
- [✅] ID=MTF-OK-4, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Isolamento sotto concorrenza, Fix description=Lo stesso vale con transazioni A e B in parallelo attraverso il pooler, in modalità sessione e transazione.
- [✅] ID=MTF-OK-5, Severity=High, Complexity=Low, Priority=P0, Estimate=minutes, Title=Nessun accesso diretto, Fix description=Nessun file fuori da `lib/db/` importa `postgres`, `drizzle-orm/postgres-js` o il client: lo verificano ESLint e un test AST.

## 2. Database

### 2.1 Ruoli

| Ruolo | Attributi | Ruolo nel sistema |
|---|---|---|
| `construct_owner` (nuovo) | NOLOGIN, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB | proprietario di tabelle, sequenze, funzioni, viste e dello schema `app_private` |
| `construct_runtime` (esiste) | NOLOGIN, NOBYPASSRLS | permessi di riga per l'app; invariato |
| login dell'app (es. `construct_app`) | eredita solo `construct_runtime` | invariato |
| utente amministrativo delle migrazioni (`MIGRATION_DATABASE_URL`) | dipende dal fornitore | diventa **membro** di `construct_owner`; possiede solo `construct_schema_migration` |

**Esecutore delle migrazioni** (`db.mjs`, `runInTransaction`):

1. `begin`;
2. `set local role construct_owner`;
3. SQL della migrazione;
4. `reset role`;
5. aggiornamento di `construct_schema_migration`;
6. `commit`.

La migrazione che crea `construct_owner` e gli cede la proprietà è l'unica che gira ancora come
utente amministrativo: l'esecutore fa `set local role` solo se `construct_owner` esiste già.

**Permessi di creazione.** Perché le migrazioni possano creare oggetti lavorando come
`construct_owner`, la stessa migrazione concede `create` sullo schema `public` (che 0002 ha tolto
a PUBLIC) e `create` sul database, che serve per creare `app_private`. Sono permessi, non
attributi del ruolo: `construct_owner` resta NOCREATEDB e NOCREATEROLE. Serve anche `usage` su
`public`, che 0002 ha tolto a PUBLIC: senza, lavorando come `construct_owner` non si risolve
nessun nome dello schema (prova di MTF-1).

**Permessi predefiniti** (`alter default privileges for role construct_owner`): gli oggetti futuri
concedono `select, insert, update, delete` sulle tabelle e `usage, select` sulle sequenze a
`construct_runtime`, e niente a PUBLIC.

**Semi nelle migrazioni.** Con la RLS forzata, una migrazione che scrive in una tabella di tenant
deve dichiarare il tenant:

```sql
select set_config('app.tenant_id', '1', true);
insert into public.menu_entry (…) values (…);
```

Una migrazione che deve toccare **tutti** i tenant li scorre uno per uno:

```sql
do $$
declare t record;
begin
  for t in select id from public.tenant loop
    perform set_config('app.tenant_id', t.id::text, true);
    -- operazione sul tenant t
  end loop;
end $$;
```

### 2.2 Schema `app_private`

Proprietario `construct_owner`. A `construct_runtime` vanno solo:

- `usage` sullo schema;
- `execute` su `current_tenant_id()`;
- `select` su `table_class`, che serve a `boundary-check`.

```sql
create function app_private.current_tenant_id() returns bigint
language plpgsql stable parallel safe security invoker set search_path = '' as $$
declare v text := current_setting('app.tenant_id', true);
begin
  if v is null or v = '' then
    raise exception 'tenant context missing' using errcode = '42501';
  end if;
  return v::bigint;
end $$;

create table app_private.table_class (
  table_name text primary key,           -- nome in public
  class text not null check (class in ('tenant', 'global_read', 'global_write')),
  reason text,                           -- obbligatorio per le globali
  check (class = 'tenant' or reason is not null)
);
```

Le funzioni sono INVOKER, si usano solo nelle migrazioni e non sono eseguibili dall'app.

- **`protect_tenant_table(p_table regclass)`**:
  1. verifica che esista `id_tenant bigint not null` con chiave esterna verso `tenant`, altrimenti
     dà errore;
  2. `enable` e `force row level security`;
  3. elimina le policy esistenti sulla tabella;
  4. crea:

     ```sql
     create policy tenant_boundary on <t> as restrictive for all
       to construct_runtime, construct_owner
       using      (id_tenant = (select app_private.current_tenant_id()))
       with check (id_tenant = (select app_private.current_tenant_id()));
     create policy tenant_access on <t> as permissive for all
       to construct_runtime, construct_owner
       using (true) with check (true);
     ```

  5. scrive `(t, 'tenant', null)` in `table_class`.

  I linter che segnalano `using (true)` su una policy permissiva (per esempio gli avvisi 0006 e
  0024 di Supabase) vanno accettati come eccezione documentata: il confine lo porta la policy
  restrittiva.
- **`declare_global_table(p_table regclass, p_runtime_writable boolean, p_reason text)`**:
  1. `enable` e `force row level security`;
  2. elimina le policy esistenti;
  3. crea `global_owner … for all to construct_owner using (true) with check (true)`;
  4. crea, per l'app:
     - se scrivibile: `global_access … for all to construct_runtime using (true) with check (true)`;
     - altrimenti: `global_read … for select to construct_runtime using (true)`, e revoca
       `insert, update, delete` a `construct_runtime`;
  5. scrive la classe e il motivo in `table_class`.

**Le applicazioni derivate** usano le stesse due funzioni nelle loro migrazioni.

### 2.3 Tabella `tenant`

```sql
create table public.tenant (
  id bigint generated by default as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.tenant (id, slug, name) values (1, 'default', 'Default');
```

È globale in sola lettura per l'app: il pezzo 5 porterà la console che la scrive. Lo stato
esiste già ma in questo pezzo nessuno lo legge.

### 2.4 Tabelle di tenant: colonne, chiavi e indici

**Regole che il contratto di schema verifica** su ogni tabella di classe `tenant`:

- `id_tenant bigint not null`, chiave esterna verso `tenant(id)`, valore predefinito
  `app_private.current_tenant_id()`;
- RLS attiva e forzata, con le due policy di §2.2;
- almeno un indice, o la chiave primaria, che comincia con `id_tenant`;
- ogni chiave esterna verso un'altra tabella di tenant comprende `id_tenant`.

**Le modifiche, tabella per tabella:**

| Tabella | Modifiche |
|---|---|
| `role` | `id_tenant`; `unique (id_tenant, id_role)`; `system_key text null check (system_key in ('REGISTERED', 'TENANT_ADMIN'))`; indice unico parziale `(id_tenant, system_key) where system_key is not null`. Le righe 0 e 1 ricevono `REGISTERED` e `TENANT_ADMIN`. La riga 2 "Tenant Super Administrator" resta senza `system_key` e senza logica: il pezzo 5 decide il livello di piattaforma |
| `user_role` | `id_tenant`; chiave primaria `(id_tenant, user_id, id_role)`; chiave esterna `(id_tenant, id_role)` → `role (id_tenant, id_role)` on delete cascade; `user_id` → `users` invariata; l'indice `user_role_id_role_user_id_idx` diventa `(id_tenant, id_role, user_id)` |
| `role_permission` | `id_tenant`; chiave primaria `(id_tenant, id_role, id_permission)`; `(id_tenant, id_role)` → `role` on delete cascade; `id_permission` → `permission` invariata |
| `menu_entry` | `id_tenant`; `unique (id_tenant, id_menu_entry)`; padre `(id_tenant, id_parent)` → `menu_entry (id_tenant, id_menu_entry)` on delete cascade, **deferrable initially deferred** come oggi. Con `id_parent` nullo (radice) la chiave non si controlla, come oggi. `menu_entry_parent_order_idx` diventa `(id_tenant, id_parent, order_position)` |
| `menu_entry_tag` | `id_tenant`; chiave primaria `(id_tenant, id_menu_entry, tag_lan, tag)`; `(id_tenant, id_menu_entry)` → `menu_entry` on delete cascade |
| `role_functionality` | `id_tenant`; chiave primaria `(id_tenant, id_role, id_menu_entry)`; `(id_tenant, id_role)` → `role` e `(id_tenant, id_menu_entry)` → `menu_entry`, entrambe on delete cascade |
| `app_theme` | via la colonna `id boolean` e la sua chiave; chiave primaria `id_tenant`. I permessi restano `select, update` come oggi |

**Ordine dentro la migrazione**, per ogni tabella:

1. `add column id_tenant bigint not null default 1 references public.tenant(id)`: il valore
   fisso riempie le righe esistenti;
2. `alter column id_tenant set default app_private.current_tenant_id()`. Mettere subito questo
   valore predefinito farebbe fallire la migrazione, che non ha contesto;
3. vincoli, chiavi e indici.

Le sequenze `s_id_*` restano globali: gli id sono unici in tutta l'installazione anche se ogni
tabella è divisa per tenant.

**`role_list_view`** resta `security_invoker`. Va ridefinita solo se le colonne cambiano: il
filtro di tenant arriva dalle policy delle tabelle sotto.

### 2.5 Tabelle globali

| Tabella | Classe | Motivo da registrare |
|---|---|---|
| `tenant` | global_read | registro dei tenant; lo scrive la piattaforma (pezzo 5) |
| `role_type`, `functionality_type`, `user_status` | global_read | tabelle di tipo |
| `permission` | global_read | catalogo dei codici dichiarati nel sorgente (0041) |
| `users` | global_write | identità globale (TB-DEC-02) |
| `auth_rate_limit` | global_write | limiti per IP e per account |
| `password_set_tokens` | global_write | **provvisoria**: inviti per tenant nel pezzo 3 |
| `allowed_domains` | global_write | **provvisoria**: diventa `tenant_domain` nel pezzo 3 |
| `app_language`, `translation_key`, `translation_value` | global_write | **provvisorie**: lingue attive e sovrascritture per tenant nel pezzo 2 |

`construct_schema_migration` non è in `public` per l'app: resta dell'utente amministrativo,
revocata all'app come oggi ed esclusa dal registro.

`app_language` ha oggi i permessi completi per l'app. La classe `global_write` li conserva.

### 2.6 Funzioni

- **`replace_menu_entry_tags`**: `security invoker set search_path = ''`, nomi qualificati.
  Inserisce in `menu_entry_tag`, e `id_tenant` arriva dal contesto.
- **`replace_user_roles_guarded`** e **`set_user_status_guarded`** (0003):
  - il ruolo amministratore è quello con `system_key = 'TENANT_ADMIN'` nel tenant corrente, e
    quello sempre presente è `REGISTERED`. Spariscono `id_role = 1` e l'aggiunta fissa del ruolo 0;
  - il conteggio degli amministratori attivi riguarda il tenant corrente: lo filtra la RLS, e la
    funzione lo dichiara anche nella query per leggibilità;
  - lock: `pg_advisory_xact_lock(49374202, app_private.current_tenant_id()::integer)`;
  - **limite noto:** `set_user_status_guarded` cambia lo stato **globale** dell'utente ma verifica
    l'invariante solo nel tenant corrente. Con un solo tenant è corretto. Il pezzo 2 sposta la
    disattivazione per tenant su `tenant_membership` e lascia quella globale alla piattaforma.
- **`apply_role_permission_deltas`** e **`apply_role_functionality_deltas`**: nessuna modifica al
  corpo. `id_tenant` arriva dal contesto, e le chiavi composte rifiutano coppie fra tenant
  diversi.
- **Da eliminare:** `replace_user_roles` (sostituita da `_guarded`) e `trg_role_delete` con
  `role_history`.
- **Nessuna SECURITY DEFINER** resta in `public` o `app_private`.

## 3. Strato dati nell'applicazione

### 3.1 Moduli

| Modulo | Contenuto | Chi lo importa |
|---|---|---|
| `lib/db/client.ts` | istanza postgres.js e Drizzle (oggi in `lib/db.ts`), `prepare: false`, `max` e timeout di oggi | solo `lib/db/tenant-db.ts` |
| `lib/db/tenant-db.ts` (`server-only`) | `withTenant`, `withGlobal`, tipi `TenantTx`, `GlobalTx` | servizi, azioni, route, callback di Auth.js |
| `lib/db/schema.ts` | definizioni Drizzle, con `tenant` e le nuove colonne | chiunque scriva query |
| `lib/tenancy/` | `TenantId` (tipo marchiato), `resolveRequestTenant()`, `getSystemRoleIds(tx)` | guardie, layout, route |

`lib/db.ts` sparisce.

```ts
// lib/db/tenant-db.ts
export async function withTenant<T>(
  tenantId: TenantId,
  fn: (tx: TenantTx) => Promise<T>,
  options?: TransactionOptions,          // isolamento e sola lettura, come oggi
): Promise<T>
// apre la transazione e imposta set_config('app.tenant_id', '<n>', true). Il numero è scritto nel
// testo, solo dopo averlo verificato come intero sicuro e positivo (specifica 2026-10-15,
// MTP-DEC-3): con prepare: false un parametro costerebbe un viaggio in più. Rifiuta id non interi
// o non positivi.

export async function withGlobal<T>(
  fn: (tx: GlobalTx) => Promise<T>,
  options?: TransactionOptions,
): Promise<T>
// transazione senza tenant: una tabella di tenant toccata qui dà 42501.
```

### 3.2 Il tenant della richiesta

- **`resolveRequestTenant(): Promise<TenantId>`** in questo pezzo restituisce sempre il tenant
  predefinito. Lo legge una volta da `tenant` con `withGlobal` (`slug = 'default'`) e lo tiene in
  memoria, perché l'id di un tenant non cambia. Nel pezzo 4 leggerà il token o l'host, e la
  firma non cambierà.
- **`getSystemRoleIds(tx)`** restituisce `{ registered, tenantAdmin }` del tenant della
  transazione, ed è memorizzata per richiesta con `cache()` di React.
- **`Actor`** riceve `tenantId: TenantId`.
- **`resolveUserAuthorization`** e **`resolveActor`** leggono stato (globale) e ruoli (del
  tenant) dentro `withTenant`. `isAdmin` diventa "ha il ruolo `TENANT_ADMIN` del tenant".
- **Il callback `jwt`** di Auth.js chiama `resolveUserAuthorization` come oggi, e la revoca resta
  immediata.
- **Il token** porta ancora `roleIds`, che ora sono id di ruoli del tenant predefinito.

### 3.3 Guardie ed esenzioni

- **`requirePermission`, `requirePagePermission`, `requireAdministrator`,
  `requireAdministratorPage`** mantengono firma e messaggi: risolvono tenant e attore, e
  restituiscono l'attore con `tenantId`. Chi le chiama passa poi `actor.tenantId` a
  `withTenant`.
- **Le esenzioni** di `access-declarations.ts` restano solo dichiarazioni. Il codice che segue
  usa `withGlobal` per le tabelle globali, oppure `resolveRequestTenant()` più `withTenant` per i
  dati di tenant. Per esempio il layout radice legge il tema del tenant prima dell'accesso, e
  `profile-actions` tocca solo `users`, quindi usa `withGlobal`.
- **`guards/permission-declared.test.ts`** resta invariato.

### 3.4 Forma dei servizi

- **Funzioni di query**: ricevono `tx: TenantTx` o `tx: GlobalTx` e non aprono transazioni.
  Esempi: `selectMenuEntries(tx)`, `selectRoleGrants(tx, roleIds)`.
- **Funzioni di caricamento** per pagine e route: ricevono `tenantId` più i parametri, aprono
  `withTenant`, e sono avvolte in `cache()` di React quando lo sono già oggi. Esempio:
  `getSidebarMenu(tenantId, roleIds, locale)`. Il `tenantId` è un numero, quindi una chiave
  stabile per `cache()`.
- **Azioni**: dopo la guardia aprono **una** `withTenant(actor.tenantId, tx => …)` e passano la
  stessa `tx` a tutte le query, così la modifica è atomica.
  - I `db.transaction` di oggi (`auth-invitations.ts`, `roles-actions.ts`,
    `navigation-actions.ts`, `translation-actions.ts`, `translation-service.ts`,
    `language-service.ts`) diventano `withTenant` o `withGlobal` con le stesse opzioni.
  - I lock consultivi restano dentro, invariati.
- **Letture parallele** (`Promise.all` dentro un loader, per esempio in
  `navigation-service.ts:15-23`): dentro una transazione vengono eseguite una dopo l'altra sulla
  stessa connessione. È accettato. Se una misura mostra un costo, il loader si divide in due
  `withTenant` parallele.

Moduli toccati, secondo l'inventario degli accessi dello studio:

- `lib/rbac/*-service.ts`, `*-actions.ts`, `actor.ts`, `auth-roles.ts`, `grant-service.ts`;
- `lib/auth.ts` e i suoi callback, `lib/auth-invitations.ts`, `lib/auth-rate-limit.ts`;
- `lib/i18n/*-service.ts`, `*-actions.ts`;
- `lib/theme-server.ts`, `lib/theme-actions.ts`, `lib/appearance-*.ts`, `lib/profile-actions.ts`,
  `lib/health.ts`;
- le route in `app/api/**`;
- le pagine che interrogano direttamente: `app/(protected)/profile/page.tsx`,
  `app/set-password/page.tsx`.

Nel codice spariscono gli id fissi 0 e 1, sostituiti da `getSystemRoleIds`: `lib/rbac/types.ts`
(`ROLE_REGISTERED`, `ROLE_ADMINISTRATOR`), `lib/auth-policy.ts:19`, `lib/rbac/auth-roles.ts:23`,
`lib/rbac/users-actions.ts:54`, `lib/rbac/grant-guards.ts`.

### 3.5 Cosa impedisce di scavalcare lo strato dati

- **ESLint** (`eslint.config.mjs`), `no-restricted-imports`:
  - `postgres`, `drizzle-orm/postgres-js` e `@/lib/db/client` sono vietati fuori da `lib/db/`;
  - eccezione per i file `*.integration.test.ts`, che preparano i dati con una connessione
    propria dell'utente delle migrazioni, come fa già
    `navigation-actions.integration.test.ts:268`.
- **Test AST in `guards/`:**
  - nessun `as TenantId` né costruzione di `TenantId` fuori da `lib/tenancy/`;
  - nessun import del client fuori da `lib/db/`, come rete di sicurezza se ESLint viene
    disattivato su una riga.

## 4. Test

### 4.1 Contratto di schema e confine dei privilegi

**`schema-contract.integration.test.ts`:**

- il modello Drizzle comprende `tenant`, le nuove colonne e le nuove chiavi;
- `app_private.table_class` contiene **tutte** le tabelle di `public` tranne
  `construct_schema_migration`;
- per ogni tabella `tenant`, le regole di §2.4, più le due policy con i ruoli e le espressioni
  attese;
- per ogni tabella globale, le policy e i permessi della classe dichiarata;
- tutti gli oggetti di `public` e `app_private` appartengono a `construct_owner`, che ha
  `rolbypassrls = false` e `rolcanlogin = false`;
- nessuna funzione con `prosecdef` in `public` o `app_private`, e tutte le viste con
  `security_invoker = true`;
- le verifiche di oggi restano.

**`db.mjs boundary-check`** riceve le stesse sonde su RLS, registro e proprietà, che sono di sola
lettura. Vale la regola già scritta in `db.mjs:258-260`: se ne cambi una, cambia anche l'altra.

### 4.2 Isolamento nel database

Nuovo file `lib/db/tenant-isolation.integration.test.ts`.

**Preparazione** con l'utente delle migrazioni: tenant B, con ruoli di sistema, una voce di menu,
un tema e una concessione. Tutto il resto gira come utente dell'app.

| Caso | Atteso |
|---|---|
| `withTenant(A)`: lettura di ogni tabella di tenant | solo righe di A |
| `withTenant(A)`: `update` e `delete` con id di B | 0 righe |
| `withTenant(A)`: `insert` con `id_tenant = B` | errore di `WITH CHECK` |
| `withTenant(A)`: `user_role` di A che punta a un ruolo di B | errore di chiave esterna |
| `withGlobal`: qualunque tabella di tenant | 42501 |
| `withGlobal`: tabelle globali | funzionano secondo la classe |
| client `max: 1`: transazione con A, poi una senza contesto | la seconda dà 42501, il contesto non è rimasto |
| invariante: togliere l'ultimo `TENANT_ADMIN` di A mentre B ne ha | errore `last_active_administrator` |
| lock: operazioni sull'invariante di A e B in parallelo | nessuna attesa reciproca |
| come `construct_owner` senza contesto | le tabelle di tenant danno 42501 |

### 4.3 Concorrenza attraverso il pooler

Nuovo file `lib/db/tenant-concurrency.integration.test.ts`.

- Centinaia di transazioni `withTenant(A)` e `withTenant(B)` alternate, in parallelo e con
  letture e scritture.
- Girano sia su `TEST_DATABASE_POOLED_URL` (modalità transazione) sia su `TEST_DATABASE_URL`
  (modalità sessione).
- Ogni risposta deve contenere solo righe del tenant atteso.

### 4.4 Test unitari

- `withTenant` scrive il tenant nel testo di `set_config` (non come parametro: MTP-DEC-3 della specifica 2026-10-15, che ha sostituito il parametro) e rifiuta `0`, numeri negativi, `NaN` e non interi.
- `resolveRequestTenant` restituisce il tenant predefinito.
- Le guardie restituiscono l'attore con `tenantId`.
- `buildActor` calcola `isAdmin` da `TENANT_ADMIN`.

### 4.5 Senza cambiamenti

- L'E2E pytest e gli altri test di integrazione passano come sono.
- I test di integrazione restano serializzati, perché condividono il database di test con l'E2E.
- `db.mjs test-apply` applica tutte le migrazioni da zero su un database usa e getta.

## 5. Ordine di rilascio

Ogni passo si rilascia da solo e lascia l'app funzionante. I numeri di migrazione partono da
0044.

- [✅] ID=MTF-1, Severity=High, Complexity=Low, Priority=P0, Estimate=hours, Title=Prova della cessione di proprietà, Fix description=Su un database usa e getta Supabase: creare `construct_owner`, renderne membro l'utente delle migrazioni, concedergli `create` su `public` e sul database, cedergli tabelle, sequenze, funzioni e vista, eseguire una migrazione con `set local role construct_owner` che crea uno schema e una tabella. Se fallisce, si torna a §2.1 prima di proseguire. **Esito (2026-10-14):** riuscita su Supabase 17.6 come `postgres` (non superuser), a due condizioni: il ruolo ha bisogno anche di `usage` su `public`, che la 0002 ha tolto a PUBLIC, altrimenti come `construct_owner` non risolve i nomi (`42501 permission denied for schema public`); e una sequenza legata a una colonna non si cede da sola (`0A000`), segue la sua tabella.
- [✅] ID=MTF-2, Severity=High, Complexity=Low, Priority=P0, Estimate=hours, Title=Migrazione: rischi di oggi, Fix description=`replace_menu_entry_tags` INVOKER con `search_path = ''`; via `user_info`, `role_history`, `trg_role_delete`, `replace_user_roles`; Drizzle e contratto di schema allineati.
- [✅] ID=MTF-3, Severity=High, Complexity=Medium, Priority=P0, Estimate=hours, Title=Migrazione: `construct_owner`, Fix description=Ruolo, proprietà di tutti gli oggetti, permessi predefiniti spostati su `construct_owner`, esecutore di `db.mjs` con `set local role` e `reset role`, `provision-runtime-role` e contratto aggiornati.
- [✅] ID=MTF-4, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=days, Title=Codice: nuovo strato dati, Fix description=`lib/db/client.ts`, `lib/db/tenant-db.ts`, `lib/tenancy/` (con il tenant predefinito come costante finché non esiste la tabella); tutti i servizi, le azioni, le route e i callback con la nuova forma (§3.4); ESLint e test AST. `set_config` viene già chiamato, ma nessuna policy lo legge ancora: comportamento identico.
- [✅] ID=MTF-5, Severity=Critical, Complexity=High, Priority=P0, Estimate=days, Title=Migrazione: schema del tenant, Fix description=`app_private` con funzione, registro e funzioni di supporto; `tenant` con il predefinito; `id_tenant` con l'ordine di §2.4; chiavi composte, chiavi primarie, indici; `system_key`; chiave di `app_theme`; funzioni di 0003 per tenant. Le policy non cambiano ancora.
- [✅] ID=MTF-6, Severity=High, Complexity=Medium, Priority=P0, Estimate=days, Title=Codice: tenant dal contesto, Fix description=`resolveRequestTenant()` legge `tenant`; `Actor.tenantId`; `getSystemRoleIds` al posto degli id 0 e 1; schema Drizzle con le nuove colonne.
- [✅] ID=MTF-7, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=hours, Title=Migrazione: RLS di tenant attiva, Fix description=`protect_tenant_table` sulle tabelle di §2.4 e `declare_global_table` su quelle di §2.5, al posto delle policy `construct_runtime_server_access`. Da qui il confine è attivo. **Si rilascia dopo che MTF-6 è in produzione.**
- [✅] ID=MTF-8, Severity=Critical, Complexity=Medium, Priority=P0, Estimate=days, Title=Test di isolamento, concorrenza e contratto, Fix description=§4.1–4.4, scritti insieme ai passi a cui si riferiscono e completati qui; `boundary-check` esteso.

### 5.1 Vincolo sul rilascio

Il job delle migrazioni gira prima che i pod nuovi sostituiscano i vecchi. Se MTF-6 e MTF-7
arrivassero nello stesso rilascio, i pod vecchi resterebbero per qualche istante senza contesto e
risponderebbero con errori. Per questo **MTF-6 e MTF-7 sono due rilasci distinti**. Lo stesso
vale per MTF-4, che deve precedere MTF-5: dopo MTF-5 la colonna `id_tenant` ha come valore
predefinito una funzione che richiede il contesto.

### 5.2 Errori

- Un 42501 "tenant context missing" è sempre un **errore di programmazione**.
- Arriva come errore 500, scritto nel log con `tenantId` e modulo. Le route rispondono come oggi
  per gli errori imprevisti.
- I test di integrazione e l'E2E sono il punto in cui deve emergere, prima del rilascio.

### 5.3 Ritorno indietro

Il progetto non ha migrazioni all'indietro.

- **MTF-7:** se in produzione emerge un errore, una migrazione di correzione rimette sulle tabelle
  coinvolte una policy permissiva `using (true)` al posto delle due di tenant. Colonne e chiavi
  restano, e l'app con il codice di MTF-6 continua a funzionare.
- **Passi di solo codice:** si torna all'immagine precedente.

## 6. Rischi e verifiche

- [✅] ID=MTF-RISK-1, Severity=High, Complexity=Low, Priority=P0, Estimate=hours, Title=Cessione di proprietà su Supabase, Fix description=Non provata: è MTF-1. Se `postgres` non può cedere la proprietà a `construct_owner` o fare `set role`, va trovata un'alternativa che mantenga MTF-DEC-4 prima di MTF-3. **Chiuso il 2026-10-14** dalla prova di MTF-1: la cessione funziona, con `usage` su `public` in più.
- [✅] ID=MTF-RISK-2, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Costo delle transazioni nel callback `jwt`, Fix description=Il callback gira a ogni richiesta del middleware e ora apre una transazione breve con `set_config`. Misurare la latenza prima e dopo MTF-4 sulle pagine principali; se sale in modo sensibile, unire le letture dell'autorizzazione in una sola query. **Misura del 2026-10-15** (database di sviluppo, server di sviluppo, mediana di 10 caricamenti): il tempo del proxy, dove gira il callback `jwt`, passa da circa 200 a circa 455 ms. **Aperto:** supera di molto la soglia del 20%. **Chiuso il 2026-10-20** dal lavoro sulle prestazioni ([specifica](2026-10-15-multi-tenancy-performance-design.md), MTP-OK-1 e MTP-OK-2): viaggi sul percorso critico di nuovo entro l'obiettivo, tempi dimezzati rispetto al pezzo 1.
- [✅] ID=MTF-RISK-3, Severity=Medium, Complexity=Low, Priority=P1, Estimate=hours, Title=Letture parallele eseguite in serie, Fix description=I loader con `Promise.all` dentro una sola transazione eseguono le query una dopo l'altra. Misurare le pagine con più loader (menu, griglie); dividere in più `withTenant` dove serve. **Misura del 2026-10-15** (stesse condizioni): `/` da 690 a 1635 ms (+137%), `/user-management` da 798 a 2185 ms (+174%), `/functionalities` da 702 a 1723 ms (+145%); il codice della pagina passa da 490–590 a 1240–1780 ms. **Aperto:** la causa principale sono i viaggi di andata e ritorno in più verso il database (inizio e fine della transazione, `set_config`, letture in serie), ciascuno di decine di millisecondi verso Supabase. **Chiuso il 2026-10-20** dal lavoro sulle prestazioni ([specifica](2026-10-15-multi-tenancy-performance-design.md), MTP-OK-1 e MTP-OK-2): viaggi sul percorso critico di nuovo entro l'obiettivo, tempi dimezzati rispetto al pezzo 1.
- [✅] ID=MTF-RISK-4, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Pipelining di postgres.js in modalità transazione, Fix description=Supabase lo indica come fonte di righe sbagliate fuori dalle transazioni. Con ogni query in transazione il rischio è coperto, e il test di §4.3 lo verifica.
- [✅] ID=MTF-RISK-5, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Linter che segnalano `using (true)`, Fix description=Gli avvisi sulla policy permissiva `tenant_access` sono attesi: annotarli come eccezione dove il fornitore lo permette.
