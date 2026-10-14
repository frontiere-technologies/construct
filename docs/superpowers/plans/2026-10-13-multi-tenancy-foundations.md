# Multi-tenancy, pezzo 1: le fondamenta dell'isolamento — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ogni accesso ai dati di Construct passa per un confine di tenant che PostgreSQL fa
rispettare da sé (RLS restrittiva e forzata), con un solo tenant invisibile, così che per chi usa
l'app non cambi niente e da domani aggiungere il secondo tenant non richieda né migrazioni dei
dati né modifiche allo strato dati.

**Architecture:**

- **Database.**
  - Un ruolo `construct_owner` senza BYPASSRLS possiede tutti gli oggetti, e le migrazioni
    lavorano come lui.
  - Lo schema `app_private` contiene:
    - `current_tenant_id()`, che dà errore 42501 se il tenant manca;
    - il registro `table_class`;
    - due funzioni che rendono una tabella "di tenant" o "globale".
  - Le sette tabelle di tenant ricevono `id_tenant` con chiavi esterne composte.
- **Applicazione.** Il codice raggiunge il database solo da `withTenant(tenantId, tx => …)` o
  `withGlobal(tx => …)`, che aprono una transazione e impostano
  `set_config('app.tenant_id', $1, true)`. ESLint e un test AST impediscono ogni altra via.

**Tech Stack:** PostgreSQL 15+ (sviluppo su Supabase 17.6, CI su PostgreSQL vanilla), Drizzle ORM
0.45 con postgres.js 3.4, Next.js 16 (App Router, server actions), Auth.js v5, Vitest, compilatore
TypeScript (guardie AST), pytest + Playwright (E2E).

**Spec:** [`docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md`](../specs/2026-10-13-multi-tenancy-foundations-design.md)
(decisioni MTF-DEC-1…12, §2 database, §3 strato dati, §4 test, §5 ordine). Contesto:

- [studio](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-study.md);
- [cose rimandate](../../input-specs/multi-tenancy/2026-10-13-multi-tenancy-deferred.md).

## Global Constraints

- **PostgreSQL 15 o successivo, qualunque fornitore.**
  - Nessun codice specifico di Supabase.
  - Le revoche ai ruoli `anon` e `authenticated` restano condizionali
    (`if exists (select 1 from pg_roles …)`).
- **Ogni query dell'app sta in una transazione aperta da `withTenant` o `withGlobal`.**
  - `prepare: false` sempre.
  - Il tenant si imposta solo con `select set_config('app.tenant_id', $1, true)`: valore come
    parametro, mai `sql.raw`.
- **Nomi fissi**, da usare esattamente così:
  - **ruoli:** `construct_owner`, `construct_runtime`;
  - **schema e registro:** `app_private`, `app_private.table_class`;
  - **classi:** `tenant`, `global_read`, `global_write`;
  - **`system_key`:** `REGISTERED`, `TENANT_ADMIN`;
  - **policy di tenant:** `tenant_boundary` (restrittiva), `tenant_access` (permissiva);
  - **policy globali:** `global_owner`, `global_access`, `global_read`;
  - **errore:** messaggio `tenant context missing`, codice `42501`;
  - **lock dell'invariante:** `pg_advisory_xact_lock(49374202, id_tenant::integer)`.
- **Migrazioni:**
  - nuove da `0044` a `0047` in `sources/devops/db/migrations/`;
  - dopo ognuna, `node sources/devops/db/db.mjs schema-write`, e `schema-check` deve passare;
  - le migrazioni già applicate non si modificano: hanno un checksum.
- **Un solo tenant in questo pezzo**: `id = 1`, `slug = 'default'`.
- **I test di integrazione restano serializzati.** Non si lanciano mentre gira l'E2E, perché
  condividono il database di test.
- **Lingua:**
  - commenti e messaggi d'errore per l'utente in italiano, come il resto del codice;
  - messaggi di commit in inglese, nello stile `type(scope): …` del repository, chiusi da
    `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Checkbox della specifica.** Quando un passo MTF-x della specifica (§5) è finito e verificato,
  si segna `- [✅]` nella specifica stessa (AGENTS.md).
- **Deviazioni dalla specifica, decise qui:**
  - il pacchetto `server-only` non si aggiunge: lancia un'eccezione se importato sotto Vitest. Il
    confinamento del client lo garantiscono ESLint e il test AST (Task 6);
  - l'eccezione al divieto di importare il driver vale per **tutti** i file di test, non solo per
    `*.integration.test.ts` (§3.5): `lib/i18n/language-service.test.ts` costruisce un Drizzle
    finto con `drizzle-orm/postgres-js`.

## Review Focus

1. **Due caricamenti in parallelo nella stessa pagina, sotto il pooler in modalità transazione.**
   Non devono mai restituire righe dell'altro tenant. → test di concorrenza, Task 11.
2. **Una migrazione futura che scrive in una tabella di tenant senza dichiarare il tenant.** Deve
   fallire con 42501, non scrivere nel tenant sbagliato. → caso "proprietario senza contesto",
   Task 10.
3. **Un `tenantId` non valido arrivato da codice sbagliato** (`0`, negativo, `NaN`, decimale).
   `withTenant` deve rifiutarlo prima di parlare col database, invece di produrre un errore di
   conversione dentro Postgres. → test unitari, Task 4.
4. **Pagine anonime prima dell'accesso** (login con il tema dell'app, dizionario delle traduzioni).
   Devono continuare a funzionare: leggono dati di tenant senza utente. → verifica nel browser e
   E2E `test_auth`, Task 5b e Task 9.
5. **Cancellazione di un utente** (`db.mjs test-delete-user`, cascata su `user_role`). La cascata
   deve funzionare anche con la RLS forzata, perché le azioni referenziali non passano dalle
   policy. → caso dedicato, Task 10.

---

## Mappa dei file

| File | Responsabilità | Task |
|---|---|---|
| `sources/devops/db/migrations/0044_tenancy_risk_cleanup.sql` | `replace_menu_entry_tags` INVOKER; via `role_history`, `user_info`, `replace_user_roles` | 2 |
| `sources/devops/db/migrations/0045_construct_owner.sql` | ruolo proprietario, cessione della proprietà, permessi predefiniti | 3 |
| `sources/devops/db/migrations/0046_tenant_schema.sql` | `app_private`, `tenant`, `id_tenant`, chiavi composte, `system_key`, funzioni 0003 per tenant | 7 |
| `sources/devops/db/migrations/0047_tenant_rls.sql` | attiva la RLS di tenant e classifica le globali | 9 |
| `sources/devops/db/db.mjs` | esecutore delle migrazioni come `construct_owner`; tenant predefinito nei comandi di test; sonde di `boundary-check` | 3, 7, 9 |
| `web-construct/lib/db/client.ts` | crea client postgres.js e Drizzle; unico punto che li costruisce | 4 |
| `web-construct/lib/db/tenant-db.ts` | `withTenant`, `withGlobal`, tipi `TenantTx`, `GlobalTx`, `AnyTx` | 4 |
| `web-construct/lib/db/testing.ts` | aiuti per i test di integrazione: `withOwner` | 4, 9 |
| `web-construct/lib/tenancy/tenant-id.ts` | tipo `TenantId`, `toTenantId` | 4 |
| `web-construct/lib/tenancy/request-tenant.ts` | `resolveRequestTenant()` | 4, 8 |
| `web-construct/lib/tenancy/system-roles.ts` | `getSystemRoleIds(tx)` | 8 |
| `web-construct/lib/tenancy/testing.ts` | `defaultTestTenant()`, `tenantIdForTest(id)` per i test | 4 |
| `web-construct/lib/db.ts` | rimosso | 6 |
| `web-construct/lib/db/schema.ts` | tabella `tenant`, colonne e chiavi di tenant; via `roleHistory`, `userInfo` | 2, 7 |
| `web-construct/eslint.config.mjs` | divieto di importare driver e client fuori da `lib/db/` | 6 |
| `web-construct/guards/tenant-boundary.test.ts` | guardia AST su `TenantId` e sul client | 6 |
| `web-construct/lib/schema-contract.integration.test.ts` | proprietà, SECURITY DEFINER, registro, policy | 2, 3, 9 |
| `web-construct/lib/db/tenant-isolation.integration.test.ts` | isolamento nel database | 10 |
| `web-construct/lib/db/tenant-concurrency.integration.test.ts` | isolamento sotto concorrenza | 11 |
| `web-construct/vitest.integration.config.ts` | carica `TEST_MIGRATION_DATABASE_URL` da `operator.env` | 4 |
| `.github/workflows/quality.yml` | nessuna modifica: il seme passa da `db.mjs test-query`, che imposta il tenant | — |

`web-construct/` sta per `sources/microservices/web-construct/`.

---

### Task 1: Prova della cessione di proprietà (MTF-1)

È una prova, non codice da tenere. Risponde a una domanda sola: su Supabase l'utente delle
migrazioni può creare `construct_owner`, cedergli la proprietà degli oggetti e lavorare come lui?

**Files:** nessuno nel repository. Gli script stanno nella cartella scratchpad della sessione.

- [✅] **Step 1: Ricreare da zero il database usa e getta.** Serve un database con tutte le
  migrazioni applicate. Lanciare dalla radice del repository:

```bash
set -a && . ./sources/devops/db/operator.env && set +a && TEST_DATABASE_DISPOSABLE=1 node sources/devops/db/db.mjs test-apply
```

Atteso: `applied migration(s): …` oppure `database schema is up to date`.

- [✅] **Step 2: Eseguire la prova sul database usa e getta, come utente delle migrazioni.**

```bash
set -a && . ./sources/devops/db/operator.env && set +a && DATABASE_URL="$TEST_MIGRATION_DATABASE_URL" node sources/devops/db/db.mjs query "
begin;
create role construct_owner_probe nologin nobypassrls nocreatedb nocreaterole;
grant construct_owner_probe to current_user;
grant create on schema public to construct_owner_probe;
do \$\$ begin execute format('grant create on database %I to construct_owner_probe', current_database()); end \$\$;
alter table public.app_theme owner to construct_owner_probe;
alter sequence public.s_id_role owner to construct_owner_probe;
alter function public.set_updated_at() owner to construct_owner_probe;
set local role construct_owner_probe;
create schema probe_private;
create table public.probe_tenant_check (id int);
alter table public.app_theme add column probe_col int;
reset role;
select c.relname, r.rolname from pg_class c join pg_roles r on r.oid = c.relowner where c.relname in ('app_theme','probe_tenant_check','s_id_role');
rollback;
"
```

Atteso: la tabella finale elenca le tre relazioni con proprietario `construct_owner_probe`, e
nessun `ERROR`. Il `rollback` lascia il database com'era.

- [✅] **Step 3: Decidere.**
  - **Se la prova passa**, proseguire con il Task 2.
  - **Se fallisce**, fermarsi e riportare l'errore esatto al proprietario del progetto: va rivista
    la §2.1 della specifica (MTF-RISK-1) prima di qualunque altro task.

- [✅] **Step 4: Segnare MTF-1 e MTF-RISK-1** come `- [✅]` nella specifica e committare.

```bash
git add docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md
git commit -m "docs(multi-tenancy): ownership transfer to construct_owner works on Supabase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migrazione 0044, i rischi di oggi (MTF-2)

**Files:**
- Create: `sources/devops/db/migrations/0044_tenancy_risk_cleanup.sql`
- Modify: `web-construct/lib/db/schema.ts` (togliere `roleHistory` e `userInfo`)
- Modify: `web-construct/lib/schema-contract.integration.test.ts` (nuovo test)
- Modify: `sources/devops/db/schema.sql` (rigenerato)

**Interfaces:**
- Consumes: niente.
- Produces: in `public` non resta nessuna funzione SECURITY DEFINER; spariscono `role_history`,
  `user_info`, `trg_role_delete`, `replace_user_roles`.

- [✅] **Step 1: Scrivere il test che fallisce.** In `lib/schema-contract.integration.test.ts`,
  aggiungere dentro `describeIntegration('database runtime boundary', …)`, dopo
  `uses an invoker-rights view…`:

```ts
  it('runs every function in public with the caller rights', async () => {
    const definers = await db.execute<{ name: string }>(sql`
      select p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by p.proname
    `)
    expect(definers.map(row => row.name)).toEqual([])
  })
```

- [✅] **Step 2: Verificare che fallisca.**

Run: `cd sources/microservices/web-construct && npm run test:integration -- lib/schema-contract.integration.test.ts`
Expected: FAIL, `expected [ 'replace_menu_entry_tags' ] to deeply equal []`.

- [✅] **Step 3: Scrivere la migrazione** `0044_tenancy_risk_cleanup.sql`:

```sql
-- Multi-tenancy, pezzo 1 (specifica 2026-10-13, MTF-2): via i rischi di oggi prima di
-- introdurre il confine di tenant.

-- L'unica funzione che girava con i permessi del proprietario: con la RLS di tenant avrebbe
-- scavalcato qualunque policy, e il search_path=public la esponeva a oggetti omonimi.
create or replace function public.replace_menu_entry_tags(p_id_menu_entry bigint, p_tags jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.menu_entry_tag where id_menu_entry = p_id_menu_entry;
  insert into public.menu_entry_tag (id_menu_entry, tag_lan, tag)
    select p_id_menu_entry, elem->>'tag_lan', elem->>'tag'
    from pg_catalog.jsonb_array_elements(p_tags) as elem
    on conflict do nothing;
end;
$$;
revoke all on function public.replace_menu_entry_tags(bigint, jsonb) from public;
grant execute on function public.replace_menu_entry_tags(bigint, jsonb) to construct_runtime;

-- Scritta da un trigger a ogni cancellazione di ruolo e mai letta da nessuno (MTF-DEC-9).
drop trigger if exists trigger_role_delete on public.role;
drop function if exists public.trg_role_delete();
drop table if exists public.role_history;

-- Non usata dal codice.
drop table if exists public.user_info;

-- Sostituita da replace_user_roles_guarded (0003).
drop function if exists public.replace_user_roles(uuid, bigint[]);
```

- [✅] **Step 4: Allineare Drizzle.**
  - In `lib/db/schema.ts`, cancellare le dichiarazioni `export const roleHistory = …` e
    `export const userInfo = …` con il loro blocco.
  - Verificare che nessun altro file le usi:

Run: `cd sources/microservices/web-construct && grep -rn "roleHistory\|userInfo\|replace_user_roles(" app lib components | grep -v guarded`
Expected: nessuna riga.

- [✅] **Step 5: Applicare e rigenerare lo snapshot.**

```bash
set -a && . ./sources/devops/db/operator.env && set +a && TEST_DATABASE_DISPOSABLE=1 node sources/devops/db/db.mjs test-apply
node sources/devops/db/db.mjs schema-write
node sources/devops/db/db.mjs schema-check
```

Expected: `applied migration(s): 0044`, poi `schema.sql matches ordered migrations`.

- [✅] **Step 6: Verificare che il contratto passi.**

Run: `cd sources/microservices/web-construct && npm run test:integration -- lib/schema-contract.integration.test.ts`
Expected: PASS, compreso il confronto fra catalogo e modello Drizzle senza le due tabelle.

- [✅] **Step 7: Lanciare tutta la suite di integrazione e quella unitaria.**

Run: `cd sources/microservices/web-construct && npm run test && npm run test:integration`
Expected: PASS.

- [✅] **Step 8: Commit e checkbox.** Segnare MTF-2 come `- [✅]` nella specifica.

```bash
git add sources/devops/db/migrations/0044_tenancy_risk_cleanup.sql sources/devops/db/schema.sql \
  sources/microservices/web-construct/lib/db/schema.ts \
  sources/microservices/web-construct/lib/schema-contract.integration.test.ts \
  docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md
git commit -m "fix(db): no function runs with owner rights, and unused tables are gone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migrazione 0045, `construct_owner` (MTF-3)

**Files:**
- Create: `sources/devops/db/migrations/0045_construct_owner.sql`
- Modify: `sources/devops/db/db.mjs` (`migrationAdapter.runInTransaction`, `boundaryCheck`)
- Modify: `web-construct/lib/schema-contract.integration.test.ts`
- Modify: `README.md` (sezione Local setup, vicino a `db.mjs apply`)
- Modify: `sources/devops/db/schema.sql`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - tutti gli oggetti di `public` (tranne `construct_schema_migration`) appartengono a
    `construct_owner`;
  - dalla migrazione 0046 in poi, ogni migrazione gira come `construct_owner`.

- [✅] **Step 1: Scrivere il test che fallisce.** In `schema-contract.integration.test.ts`,
  aggiungere:

```ts
  it('lets construct_owner, and only it, own the application objects', async () => {
    const [owner] = await db.execute<{ rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean }>(sql`
      select rolcanlogin, rolbypassrls, rolsuper from pg_roles where rolname = 'construct_owner'
    `)
    expect(owner).toEqual({ rolcanlogin: false, rolbypassrls: false, rolsuper: false })

    const strays = await db.execute<{ name: string; owner: string }>(sql`
      select c.relname as name, r.rolname as owner
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_roles r on r.oid = c.relowner
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'S')
        and c.relname <> 'construct_schema_migration'
        and r.rolname <> 'construct_owner'
        and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      union all
      select p.proname, r.rolname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
      where n.nspname = 'public' and r.rolname <> 'construct_owner'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by 1
    `)
    expect(strays).toEqual([])
  })
```

- [✅] **Step 2: Verificare che fallisca.**

Run: `npm run test:integration -- lib/schema-contract.integration.test.ts`
Expected: FAIL, `owner` è `undefined` perché il ruolo non esiste.

- [✅] **Step 3: Scrivere la migrazione** `0045_construct_owner.sql`:

```sql
-- Multi-tenancy, pezzo 1 (specifica 2026-10-13, §2.1, MTF-DEC-4): un proprietario senza
-- BYPASSRLS, così che la RLS forzata valga anche per le migrazioni, su ogni PostgreSQL.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'construct_owner') then
    create role construct_owner nologin;
  end if;
  alter role construct_owner nologin nocreatedb nocreaterole noreplication nobypassrls;
end
$$;

-- L'utente delle migrazioni diventa membro: dalla prossima migrazione l'esecutore fa
-- `set local role construct_owner`.
grant construct_owner to current_user;

-- Permessi di creazione, non attributi del ruolo: servono per creare tabelle in public (0002
-- l'ha chiuso a PUBLIC) e per creare lo schema app_private (0046). Anche usage: 0002 l'ha tolto a
-- PUBLIC, e senza di esso come construct_owner nessun nome di public si risolve (prova di MTF-1).
grant usage, create on schema public to construct_owner;
do $$
begin
  execute format('grant create on database %I to construct_owner', current_database());
end
$$;

-- Cessione della proprietà. Prima tabelle e viste: le sequenze legate a una tabella la seguono da
-- sole. Poi le sequenze rimaste, poi le funzioni. Gli oggetti delle estensioni restano a chi li ha.
do $$
declare
  object record;
begin
  for object in
    select c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
      and c.relname <> 'construct_schema_migration'
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    if object.relkind = 'v' then
      execute format('alter view public.%I owner to construct_owner', object.relname);
    else
      execute format('alter table public.%I owner to construct_owner', object.relname);
    end if;
  end loop;

  for object in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and c.relowner <> 'construct_owner'::regrole
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    execute format('alter sequence public.%I owner to construct_owner', object.relname);
  end loop;

  for object in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s owner to construct_owner', object.signature);
  end loop;
end
$$;

-- Gli oggetti futuri nascono già aperti all'app e chiusi a PUBLIC (prima lo faceva 0002 per il
-- proprietario di allora).
alter default privileges for role construct_owner in schema public
  grant select, insert, update, delete on tables to construct_runtime;
alter default privileges for role construct_owner in schema public
  grant usage, select on sequences to construct_runtime;
alter default privileges for role construct_owner
  revoke execute on functions from public;
```

- [✅] **Step 4: Far girare le migrazioni come `construct_owner`.** In `sources/devops/db/db.mjs`,
  sostituire `runInTransaction` dentro `migrationAdapter`:

```js
    async runInTransaction(migration) {
      await sql`begin`
      try {
        // Dalla 0045 in poi ogni migrazione lavora come construct_owner, che possiede gli oggetti e
        // non ha BYPASSRLS: la RLS forzata vale anche qui (specifica 2026-10-13, §2.1). La 0045
        // stessa gira ancora come utente delle migrazioni, perché il ruolo non esiste ancora.
        const [{ ownerExists }] = await sql`
          select exists (select 1 from pg_roles where rolname = 'construct_owner') as "ownerExists"
        `
        if (ownerExists) await sql`set local role construct_owner`
        await sql.unsafe(migration.sql).simple()
        // La cronologia resta dell'utente delle migrazioni, non del proprietario.
        await sql`reset role`
        await sql`
          update public.construct_schema_migration
          set completed_at = clock_timestamp()
          where version = ${migration.version}
        `
        await sql`commit`
      } catch (error) {
        await sql`rollback`
        throw error
      }
    },
```

- [✅] **Step 5: Aggiungere la sonda a `boundary-check`.** In `db.mjs`, dentro `boundaryCheck()`,
  prima di `} finally {`. Lo stesso controllo è nel contratto: vale la regola "se ne cambi una,
  cambia anche l'altra".

```js
    const [ownerRole] = await sql`
      select rolbypassrls, rolcanlogin from pg_roles where rolname = 'construct_owner'
    `
    report(
      'construct_owner exists without BYPASSRLS and without login',
      Boolean(ownerRole) && !ownerRole.rolbypassrls && !ownerRole.rolcanlogin,
    )
    const strays = await sql`
      select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'S')
        and c.relname <> 'construct_schema_migration'
        and c.relowner <> 'construct_owner'::regrole
        and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    `
    report('construct_owner owns every application relation', !strays.length, strays.map(row => row.name).join(', '))
```

- [✅] **Step 6: Applicare, rigenerare, verificare.**

```bash
set -a && . ./sources/devops/db/operator.env && set +a && TEST_DATABASE_DISPOSABLE=1 node sources/devops/db/db.mjs test-apply
node sources/devops/db/db.mjs schema-write && node sources/devops/db/db.mjs schema-check
cd sources/microservices/web-construct && npm run test:integration
```

Expected: `applied migration(s): 0045`, schema aggiornato, integrazione PASS (compreso il nuovo
test).

- [✅] **Step 7: Verificare che una migrazione successiva giri come `construct_owner`.** Creare
  temporaneamente `0045a_probe.sql` con `create table public.zz_owner_probe (id int);`, applicarla,
  controllare il proprietario, poi rimuovere tabella e file. La riga di cronologia `0045a` resta
  sul database usa e getta: va cancellata a mano.

```bash
printf 'create table public.zz_owner_probe (id int);\n' > sources/devops/db/migrations/0045a_probe.sql
set -a && . ./sources/devops/db/operator.env && set +a && TEST_DATABASE_DISPOSABLE=1 node sources/devops/db/db.mjs test-apply
DATABASE_URL="$TEST_MIGRATION_DATABASE_URL" node sources/devops/db/db.mjs query "select r.rolname from pg_class c join pg_roles r on r.oid=c.relowner where c.relname='zz_owner_probe'; drop table public.zz_owner_probe; delete from public.construct_schema_migration where version='0045a';"
rm sources/devops/db/migrations/0045a_probe.sql
```

Expected: `construct_owner`.

- [✅] **Step 8: Documentare.** In `README.md`, subito dopo il blocco che mostra
  `node sources/devops/db/db.mjs apply` e `provision-runtime-role`, aggiungere:

```markdown
Dalla migrazione `0045` gli oggetti del database appartengono al ruolo `construct_owner` (senza
login e senza BYPASSRLS), e `db.mjs apply` esegue ogni migrazione successiva con
`set local role construct_owner`. L'utente di `MIGRATION_DATABASE_URL` ne diventa membro con la
`0045` stessa. Se in un ambiente le migrazioni le esegue un utente diverso da quello che ha
applicato la `0045`, va concesso a mano: `grant construct_owner to <utente>;`.
```

- [✅] **Step 9: Commit e checkbox.** Segnare MTF-3 come `- [✅]`.

```bash
git add sources/devops/db/migrations/0045_construct_owner.sql sources/devops/db/schema.sql \
  sources/devops/db/db.mjs README.md \
  sources/microservices/web-construct/lib/schema-contract.integration.test.ts \
  docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md
git commit -m "feat(db): construct_owner owns the schema and migrations run as it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Strato dati: `withTenant`, `withGlobal`, `TenantId` (prima parte di MTF-4)

**Files:**
- Create: `web-construct/lib/tenancy/tenant-id.ts`
- Create: `web-construct/lib/tenancy/request-tenant.ts`
- Create: `web-construct/lib/tenancy/testing.ts`
- Create: `web-construct/lib/db/client.ts`
- Create: `web-construct/lib/db/tenant-db.ts`
- Create: `web-construct/lib/db/tenant-db.test.ts`
- Create: `web-construct/lib/tenancy/tenant-id.test.ts`
- Create: `web-construct/lib/db/testing.ts`
- Modify: `web-construct/lib/db.ts` (diventa una riesportazione transitoria)
- Modify: `web-construct/vitest.integration.config.ts`

**Interfaces:**
- Consumes: niente dal codice; il database del Task 3.
- Produces (usati da tutti i task successivi):

```ts
// lib/tenancy/tenant-id.ts
export type TenantId = number & { readonly __brand: 'TenantId' }
export function toTenantId(value: number): TenantId          // lancia se non è un intero sicuro > 0
export const DEFAULT_TENANT_SLUG = 'default'

// lib/tenancy/request-tenant.ts
export const resolveRequestTenant: () => Promise<TenantId>   // React cache(); Task 4: sempre 1, Task 8: letto da `tenant`

// lib/tenancy/testing.ts (solo test)
export function defaultTestTenant(): TenantId
export function tenantIdForTest(id: number): TenantId

// lib/db/client.ts
export type Database = PostgresJsDatabase<typeof schema>
export function createDatabase(url: string, options?: { max?: number }): { database: Database; close: () => Promise<void> }
export const db: Database                                    // l'istanza dell'app

// lib/db/tenant-db.ts
export type TenantTx  = Tx & { readonly __txBrand: 'TenantTx' }
export type GlobalTx  = Tx & { readonly __txBrand: 'GlobalTx' }
export type AnyTx     = TenantTx | GlobalTx
export type TransactionOptions = PgTransactionConfig          // da drizzle-orm/pg-core
export function createTenantAccess(database: Database): {
  withTenant<T>(tenantId: TenantId, fn: (tx: TenantTx) => Promise<T>, options?: TransactionOptions): Promise<T>
  withGlobal<T>(fn: (tx: GlobalTx) => Promise<T>, options?: TransactionOptions): Promise<T>
}
export const withTenant: …   // createTenantAccess(db).withTenant
export const withGlobal: …   // createTenantAccess(db).withGlobal

// lib/db/testing.ts (solo test di integrazione)
export async function withOwner<T>(fn: (tx: OwnerTx) => Promise<T>, tenantId?: TenantId): Promise<T>
export async function closeOwner(): Promise<void>
```

- [✅] **Step 1: Test unitari di `TenantId`.** Creare `lib/tenancy/tenant-id.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toTenantId } from './tenant-id'

describe('toTenantId', () => {
  it('accepts a positive safe integer', () => {
    expect(toTenantId(1)).toBe(1)
    expect(toTenantId(42)).toBe(42)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects %s before it reaches the database',
    value => {
      expect(() => toTenantId(value)).toThrow('invalid tenant id')
    },
  )
})
```

- [✅] **Step 2: Test unitari di `withTenant` e `withGlobal`.** Creare `lib/db/tenant-db.test.ts`.
  Usano un database finto: `createTenantAccess` riceve qualunque oggetto con `transaction`.

```ts
import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { toTenantId } from '@/lib/tenancy/tenant-id'
import type { Database } from './client'
import { createTenantAccess } from './tenant-db'

function fakeDatabase() {
  const executed: SQL[] = []
  const configs: unknown[] = []
  const tx = { execute: async (query: SQL) => { executed.push(query); return [] } }
  const database = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>, config?: unknown) => {
      configs.push(config)
      return fn(tx)
    },
  } as unknown as Database
  return { database, executed, configs }
}

const dialect = new PgDialect()

describe('withTenant', () => {
  it('sets the tenant as a transaction-local parameter before running the callback', async () => {
    const { database, executed } = fakeDatabase()
    const { withTenant } = createTenantAccess(database)
    const result = await withTenant(toTenantId(7), async () => 'done')
    expect(result).toBe('done')
    expect(executed).toHaveLength(1)
    const rendered = dialect.sqlToQuery(executed[0])
    expect(rendered.sql).toBe("select set_config('app.tenant_id', $1, true)")
    expect(rendered.params).toEqual(['7'])
  })

  it('passes the transaction options through unchanged', async () => {
    const { database, configs } = fakeDatabase()
    const { withTenant } = createTenantAccess(database)
    await withTenant(toTenantId(1), async () => null, { isolationLevel: 'repeatable read', accessMode: 'read only' })
    expect(configs).toEqual([{ isolationLevel: 'repeatable read', accessMode: 'read only' }])
  })

  it('refuses a tenant id that was not built by toTenantId', async () => {
    const { database, executed } = fakeDatabase()
    const { withTenant } = createTenantAccess(database)
    await expect(withTenant(0 as never, async () => null)).rejects.toThrow('invalid tenant id')
    expect(executed).toHaveLength(0)
  })
})

describe('withGlobal', () => {
  it('opens a transaction without setting any tenant', async () => {
    const { database, executed } = fakeDatabase()
    const { withGlobal } = createTenantAccess(database)
    await withGlobal(async () => null)
    expect(executed).toHaveLength(0)
  })
})
```

- [✅] **Step 3: Verificare che falliscano.**

Run: `cd sources/microservices/web-construct && npx vitest run lib/db/tenant-db.test.ts lib/tenancy/tenant-id.test.ts`
Expected: FAIL, `Cannot find module './tenant-db'` e `'./tenant-id'`.

- [✅] **Step 4: Scrivere `lib/tenancy/tenant-id.ts`.**

```ts
/**
 * Un id di tenant che lo strato dati accetta (specifica 2026-10-13, §3.1–3.2). È un numero
 * "marchiato": solo i moduli di lib/tenancy/ lo costruiscono, e guards/tenant-boundary.test.ts
 * impedisce `as TenantId` e `toTenantId` altrove. Così un numero arrivato dalla richiesta non
 * diventa un tenant senza passare da chi ha verificato da dove viene.
 */
export type TenantId = number & { readonly __brand: 'TenantId' }

/** Lo slug del tenant unico di questo pezzo (MTF-DEC-2). */
export const DEFAULT_TENANT_SLUG = 'default'

export function toTenantId(value: number): TenantId {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('invalid tenant id')
  return value as TenantId
}
```

- [✅] **Step 5: Scrivere `lib/tenancy/request-tenant.ts`**, versione del Task 4: il tenant
  predefinito come costante, perché la tabella `tenant` arriva nel Task 7.

```ts
import { cache } from 'react'
import { toTenantId, type TenantId } from './tenant-id'

/**
 * Il tenant della richiesta corrente. In questo pezzo è sempre quello predefinito (MTF-DEC-2):
 * nel pezzo 4 leggerà il token o l'host, e chi lo chiama non dovrà cambiare.
 */
export const resolveRequestTenant = cache(async (): Promise<TenantId> => toTenantId(1))
```

- [✅] **Step 6: Scrivere `lib/tenancy/testing.ts`.**

```ts
import { toTenantId, type TenantId } from './tenant-id'

/** Solo per i test: il tenant predefinito, quello che esiste in ogni database di test. */
export function defaultTestTenant(): TenantId {
  return toTenantId(1)
}

/** Solo per i test: un tenant creato da un fixture (Task 10). */
export function tenantIdForTest(id: number): TenantId {
  return toTenantId(id)
}
```

- [✅] **Step 7: Scrivere `lib/db/client.ts`.** Il contenuto di oggi di `lib/db.ts` diventa una
  fabbrica.

```ts
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { resolveDatabaseUrl } from '@/lib/test-database'
import * as schema from './schema'

export type Database = PostgresJsDatabase<typeof schema>

/**
 * L'unico punto che costruisce un client. Fuori da lib/db/ nessuno importa questo modulo
 * (ESLint e guards/tenant-boundary.test.ts): si passa da withTenant o withGlobal.
 *
 * prepare: false resta sempre, anche in modalità sessione: funziona con entrambe le modalità del
 * pooler, e la modalità la decide l'URL (MTF-DEC-7). max/connect_timeout: vedi la nota storica
 * nel commit che li ha introdotti — il pool di default si saturava e bloccava per 30 secondi.
 */
export function createDatabase(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { prepare: false, max: options.max ?? 20, connect_timeout: 10 })
  return {
    database: drizzle(client, { schema }) as Database,
    close: () => client.end({ timeout: 5 }),
  }
}

/** Un client per la vita del pod, non per richiesta. */
export const db: Database = createDatabase(resolveDatabaseUrl(process.env)).database
```

- [✅] **Step 8: Scrivere `lib/db/tenant-db.ts`.**

```ts
import { sql } from 'drizzle-orm'
import type { PgTransactionConfig } from 'drizzle-orm/pg-core'
import { createLogger } from '@/lib/logger'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { db, type Database } from './client'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Una transazione con il tenant impostato: può toccare tabelle di tenant e globali. */
export type TenantTx = Tx & { readonly __txBrand: 'TenantTx' }
/** Una transazione senza tenant: solo tabelle globali. Una tabella di tenant qui dà 42501. */
export type GlobalTx = Tx & { readonly __txBrand: 'GlobalTx' }
/** Per le query che leggono solo tabelle globali e servono in entrambi i contesti. */
export type AnyTx = TenantTx | GlobalTx
export type TransactionOptions = PgTransactionConfig

const log = createLogger('tenant-db')

function isTenantBoundaryError(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code
    ?? (error as { cause?: { code?: string } })?.cause?.code
  return code === '42501'
}

/**
 * Le due sole porte verso il database (specifica 2026-10-13, §3.1, MTF-DEC-6). Il tenant entra
 * come parametro con set_config(..., true): vale fino alla fine della transazione e mai oltre,
 * quindi una connessione restituita al pooler non porta il tenant al cliente successivo.
 */
export function createTenantAccess(database: Database) {
  async function withTenant<T>(
    tenantId: TenantId,
    fn: (tx: TenantTx) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error('invalid tenant id')
    try {
      return await database.transaction(async tx => {
        await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`)
        return fn(tx as TenantTx)
      }, options)
    } catch (error) {
      // Un 42501 qui è sempre un errore di programmazione, mai di chi usa l'app (§5.2).
      if (isTenantBoundaryError(error)) log.error({ tenantId, err: error }, 'tenant boundary violation')
      throw error
    }
  }

  async function withGlobal<T>(fn: (tx: GlobalTx) => Promise<T>, options?: TransactionOptions): Promise<T> {
    try {
      return await database.transaction(async tx => fn(tx as GlobalTx), options)
    } catch (error) {
      if (isTenantBoundaryError(error)) log.error({ tenantId: null, err: error }, 'tenant table touched without a tenant')
      throw error
    }
  }

  return { withTenant, withGlobal }
}

const access = createTenantAccess(db)
export const withTenant = access.withTenant
export const withGlobal = access.withGlobal
```

- [✅] **Step 9: Rendere `lib/db.ts` una riesportazione transitoria.** Viene rimosso nel Task 6,
  quando nessuno lo importa più. Sostituirne il contenuto con:

```ts
// Transitorio (piano 2026-10-13, Task 4 → Task 6): il client vive in lib/db/client.ts e fuori da
// lib/db/ si passa da withTenant/withGlobal. Questo file sparisce quando nessuno lo importa più.
export { db } from './db/client'
```

- [✅] **Step 10: Aiuto per i test che scrivono come proprietario.** Creare `lib/db/testing.ts`.

```ts
import { sql } from 'drizzle-orm'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { createDatabase, type Database } from './client'

type OwnerTx = Parameters<Parameters<Database['transaction']>[0]>[0]

let owner: ReturnType<typeof createDatabase> | null = null

function ownerDatabase(): Database {
  const url = process.env.TEST_MIGRATION_DATABASE_URL
  if (!url) throw new Error('TEST_MIGRATION_DATABASE_URL is required for fixtures written as construct_owner')
  owner ??= createDatabase(url, { max: 1 })
  return owner.database
}

/**
 * Solo per i test di integrazione: scrive come construct_owner, che può modificare i cataloghi
 * globali in sola lettura per l'app (permission, tenant). Con `tenantId` imposta anche il tenant,
 * perché la RLS forzata vale per il proprietario (MTF-DEC-4).
 */
export async function withOwner<T>(fn: (tx: OwnerTx) => Promise<T>, tenantId?: TenantId): Promise<T> {
  return ownerDatabase().transaction(async tx => {
    await tx.execute(sql`set local role construct_owner`)
    if (tenantId !== undefined) {
      await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`)
    }
    return fn(tx)
  })
}

export async function closeOwner(): Promise<void> {
  await owner?.close()
  owner = null
}
```

- [✅] **Step 11: Rendere disponibile `TEST_MIGRATION_DATABASE_URL` ai test di integrazione.**
  - **In CI** è già nell'ambiente del job.
  - **In locale** sta in `sources/devops/db/operator.env`, che non deve finire in
    `.env.test.local`, perché quel file viene caricato in un processo Next.
  - In `vitest.integration.config.ts`, subito dopo il ciclo `for (const [key, value] of
    Object.entries(loadEnv(…)))`, aggiungere:

```ts
// L'identità delle migrazioni del database di test serve a lib/db/testing.ts (withOwner) per i
// fixture che scrivono cataloghi in sola lettura per l'app. Vive in operator.env, non in
// .env.test.local: quel file finisce in un processo Next (vedi db.mjs, testMigrationDatabaseUrl).
// Si legge solo questa variabile: MIGRATION_DATABASE_URL, che sta nello stesso file, non deve
// entrare nel processo dei test.
const operatorEnv = resolve(__dirname, '../../devops/db/operator.env')
if (process.env.TEST_MIGRATION_DATABASE_URL === undefined && existsSync(operatorEnv)) {
  const parsed = parseEnv(readFileSync(operatorEnv, 'utf8'))
  if (parsed.TEST_MIGRATION_DATABASE_URL) process.env.TEST_MIGRATION_DATABASE_URL = parsed.TEST_MIGRATION_DATABASE_URL
}
```

  Poi aggiungere in cima gli import `import { existsSync, readFileSync } from 'node:fs'` e
  `import { parseEnv } from 'node:util'`.

- [✅] **Step 12: Verificare che i test passino.**

Run: `cd sources/microservices/web-construct && npx vitest run lib/db/tenant-db.test.ts lib/tenancy/tenant-id.test.ts && npx tsc --noEmit && npm run test`
Expected: PASS. Nessun errore di tipo: per ora `lib/db.ts` riesporta lo stesso `db`.

- [✅] **Step 13: Commit.**

```bash
git add sources/microservices/web-construct/lib/db sources/microservices/web-construct/lib/tenancy \
  sources/microservices/web-construct/lib/db.ts sources/microservices/web-construct/vitest.integration.config.ts
git commit -m "feat(db): withTenant and withGlobal are the doors to the database

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Regole di conversione per i Task 5a, 5b, 5c

Valgono per ogni file da convertire. Il comportamento non cambia: cambia solo la porta da cui si
passa.

**R1. Che porta usare.**

| Tabelle toccate | Porta |
|---|---|
| almeno una di tenant: `role`, `user_role`, `role_permission`, `menu_entry`, `menu_entry_tag`, `role_functionality`, `app_theme` | `withTenant(tenantId, tx => …)` |
| solo globali: `users`, `password_set_tokens`, `auth_rate_limit`, `allowed_domains`, `app_language`, `translation_key`, `translation_value`, `permission`, `role_type`, `functionality_type`, `user_status` | `withGlobal(tx => …)` |

Una `withTenant` può leggere anche tabelle globali.

**R2. Funzioni di query e funzioni di caricamento.**
- **Query:** una funzione che oggi usa `db` e viene chiamata dentro un'azione riceve `tx` come
  **primo** parametro (`TenantTx`, `GlobalTx` o `AnyTx`) e non apre transazioni.
- **Caricamento:** una funzione chiamata da pagine o route (spesso avvolta in `cache()`) apre la
  propria transazione.
  - Se tocca tabelle di tenant riceve `tenantId: TenantId` come **primo** parametro.
  - Se tocca solo tabelle globali conserva la firma e usa `withGlobal` all'interno.

**R3. Azioni.**
- Dopo la guardia (`const actor = await requirePermission(…)`) si apre **una**
  `withTenant(actor.tenantId, async tx => { … })`, dentro la quale stanno tutte le letture e le
  scritture dell'azione.
- I `db.transaction(async tx => …, options)` di oggi diventano
  `withTenant(actor.tenantId, async tx => …, options)` o `withGlobal(async tx => …, options)`.
- I lock consultivi (`pg_advisory_xact_lock`) restano dentro, invariati.
- `revalidatePath` resta **fuori** dalla transazione, dopo il commit, dove sta oggi.

**R4. Chi chiama.**
- Dopo ogni file, `npx tsc --noEmit` elenca i chiamanti da aggiornare.
- Una pagina con una guardia passa `actor.tenantId`.
- Codice senza attore (layout, route anonime, callback di Auth.js) passa
  `await resolveRequestTenant()`.

**R5. Test.**
- I test di integrazione dell'area che usano `db` direttamente passano a
  `withTenant(defaultTestTenant(), tx => …)` o `withGlobal(tx => …)`.
- Le chiamate a funzioni con la nuova firma ricevono `defaultTestTenant()`.
- Le scritture su `permission` restano per ora come sono: diventano `withOwner` nel Task 9.

**Esempio completo, funzione di caricamento** (`lib/rbac/navigation-service.ts`):

```ts
import { cache } from 'react'
import { asc, eq, inArray } from 'drizzle-orm'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { menuEntry, roleFunctionality } from '@/lib/db/schema'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import type { MenuItem } from '@/types/menu'
import { toMenuEntryRow } from './nav-row-mapper'
import { resolveGrantedFunctionalityIds, mapMenuToSidebar } from './sidebar-adapter'
import { DEFAULT_LOCALE, type Locale, type MenuEntryRow } from './types'

export const getSidebarMenu = cache(async (
  tenantId: TenantId,
  roleIds: number[],
  locale: Locale = DEFAULT_LOCALE,
  fallbackLocale: Locale = DEFAULT_LOCALE,
): Promise<MenuItem[]> => withTenant(tenantId, async tx => {
  // Dentro una transazione le due letture vanno in serie sulla stessa connessione (MTF-RISK-3).
  const entryRows = await tx.select().from(menuEntry).orderBy(asc(menuEntry.orderPosition))
  const grantRows = roleIds.length
    ? await tx
      .select({ id_role: roleFunctionality.idRole, id_menu_entry: roleFunctionality.idMenuEntry })
      .from(roleFunctionality)
      .where(inArray(roleFunctionality.idRole, roleIds))
    : []
  const entries = entryRows.map(toMenuEntryRow)
  const granted = resolveGrantedFunctionalityIds(grantRows, roleIds)
  return mapMenuToSidebar(entries, granted, locale, fallbackLocale)
}))

export async function selectNavigationItemById(tx: TenantTx, idMenuEntry: number): Promise<MenuEntryRow | null> {
  const [row] = await tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, idMenuEntry)).limit(1)
  return row ? toMenuEntryRow(row) : null
}

export async function getNavigationItemById(tenantId: TenantId, idMenuEntry: number): Promise<MenuEntryRow | null> {
  return withTenant(tenantId, tx => selectNavigationItemById(tx, idMenuEntry))
}
```

**Esempio completo, azione con funzione SQL** (`lib/rbac/users-actions.ts`, solo il cuore di
`setUserStatus`):

```ts
export async function setUserStatus(userId: string, status: UserStatusId): Promise<void> {
  const actor = await requirePermission('set-user-status')
  // … validazioni zod e controlli UX invariati …
  try {
    await withTenant(actor.tenantId, tx =>
      tx.execute(sql`select public.set_user_status_guarded(${userId}, ${status})`))
  } catch (error) {
    // gestione invariata: lo stesso controllo isLastAdministratorConflict(error) e lo stesso
    // messaggio che il blocco catch di oggi produce
    throw error
  }
}
```

---

### Task 5a: Convertire RBAC (seconda parte di MTF-4)

**Files (Modify):**
- `web-construct/lib/rbac/`: `actor.ts`, `auth-roles.ts`, `auth-guard.ts`, `grant-service.ts`,
  `functionalities-service.ts`, `navigation-service.ts`, `navigation-actions.ts`,
  `roles-service.ts`, `roles-actions.ts`, `users-service.ts`, `users-actions.ts`;
- `web-construct/app/api/rbac/users-grid/route.ts`, `app/api/rbac/roles-grid/route.ts`;
- `web-construct/app/(protected)/layout.tsx` e le pagine sotto `app/(protected)/` che chiamano i
  caricamenti qui sotto;
- i test: `lib/rbac/actor.integration.test.ts`, `navigation-actions.integration.test.ts`,
  `permission-schema.integration.test.ts`, `roles-actions.integration.test.ts`,
  `users-actions.integration.test.ts`, `users-actions-grants.integration.test.ts`, e i test
  unitari di `lib/rbac` che chiamano le funzioni cambiate.

**Interfaces:**
- Consumes: Task 4 (`withTenant`, `TenantTx`, `TenantId`, `resolveRequestTenant`,
  `defaultTestTenant`).
- Produces:

```ts
// lib/rbac/actor.ts
export interface Actor { userId: string; tenantId: TenantId; roleIds: number[]; isAdmin: boolean; permissions: ReadonlySet<PermissionCode> }
export function buildActor(userId: string, tenantId: TenantId, authorization: {…}, grantedCodes: string[]): Actor | null
export const resolveActor: (tenantId: TenantId, userId: string) => Promise<Actor | null>   // cache()
// lib/rbac/auth-roles.ts
export async function selectUserAuthorization(tx: TenantTx, userId: string, ensureRegisteredRole?: boolean): Promise<{ accountActive: boolean; roleIds: number[]; isAdmin: boolean }>
export async function resolveUserAuthorization(tenantId: TenantId, userId: string, ensureRegisteredRole?: boolean): Promise<…>  // withTenant + selectUserAuthorization
// lib/rbac/auth-guard.ts: firme invariate; currentActor usa resolveRequestTenant()
```

Nuove firme degli altri moduli:

| Modulo | Prima | Dopo |
|---|---|---|
| `grant-service.ts` | `permissionCodesByIds(ids)`, `functionalityIdsForRoles(roleIds)`, `grantsForRoles(roleIds)`, `currentRoleIds(userId)`, `assignableRoleIds(actor, roleIds)`, `grantableItemIds(actor, candidates)` | stesso nome, `tx: TenantTx` come primo parametro |
| `functionalities-service.ts` | `getNavigationSubtree()`, `getNavigationItem(id)`, `getParentList(excludeSubtreeOf?)` | `tenantId` come primo parametro, `withTenant` dentro, `cache()` resta |
| `navigation-service.ts` | `getSidebarMenu(roleIds, …)`, `getNavigationItemById(id)` | come nell'esempio sopra |
| `roles-service.ts` | `listRoles(query)`, `countRoles(query)`, `getAllRoles(roleTypes?)`, `getRole(roleId)`, `getRoleAuthorizationTree(…)` | `tenantId` come primo parametro, `withTenant` dentro, `cache()` resta; `applyFilters` invariata |
| `users-service.ts` | `listUsers(query)`, `countUsers(query)` | `tenantId` come primo parametro, `withTenant` dentro (legge `user_role`) |
| `navigation-actions.ts` | `lockNavigationWrites(tx)` e la chiamata a `replace_menu_entry_tags` usano `db` o il `tx` di oggi | ogni azione: guardia, poi una `withTenant(actor.tenantId, …)` che contiene lock, letture (oggi `:35` legge tutta `menu_entry`), scritture e la chiamata alla funzione dei tag |
| `roles-actions.ts`, `users-actions.ts` | `db.*` e `db.transaction` | R3 |

- [✅] **Step 1: Aggiornare prima i test di `actor`,** perché fissano la nuova firma. In
  `lib/rbac/actor.integration.test.ts`:
  - `readerOf` scrive dentro `withTenant(defaultTestTenant(), async tx => { … })`, con `tx` al
    posto di `db`;
  - `afterEach` fa lo stesso;
  - le chiamate diventano `resolveActor(defaultTestTenant(), userId)`;
  - aggiungere un'asserzione al primo test:

```ts
    expect(actor?.tenantId).toBe(defaultTestTenant())
```

  Nei test unitari che chiamano `buildActor` (`grep -rln "buildActor(" lib`), aggiungere il
  secondo argomento `defaultTestTenant()`.

- [✅] **Step 2: Verificare che falliscano.**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit`
Expected: errori di tipo su `resolveActor` e `buildActor` (numero di argomenti).

- [✅] **Step 3: Convertire `actor.ts`, `auth-roles.ts`, `auth-guard.ts`.**
  - **`actor.ts`:**
    - `Actor` riceve `tenantId`;
    - `buildActor(userId, tenantId, authorization, grantedCodes)` lo copia nel risultato;
    - `resolveActor = cache(async (tenantId, userId) => withTenant(tenantId, async tx => { const
      authorization = await selectUserAuthorization(tx, userId); … }))`.
  - **`auth-roles.ts`:**
    - `selectUserAuthorization(tx, userId, ensureRegisteredRole = false)` contiene il corpo di
      oggi con `tx` al posto di `db`;
    - `resolveUserAuthorization(tenantId, userId, ensureRegisteredRole = false)` è
      `withTenant(tenantId, tx => selectUserAuthorization(tx, userId, ensureRegisteredRole))`.
  - **`auth-guard.ts`:** `currentActor` diventa

```ts
async function currentActor(): Promise<Actor | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null
  return resolveActor(await resolveRequestTenant(), userId)
}
```

- [✅] **Step 4: Convertire gli altri moduli della tabella** secondo R1–R4, un file alla volta,
  lanciando `npx tsc --noEmit` dopo ciascuno e aggiornando i chiamanti che segnala (pagine sotto
  `app/(protected)/`, route `users-grid` e `roles-grid`).
  - **Il layout `app/(protected)/layout.tsx`** non ha un attore: chiama
    `getSidebarMenu(await resolveRequestTenant(), roleIds, …)`.
  - **Le azioni** che chiamano `grant-service` passano il loro `tx`.
  - **Le letture fatte prima della `withTenant`** di un'azione per controlli UX (per esempio
    `users-actions.ts:18`) entrano nella stessa `withTenant`.

- [✅] **Step 5: Convertire i test di integrazione dell'area** secondo R5. Il nome degli aiuti di
  `lib/i18n/test-support/db-fixtures.ts` resta invariato; quel file si converte nel Task 5c.

- [✅] **Step 6: Verificare.**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint && npm run test && npm run test:integration`
Expected: tutto PASS. Nessun test esistente cambia il proprio atteso.

- [ ] **Step 7: Verificare nel browser.** Avviare l'anteprima `web-construct` e accedere come
  amministratore.
  - Controllare che il menu laterale sia completo.
  - Aprire Utenti, Ruoli & Permessi e Funzionalità.
  - Rinominare un ruolo di prova e riportarlo com'era.
  - Spostare una voce di menu e riportarla.

  Atteso: nessun errore in console né nel log del server.

- [✅] **Step 8: Commit.**

```bash
git add sources/microservices/web-construct/lib/rbac sources/microservices/web-construct/app
git commit -m "refactor(rbac): every RBAC read and write runs inside withTenant

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5b: Convertire accesso, account e tema (terza parte di MTF-4)

**Files (Modify):**
- `web-construct/lib/`: `auth.ts`, `auth-invitations.ts`, `auth-rate-limit.ts`,
  `profile-actions.ts`, `appearance-actions.ts`, `appearance-server.ts`, `theme-server.ts`,
  `theme-actions.ts`;
- `web-construct/app/api/`: `admin/send-invite/route.ts`, `auth/change-password/route.ts`,
  `auth/forgot-password/route.ts`, `auth/register/route.ts`, `auth/set-password/route.ts`,
  `health/ready/route.ts`;
- `web-construct/app/`: `(protected)/profile/page.tsx`, `set-password/page.tsx`, `layout.tsx`
  (chiamante di `getAppTheme`);
- i test: `lib/auth-invitations.integration.test.ts`, `lib/auth-security.integration.test.ts`, e
  i test unitari di `theme-actions`, `theme-server`, `appearance`.

**Interfaces:**
- Consumes: Task 4, Task 5a (`resolveUserAuthorization(tenantId, userId, ensure)`).
- Produces:

| Modulo | Porta | Firma nuova |
|---|---|---|
| `auth.ts`, callback `authorize` (credenziali, `:84-125`) | `withGlobal` (solo `users`) | invariata |
| `auth.ts`, provider di test (`:130-152`) | `withGlobal` | invariata |
| `auth.ts`, `signIn` (`:162-178`) e cache dei domini (`:24-39`) | `withGlobal` (`allowed_domains`, `users`) | invariata |
| `auth.ts`, `jwt` (`:179-222`) | upsert di `users` in `withGlobal`; poi `resolveUserAuthorization(await resolveRequestTenant(), userId, true)` | invariata |
| `auth-invitations.ts` | `withGlobal(…)` al posto di `db.transaction` | invariata |
| `auth-rate-limit.ts`, `enforceAuthRateLimit` | `withGlobal(tx => tx.execute(…))` | invariata |
| `profile-actions.ts`, `appearance-actions.ts`, `appearance-server.ts` | `withGlobal` | invariata |
| `theme-server.ts` | `withTenant` | `getAppTheme(tenantId: TenantId)`, `cache()` resta |
| `theme-actions.ts`, `saveAppTheme` | `withTenant(actor.tenantId, …)` | invariata; `returning({ id: appTheme.id })` resta fino al Task 7 |
| route e pagine dell'elenco | `withGlobal` | invariata |

- [✅] **Step 1: Aggiornare i test unitari di `theme-server`** (`lib/theme-server.test.ts`): ogni
  chiamata diventa `getAppTheme(defaultTestTenant())`.

Run: `npx tsc --noEmit`
Expected: FAIL, numero di argomenti di `getAppTheme`.

- [✅] **Step 2: Convertire i moduli della tabella** secondo R1–R4.
  - In `app/layout.tsx` la chiamata diventa `getAppTheme(await resolveRequestTenant())`: è la
    lettura di dati di tenant prima dell'accesso (Review Focus 4).
  - In `health/ready/route.ts` diventa `await withGlobal(tx => tx.execute(sql\`select 1\`))`.

- [✅] **Step 3: Convertire i test di integrazione dell'area** (R5).

- [✅] **Step 4: Verificare.**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint && npm run test && npm run test:integration`
Expected: PASS.

- [ ] **Step 5: Verificare nel browser** (Review Focus 4).
  - Da disconnessi, aprire `/login`: deve mostrare il colore principale dell'app.
  - Accedere con credenziali di test e aprire il profilo; cambiare aspetto (chiaro e scuro) e
    tornare indietro.
  - Come amministratore, aprire Tema, cambiare il colore, salvare, ricaricare e ripristinarlo.
  - Chiamare `GET /api/health/ready`.

  Atteso: tutto funziona come prima e la sonda risponde 200.

- [✅] **Step 6: Commit.**

```bash
git add sources/microservices/web-construct/lib sources/microservices/web-construct/app
git commit -m "refactor(auth): sign-in, accounts and theme reach the database through the new doors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5c: Convertire i18n (quarta parte di MTF-4)

**Files (Modify):**
- `web-construct/lib/i18n/`: `dictionary-service.ts`, `language-service.ts`,
  `language-actions.ts`, `translation-service.ts`, `translation-actions.ts`,
  `user-language-actions.ts`, `server.ts`, `test-support/db-fixtures.ts`;
- i test: `language-actions.integration.test.ts`, `translation-actions.integration.test.ts`,
  `language-service.test.ts`.

**Interfaces:**
- Consumes: Task 4.
- Produces: tutte le tabelle i18n sono globali in questo pezzo (MTF-DEC-12), quindi **nessuna
  firma cambia**. Ogni accesso usa `withGlobal`, con le opzioni di oggi.
  - `translation-service.ts:217` e `language-service.ts:286` tengono `repeatable read` e
    `read only`.
  - `language-actions.ts:137` chiama `set_default_language` dentro `withGlobal`.
  - `translation-actions.ts:154` tiene i savepoint dentro la stessa transazione.
  - `language-service.ts` usa già un tipo `LanguageQueryExecutor` per le query composte: un
    `GlobalTx` lo soddisfa. Il test unitario `language-service.test.ts` costruisce già un
    Drizzle finto con `drizzle-orm/postgres-js` (permesso nei file di test, Task 6): sostituisce
    l'import di `db` da `@/lib/db` con un `vi.mock('@/lib/db/tenant-db', …)` il cui `withGlobal`
    chiama la callback con quel Drizzle finto.

- [✅] **Step 1: Convertire `test-support/db-fixtures.ts`:** `cleanupTestData` usa
  `withGlobal(async tx => { … })`.

- [✅] **Step 2: Convertire i moduli** secondo R1–R4, poi i test dell'area (R5).

- [✅] **Step 3: Verificare.**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint && npm run test && npm run test:integration`
Expected: PASS.

- [ ] **Step 4: Verificare nel browser.**
  - Cambiare lingua dal pannello utente.
  - Aprire Lingue e Traduzioni e modificare una traduzione di prova, poi ripristinarla.
  - Da disconnessi, `GET /api/i18n/dictionary?code=it` e `GET /api/i18n/languages`.

  Atteso: tutto come prima.

- [✅] **Step 5: Commit.**

```bash
git add sources/microservices/web-construct/lib/i18n
git commit -m "refactor(i18n): languages and translations go through withGlobal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Chiudere le altre porte (ultima parte di MTF-4)

**Files:**
- Delete: `web-construct/lib/db.ts`
- Modify: `web-construct/eslint.config.mjs`
- Create: `web-construct/guards/tenant-boundary.test.ts`
- Modify: `web-construct/lib/schema-contract.integration.test.ts` (import del client)

**Interfaces:**
- Consumes: Task 5a, 5b, 5c (nessuno importa più `@/lib/db`).
- Produces: un errore di lint e un test rosso per chiunque raggiunga il database fuori da
  `lib/db/`, o costruisca un `TenantId` fuori da `lib/tenancy/`.

- [✅] **Step 1: Scrivere la guardia** `guards/tenant-boundary.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Il confine dello strato dati (specifica 2026-10-13, §3.5). Due regole, verificate sul sorgente:
 *
 * 1. Solo lib/db/ importa il driver (`postgres`, `drizzle-orm/postgres-js`) o il client
 *    (`@/lib/db/client`). I file di test possono farlo: quelli di integrazione per aprire
 *    connessioni proprie (lock, fixture), quelli unitari per costruire un Drizzle finto.
 * 2. Solo lib/tenancy/ costruisce un TenantId: niente `as TenantId` e niente import di
 *    `toTenantId` altrove.
 *
 * ESLint copre la prima regola mentre si scrive; questa guardia regge anche se qualcuno spegne la
 * regola su una riga.
 */
const ROOT = join(__dirname, '..')
const SOURCE_ROOTS = ['app', 'components', 'context', 'guards', 'lib', 'types']
const DRIVER_MODULES = new Set(['postgres', 'drizzle-orm/postgres-js', '@/lib/db/client', '@/lib/db'])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    if (name === 'node_modules') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

const files = SOURCE_ROOTS.flatMap(root => sourceFiles(join(ROOT, root)))
  .map(path => ({ path: relative(ROOT, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))

function imports(text: string): { module: string; names: string[] }[] {
  const source = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true)
  return source.statements.filter(ts.isImportDeclaration).map(statement => ({
    module: (statement.moduleSpecifier as ts.StringLiteral).text,
    names: statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
      ? statement.importClause.namedBindings.elements.map(element => (element.propertyName ?? element.name).text)
      : [],
  }))
}

function castsToTenantId(text: string): boolean {
  const source = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = false
  const visit = (node: ts.Node) => {
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
      && ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(source) === 'TenantId') found = true
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('tenant boundary', () => {
  it('reaches the database driver and client only from lib/db/', () => {
    const offenders = files
      .filter(file => !file.path.startsWith('lib/db/') && !/\.test\.tsx?$/.test(file.path))
      .filter(file => imports(file.text).some(entry => DRIVER_MODULES.has(entry.module)))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })

  it('builds a TenantId only inside lib/tenancy/', () => {
    const offenders = files
      .filter(file => !file.path.startsWith('lib/tenancy/'))
      .filter(file => castsToTenantId(file.text)
        || imports(file.text).some(entry => entry.module.endsWith('tenancy/tenant-id') && entry.names.includes('toTenantId')))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })
})
```

- [✅] **Step 2: Lanciarla prima di rimuovere `lib/db.ts`.**

Run: `npx vitest run guards/tenant-boundary.test.ts`
Expected:
- **PASS** se i Task 5a–5c hanno convertito tutto;
- **FAIL** con l'elenco dei file che importano ancora `@/lib/db`: vanno convertiti secondo R1–R5
  prima di continuare.

- [✅] **Step 3: Rimuovere `lib/db.ts`** e aggiornare gli ultimi import nei test di integrazione:
  - `schema-contract.integration.test.ts` interroga i cataloghi con `withGlobal(tx => tx.execute(…))`;
  - i test che costruiscono connessioni proprie importano `postgres` direttamente (permesso nei
    `*.integration.test.ts`).

Run: `cd sources/microservices/web-construct && git rm lib/db.ts && npx tsc --noEmit`
Expected: nessun errore.

- [✅] **Step 4: Regola ESLint.**
  - In `eslint.config.mjs`, nel blocco che oggi dichiara `'no-restricted-imports'`, aggiungere a
    `patterns` un secondo elemento e un elenco `paths`.
  - Poi aggiungere in fondo all'array `config` un blocco che toglie la restrizione dove è
    permessa.

```js
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'postgres', message: 'Il driver si usa solo in lib/db/: passa da withTenant o withGlobal (@/lib/db/tenant-db).' },
          { name: 'drizzle-orm/postgres-js', message: 'Il driver si usa solo in lib/db/: passa da withTenant o withGlobal (@/lib/db/tenant-db).' },
          { name: '@/lib/db/client', message: 'Il client si usa solo in lib/db/: passa da withTenant o withGlobal (@/lib/db/tenant-db).' },
        ],
        patterns: [{
          group: ['../*', '../**'],
          message: 'Niente risalita nei percorsi relativi: usa l\'alias @/ fra feature, e i relativi (./) solo dentro lo stesso modulo locale.',
        }],
      }],
```

```js
  {
    // Le eccezioni al divieto sul driver (specifica 2026-10-13, §3.5): lo strato dati stesso, e i
    // file di test (connessioni proprie per lock e fixture, Drizzle finti). La regola sui percorsi
    // relativi resta accesa anche qui.
    files: ['lib/db/**/*.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../*', '../**'],
          message: 'Niente risalita nei percorsi relativi: usa l\'alias @/ fra feature, e i relativi (./) solo dentro lo stesso modulo locale.',
        }],
      }],
    },
  },
```

- [✅] **Step 5: Verificare che la regola morda.** Aggiungere temporaneamente
  `import postgres from 'postgres'` in `lib/health.ts`.

Run: `npx eslint lib/health.ts`
Expected: errore `'postgres' import is restricted …`. Poi togliere la riga.

- [✅] **Step 6: Verificare tutto.**

Run: `cd sources/microservices/web-construct && npm run lint && npm run test && npm run test:integration && npm run build`
Expected: PASS.

- [✅] **Step 7: E2E completo** (con l'integrazione ferma, vedi Global Constraints).

Run: `uv run pytest`
Expected: PASS come prima del Task 4.

- [✅] **Step 8: Commit e checkbox.** Segnare MTF-4 e MTF-OK-5 come `- [✅]`.

```bash
git add -A sources/microservices/web-construct docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md
git commit -m "feat(db): the database is reachable only through withTenant and withGlobal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Rilascio:** questo punto (Task 4–6) va in produzione **prima** del Task 7 (§5.1 della
specifica).

---

### Task 7: Migrazione 0046, lo schema del tenant (MTF-5)

**Files:**
- Create: `sources/devops/db/migrations/0046_tenant_schema.sql`
- Modify: `web-construct/lib/db/schema.ts`
- Modify: `web-construct/lib/theme-actions.ts` (`returning`)
- Modify: `sources/devops/db/db.mjs` (`runDatabaseCommand`: tenant predefinito nei comandi)
- Modify: `sources/devops/db/schema.sql`
- Create: `web-construct/lib/tenancy/tenant-schema.integration.test.ts`

**Interfaces:**
- Consumes: Task 3 (le migrazioni girano come `construct_owner`), Task 6 (ogni query dell'app
  imposta il tenant).
- Produces:
  - `app_private.current_tenant_id()`, `app_private.table_class`,
    `app_private.protect_tenant_table(regclass)`,
    `app_private.declare_global_table(regclass, boolean, text)`;
  - `public.tenant` con la riga `(1, 'default', 'Default')`;
  - `id_tenant` su `role`, `user_role`, `role_permission`, `menu_entry`, `menu_entry_tag`,
    `role_functionality`, `app_theme`;
  - `role.system_key`;
  - Drizzle: `tenant`, colonne `idTenant`, `role.systemKey`; `appTheme.id` sparisce.

- [✅] **Step 1: Scrivere il test che fallisce** `lib/tenancy/tenant-schema.integration.test.ts`:

```ts
import { expect, it } from 'vitest'
import { eq, isNotNull, sql } from 'drizzle-orm'
import { role, tenant } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant } from './testing'

describeIntegration('tenant schema', () => {
  it('holds the default tenant', async () => {
    const rows = await withGlobal(tx => tx.select().from(tenant).where(eq(tenant.slug, 'default')))
    expect(rows.map(row => [row.id, row.status])).toEqual([[1, 'active']])
  })

  it('marks the two system roles of the default tenant by key', async () => {
    const rows = await withTenant(defaultTestTenant(), tx => tx
      .select({ idRole: role.idRole, systemKey: role.systemKey })
      .from(role)
      .where(isNotNull(role.systemKey))
      .orderBy(role.idRole))
    expect(rows).toEqual([{ idRole: 0, systemKey: 'REGISTERED' }, { idRole: 1, systemKey: 'TENANT_ADMIN' }])
  })

  it('stamps new rows with the tenant of the transaction', async () => {
    const stamped = await withTenant(defaultTestTenant(), tx =>
      tx.execute<{ id: string }>(sql`select app_private.current_tenant_id()::text as id`))
    expect(stamped[0].id).toBe('1')
  })

  it('refuses to name a tenant when none is set', async () => {
    await expect(withGlobal(tx => tx.execute(sql`select app_private.current_tenant_id()`)))
      .rejects.toSatisfy((error: { cause?: { code?: string; message?: string } }) =>
        error.cause?.code === '42501' && /tenant context missing/.test(error.cause?.message ?? ''))
  })
})
```

Run: `npm run test:integration -- lib/tenancy/tenant-schema.integration.test.ts`
Expected: FAIL (`tenant` non esportato da `schema.ts`, o relazione inesistente).

- [✅] **Step 2: Scrivere la migrazione** `0046_tenant_schema.sql`:

```sql
-- Multi-tenancy, pezzo 1 (specifica 2026-10-13, §2.2–2.6, MTF-5). Gira come construct_owner.
-- Le policy non cambiano ancora: il confine si accende con la 0047, dopo che il codice che
-- imposta il tenant è in produzione (§5.1).

-- 1. Lo schema privato e il tenant della transazione ------------------------------------------
create schema app_private;
grant usage on schema app_private to construct_runtime;

create function app_private.current_tenant_id() returns bigint
language plpgsql stable parallel safe security invoker set search_path = '' as $$
declare v text := pg_catalog.current_setting('app.tenant_id', true);
begin
  -- Vuoto e non solo NULL: dopo la prima impostazione nella sessione la variabile resta definita
  -- e torna come stringa vuota (studio 2026-10-13, §4.1).
  if v is null or v = '' then
    raise exception 'tenant context missing' using errcode = '42501';
  end if;
  return v::bigint;
end $$;
revoke all on function app_private.current_tenant_id() from public;
grant execute on function app_private.current_tenant_id() to construct_runtime;

-- 2. Il registro della classificazione -------------------------------------------------------
create table app_private.table_class (
  table_name text primary key,
  class text not null check (class in ('tenant', 'global_read', 'global_write')),
  reason text,
  check (class = 'tenant' or reason is not null)
);
grant select on app_private.table_class to construct_runtime;

create function app_private.protect_tenant_table(p_table regclass) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_name text;
  v_attnum smallint;
  v_policy record;
begin
  select c.relname into v_name from pg_catalog.pg_class c where c.oid = p_table;
  select a.attnum into v_attnum from pg_catalog.pg_attribute a
  where a.attrelid = p_table and a.attname = 'id_tenant' and a.attnotnull and not a.attisdropped
    and a.atttypid = 'pg_catalog.int8'::pg_catalog.regtype;
  if v_attnum is null then
    raise exception 'table % has no id_tenant bigint not null', v_name;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint k
    where k.conrelid = p_table and k.contype = 'f'
      and k.confrelid = 'public.tenant'::pg_catalog.regclass and k.conkey = array[v_attnum]
  ) then
    raise exception 'table % has no foreign key from id_tenant to tenant', v_name;
  end if;

  execute pg_catalog.format('alter table %s enable row level security', p_table);
  execute pg_catalog.format('alter table %s force row level security', p_table);
  for v_policy in select p.polname from pg_catalog.pg_policy p where p.polrelid = p_table loop
    execute pg_catalog.format('drop policy %I on %s', v_policy.polname, p_table);
  end loop;
  execute pg_catalog.format(
    'create policy tenant_boundary on %s as restrictive for all to construct_runtime, construct_owner '
    'using (id_tenant = (select app_private.current_tenant_id())) '
    'with check (id_tenant = (select app_private.current_tenant_id()))', p_table);
  execute pg_catalog.format(
    'create policy tenant_access on %s as permissive for all to construct_runtime, construct_owner '
    'using (true) with check (true)', p_table);

  insert into app_private.table_class (table_name, class, reason) values (v_name, 'tenant', null)
  on conflict (table_name) do update set class = excluded.class, reason = excluded.reason;
end $$;

create function app_private.declare_global_table(p_table regclass, p_runtime_writable boolean, p_reason text)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_name text;
  v_policy record;
begin
  if p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'a global table needs a reason';
  end if;
  select c.relname into v_name from pg_catalog.pg_class c where c.oid = p_table;

  execute pg_catalog.format('alter table %s enable row level security', p_table);
  execute pg_catalog.format('alter table %s force row level security', p_table);
  for v_policy in select p.polname from pg_catalog.pg_policy p where p.polrelid = p_table loop
    execute pg_catalog.format('drop policy %I on %s', v_policy.polname, p_table);
  end loop;
  execute pg_catalog.format(
    'create policy global_owner on %s for all to construct_owner using (true) with check (true)', p_table);
  if p_runtime_writable then
    execute pg_catalog.format(
      'create policy global_access on %s for all to construct_runtime using (true) with check (true)', p_table);
  else
    execute pg_catalog.format(
      'create policy global_read on %s for select to construct_runtime using (true)', p_table);
    execute pg_catalog.format('revoke insert, update, delete, truncate on %s from construct_runtime', p_table);
    execute pg_catalog.format('grant select on %s to construct_runtime', p_table);
  end if;

  insert into app_private.table_class (table_name, class, reason)
  values (v_name, case when p_runtime_writable then 'global_write' else 'global_read' end, p_reason)
  on conflict (table_name) do update set class = excluded.class, reason = excluded.reason;
end $$;

revoke all on function app_private.protect_tenant_table(regclass) from public;
revoke all on function app_private.declare_global_table(regclass, boolean, text) from public;

-- 3. I tenant ---------------------------------------------------------------------------------
create sequence public.s_id_tenant;
create table public.tenant (
  id bigint primary key default nextval('public.s_id_tenant'),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter sequence public.s_id_tenant owned by public.tenant.id;
insert into public.tenant (id, slug, name) values (1, 'default', 'Default');
select setval('public.s_id_tenant', 1);
-- Fino alla 0047 come ogni altra tabella di oggi; poi declare_global_table la chiude in lettura.
alter table public.tenant enable row level security;
create policy construct_runtime_server_access on public.tenant
  for all to construct_runtime using (true) with check (true);

-- 4. id_tenant sulle tabelle di tenant --------------------------------------------------------
-- Prima il valore fisso, che riempie le righe esistenti; poi il valore dal contesto. Mettere
-- subito current_tenant_id() farebbe fallire questa migrazione, che non ha contesto (§2.4).
do $$
declare
  t text;
begin
  foreach t in array array['role', 'user_role', 'role_permission', 'menu_entry', 'menu_entry_tag',
                           'role_functionality', 'app_theme'] loop
    execute format('alter table public.%I add column id_tenant bigint not null default 1 references public.tenant(id)', t);
    execute format('alter table public.%I alter column id_tenant set default app_private.current_tenant_id()', t);
  end loop;
end
$$;

-- 5. role: chiave per le chiavi esterne composte, ruoli di sistema per chiave ----------------
alter table public.role add constraint role_tenant_role_key unique (id_tenant, id_role);
alter table public.role add column system_key text check (system_key in ('REGISTERED', 'TENANT_ADMIN'));
create unique index role_tenant_system_key_idx on public.role (id_tenant, system_key) where system_key is not null;
update public.role set system_key = 'REGISTERED' where id_role = 0;
update public.role set system_key = 'TENANT_ADMIN' where id_role = 1;

-- 6. menu_entry -------------------------------------------------------------------------------
alter table public.menu_entry add constraint menu_entry_tenant_entry_key unique (id_tenant, id_menu_entry);
alter table public.menu_entry drop constraint menu_entry_id_parent_fkey;
alter table public.menu_entry add constraint menu_entry_parent_fkey
  foreign key (id_tenant, id_parent) references public.menu_entry (id_tenant, id_menu_entry)
  on delete cascade deferrable initially deferred;
drop index public.menu_entry_parent_order_idx;
create index menu_entry_parent_order_idx on public.menu_entry (id_tenant, id_parent, order_position);

-- 7. user_role --------------------------------------------------------------------------------
alter table public.user_role drop constraint user_role_pkey;
alter table public.user_role add constraint user_role_pkey primary key (id_tenant, user_id, id_role);
alter table public.user_role drop constraint user_role_id_role_fkey;
alter table public.user_role add constraint user_role_role_fkey
  foreign key (id_tenant, id_role) references public.role (id_tenant, id_role) on delete cascade;
drop index public.user_role_id_role_user_id_idx;
create index user_role_id_role_user_id_idx on public.user_role (id_tenant, id_role, user_id);

-- 8. role_permission --------------------------------------------------------------------------
alter table public.role_permission drop constraint role_permission_pkey;
alter table public.role_permission add constraint role_permission_pkey primary key (id_tenant, id_role, id_permission);
alter table public.role_permission drop constraint role_item_id_role_fkey;
alter table public.role_permission add constraint role_permission_role_fkey
  foreign key (id_tenant, id_role) references public.role (id_tenant, id_role) on delete cascade;

-- 9. menu_entry_tag ---------------------------------------------------------------------------
alter table public.menu_entry_tag drop constraint menu_entry_tag_pkey;
alter table public.menu_entry_tag add constraint menu_entry_tag_pkey primary key (id_tenant, id_menu_entry, tag_lan, tag);
alter table public.menu_entry_tag drop constraint menu_entry_tag_id_menu_entry_fkey;
alter table public.menu_entry_tag add constraint menu_entry_tag_entry_fkey
  foreign key (id_tenant, id_menu_entry) references public.menu_entry (id_tenant, id_menu_entry) on delete cascade;

-- 10. role_functionality ----------------------------------------------------------------------
alter table public.role_functionality drop constraint role_functionality_pkey;
alter table public.role_functionality add constraint role_functionality_pkey primary key (id_tenant, id_role, id_menu_entry);
alter table public.role_functionality drop constraint role_functionality_id_role_fkey;
alter table public.role_functionality drop constraint role_functionality_id_menu_entry_fkey;
alter table public.role_functionality add constraint role_functionality_role_fkey
  foreign key (id_tenant, id_role) references public.role (id_tenant, id_role) on delete cascade;
alter table public.role_functionality add constraint role_functionality_entry_fkey
  foreign key (id_tenant, id_menu_entry) references public.menu_entry (id_tenant, id_menu_entry) on delete cascade;

-- 11. app_theme: una riga per tenant ----------------------------------------------------------
alter table public.app_theme drop constraint app_theme_pkey;
alter table public.app_theme drop column id;
alter table public.app_theme add constraint app_theme_pkey primary key (id_tenant);

-- 12. L'invariante "ultimo amministratore" per tenant (§2.6) ----------------------------------
create or replace function public.replace_user_roles_guarded(p_user_id uuid, p_role_ids bigint[])
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_registered bigint;
  v_admin bigint;
  requested_roles bigint[];
begin
  perform pg_catalog.pg_advisory_xact_lock(49374202, v_tenant::integer);
  select r.id_role into v_registered from public.role r where r.id_tenant = v_tenant and r.system_key = 'REGISTERED';
  select r.id_role into v_admin from public.role r where r.id_tenant = v_tenant and r.system_key = 'TENANT_ADMIN';
  if v_registered is null or v_admin is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;
  requested_roles := array(
    select distinct value from unnest(array_append(coalesce(p_role_ids, '{}'::bigint[]), v_registered)) value
  );

  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;
  if exists (
    select 1 from unnest(requested_roles) requested(id_role)
    where not exists (select 1 from public.role r where r.id_tenant = v_tenant and r.id_role = requested.id_role)
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_role';
  end if;

  delete from public.user_role where id_tenant = v_tenant and user_id = p_user_id;
  insert into public.user_role (user_id, id_role) select p_user_id, unnest(requested_roles);

  if not exists (
    select 1 from public.users u join public.user_role ur on ur.user_id = u.id
    where ur.id_tenant = v_tenant and u.id_user_status = 2 and ur.id_role = v_admin
  ) then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;

-- Limite noto (§2.6): lo stato è globale, l'invariante si verifica nel tenant corrente. Il
-- pezzo 2 sposta la disattivazione per tenant su tenant_membership.
create or replace function public.set_user_status_guarded(p_user_id uuid, p_status bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant bigint := app_private.current_tenant_id();
  v_admin bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(49374202, v_tenant::integer);
  if p_status not in (1, 2) then
    raise exception using errcode = 'P0001', message = 'invalid_user_status';
  end if;
  select r.id_role into v_admin from public.role r where r.id_tenant = v_tenant and r.system_key = 'TENANT_ADMIN';
  if v_admin is null then
    raise exception using errcode = 'P0001', message = 'system_roles_missing';
  end if;

  update public.users set id_user_status = p_status, last_status_ts = clock_timestamp() where id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;

  if not exists (
    select 1 from public.users u join public.user_role ur on ur.user_id = u.id
    where ur.id_tenant = v_tenant and u.id_user_status = 2 and ur.id_role = v_admin
  ) then
    raise exception using errcode = 'P0001', message = 'last_active_administrator';
  end if;
end;
$$;
```

- [✅] **Step 3: Allineare Drizzle** (`lib/db/schema.ts`).
  - Aggiungere `foreignKey` all'import da `drizzle-orm/pg-core`.
  - Definire `tenant` prima di `role`.
  - Modificare le tabelle come segue.

```ts
const tenantIdColumn = () => bigint('id_tenant', { mode: 'number' })
  .notNull()
  .default(sql`app_private.current_tenant_id()`)
  .references(() => tenant.id)

/** I tenant (specifica 2026-10-13, §2.3). Globale, in sola lettura per l'app dalla 0047. */
export const tenant = pgTable('tenant', {
  id: bigint('id', { mode: 'number' }).primaryKey().default(sql`nextval('public.s_id_tenant')`),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})
```

  `appTheme`: via la colonna `id`; prima colonna
  `idTenant: bigint('id_tenant', { mode: 'number' }).primaryKey().default(sql\`app_private.current_tenant_id()\`).references(() => tenant.id)`.

  `role`:

```ts
export const role = pgTable('role', {
  idRole: bigint('id_role', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_role')`),
  idTenant: tenantIdColumn(),
  idRoleType: bigint('id_role_type', { mode: 'number' }).references(() => roleType.idRoleType),
  description: text('description').notNull(),
  systemKey: text('system_key', { enum: ['REGISTERED', 'TENANT_ADMIN'] }),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).defaultNow(),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }),
}, (t) => [
  unique('role_tenant_role_key').on(t.idTenant, t.idRole),
  uniqueIndex('role_tenant_system_key_idx').on(t.idTenant, t.systemKey).where(sql`${t.systemKey} is not null`),
])
```

  `userRole`:

```ts
export const userRole = pgTable('user_role', {
  idTenant: tenantIdColumn(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  idRole: bigint('id_role', { mode: 'number' }).notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.idTenant, t.userId, t.idRole] }),
  foreignKey({ name: 'user_role_role_fkey', columns: [t.idTenant, t.idRole], foreignColumns: [role.idTenant, role.idRole] }).onDelete('cascade'),
  index('user_role_id_role_user_id_idx').on(t.idTenant, t.idRole, t.userId),
])
```

  `rolePermission`:

```ts
export const rolePermission = pgTable('role_permission', {
  idTenant: tenantIdColumn(),
  idRole: bigint('id_role', { mode: 'number' }).notNull(),
  idPermission: bigint('id_permission', { mode: 'number' }).notNull().references(() => permission.idPermission, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.idTenant, t.idRole, t.idPermission] }),
  foreignKey({ name: 'role_permission_role_fkey', columns: [t.idTenant, t.idRole], foreignColumns: [role.idTenant, role.idRole] }).onDelete('cascade'),
])
```

  `menuEntry`:
  - aggiungere `idTenant: tenantIdColumn(),` dopo `idMenuEntry`;
  - `idParent` perde `.references(…)`;
  - il callback della tabella diventa:

```ts
}, (t) => [
  unique('menu_entry_tenant_entry_key').on(t.idTenant, t.idMenuEntry),
  // DEFERRABLE INITIALLY DEFERRED nel database (0046): Drizzle non lo esprime, e il contratto
  // confronta solo colonne e azioni.
  foreignKey({ name: 'menu_entry_parent_fkey', columns: [t.idTenant, t.idParent], foreignColumns: [t.idTenant, t.idMenuEntry] }).onDelete('cascade'),
  index('menu_entry_parent_order_idx').on(t.idTenant, t.idParent, t.orderPosition),
])
```

  `menuEntryTag`:

```ts
export const menuEntryTag = pgTable('menu_entry_tag', {
  idTenant: tenantIdColumn(),
  idMenuEntry: bigint('id_menu_entry', { mode: 'number' }).notNull(),
  tagLan: varchar('tag_lan', { length: 5 }).notNull(),
  tag: varchar('tag', { length: 50 }).notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.idTenant, t.idMenuEntry, t.tagLan, t.tag] }),
  foreignKey({ name: 'menu_entry_tag_entry_fkey', columns: [t.idTenant, t.idMenuEntry], foreignColumns: [menuEntry.idTenant, menuEntry.idMenuEntry] }).onDelete('cascade'),
])
```

  `roleFunctionality`:

```ts
export const roleFunctionality = pgTable('role_functionality', {
  idTenant: tenantIdColumn(),
  idRole: bigint('id_role', { mode: 'number' }).notNull(),
  idMenuEntry: bigint('id_menu_entry', { mode: 'number' }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.idTenant, t.idRole, t.idMenuEntry] }),
  foreignKey({ name: 'role_functionality_role_fkey', columns: [t.idTenant, t.idRole], foreignColumns: [role.idTenant, role.idRole] }).onDelete('cascade'),
  foreignKey({ name: 'role_functionality_entry_fkey', columns: [t.idTenant, t.idMenuEntry], foreignColumns: [menuEntry.idTenant, menuEntry.idMenuEntry] }).onDelete('cascade'),
])
```

  Il contratto confronta colonne, indici e chiavi come insiemi, quindi l'ordine delle colonne
  nel modello Drizzle non deve per forza seguire quello del catalogo.

- [✅] **Step 4: `theme-actions.ts`.** `.returning({ id: appTheme.id })` diventa
  `.returning({ idTenant: appTheme.idTenant })`, e il controllo successivo sul numero di righe
  resta invariato.

- [✅] **Step 5: Tenant predefinito nei comandi di `db.mjs`.**
  - In `runDatabaseCommand`, subito dopo la creazione di `sql` e prima di `try {`, aggiungere il
    blocco qui sotto.
  - Il blocco copre `query`, `test-query`, `test-reset-e2e` e `test-delete-user`: il seme della
    CI e gli E2E (`test_permissions.py`, `conftest.py`) scrivono in tabelle di tenant con queste
    connessioni.

```js
  // Dalla 0046 le tabelle di tenant ricevono id_tenant dal contesto, e dalla 0047 lo pretendono.
  // Questi comandi lavorano sempre sul tenant predefinito: è l'unico in questo pezzo (specifica
  // 2026-10-13, MTF-DEC-2). La connessione è dedicata al comando, quindi un set_config di sessione
  // non arriva a nessun altro.
  const [{ hasTenantTable }] = await sql`select to_regclass('public.tenant') is not null as "hasTenantTable"`
  if (hasTenantTable) {
    await sql`select set_config('app.tenant_id', (select id::text from public.tenant where slug = 'default'), false)`
  }
```

- [✅] **Step 6: Applicare, rigenerare, verificare.**

```bash
set -a && . ./sources/devops/db/operator.env && set +a && TEST_DATABASE_DISPOSABLE=1 node sources/devops/db/db.mjs test-apply
node sources/devops/db/db.mjs schema-write && node sources/devops/db/db.mjs schema-check
cd sources/microservices/web-construct && npx tsc --noEmit && npm run test && npm run test:integration
```

Expected:
- `applied migration(s): 0046`;
- integrazione PASS, compresi `tenant-schema` e il contratto con le nuove colonne, chiavi e
  indici;
- i test dell'invariante di `users-actions.integration.test.ts` passano senza modifiche.

- [✅] **Step 7: E2E.**

Run: `uv run pytest`
Expected: PASS. `test_permissions.py` scrive `role` e `user_role` attraverso `db.mjs test-query`,
che ora imposta il tenant.

- [✅] **Step 8: Commit e checkbox.** Segnare MTF-5 come `- [✅]`.

```bash
git add sources/devops/db sources/microservices/web-construct docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md
git commit -m "feat(db): tenant table, id_tenant with composite keys, and system roles by key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Il tenant dal contesto e i ruoli di sistema per chiave (MTF-6)

**Files:**
- Modify: `web-construct/lib/tenancy/request-tenant.ts`
- Create: `web-construct/lib/tenancy/system-roles.ts`
- Modify: `web-construct/lib/auth-policy.ts`, `lib/rbac/auth-roles.ts`, `lib/rbac/actor.ts`,
  `lib/rbac/users-actions.ts`, `lib/rbac/grant-guards.ts`, `lib/rbac/types.ts`
- Modify: `web-construct/components/rbac/users/ManageRolesModal.tsx`, `UsersTableClient.tsx` e la
  pagina della gestione utenti che li monta
- Test: `lib/auth-policy.test.ts` (o il file che oggi testa `evaluateAuthorization`: trovarlo con
  `grep -rln evaluateAuthorization lib`), `lib/tenancy/system-roles.integration.test.ts`

**Interfaces:**
- Consumes: Task 7 (`tenant`, `role.systemKey`).
- Produces:

```ts
// lib/tenancy/system-roles.ts
export interface SystemRoleIds { registered: number; tenantAdmin: number }
export async function getSystemRoleIds(tx: TenantTx): Promise<SystemRoleIds>   // lancia 'system roles missing' se manca una delle due righe
// lib/auth-policy.ts
export function evaluateAuthorization(status: number | null | undefined, roleIds: number[], adminRoleId: number): { accountActive: boolean; roleIds: number[]; isAdmin: boolean }
// lib/rbac/types.ts: ROLE_REGISTERED e ROLE_ADMINISTRATOR rimossi
```

- [✅] **Step 1: Test unitario che fallisce.** Nel file che testa `evaluateAuthorization`,
  sostituire i casi che danno per scontato l'id 1 con:

```ts
  it('reads administrator status from the tenant admin role id, not from a fixed id', () => {
    expect(evaluateAuthorization(2, [0, 57], 57).isAdmin).toBe(true)
    expect(evaluateAuthorization(2, [0, 1], 57).isAdmin).toBe(false)
  })
```

- [✅] **Step 2: Test d'integrazione che fallisce** `lib/tenancy/system-roles.integration.test.ts`:

```ts
import { expect, it } from 'vitest'
import { withTenant } from '@/lib/db/tenant-db'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from './system-roles'
import { resolveRequestTenant } from './request-tenant'
import { defaultTestTenant } from './testing'

describeIntegration('tenant context', () => {
  it('resolves the request tenant from the tenant table', async () => {
    expect(await resolveRequestTenant()).toBe(defaultTestTenant())
  })

  it('finds the system roles of the tenant by key', async () => {
    expect(await withTenant(defaultTestTenant(), getSystemRoleIds)).toEqual({ registered: 0, tenantAdmin: 1 })
  })
})
```

Run: `npx tsc --noEmit`
Expected: FAIL (`./system-roles` non esiste; `evaluateAuthorization` vuole 2 argomenti).

- [✅] **Step 3: Scrivere `lib/tenancy/system-roles.ts`.**

```ts
import { cache } from 'react'
import { isNotNull } from 'drizzle-orm'
import { role } from '@/lib/db/schema'
import type { TenantTx } from '@/lib/db/tenant-db'

export interface SystemRoleIds {
  registered: number
  tenantAdmin: number
}

/**
 * I due ruoli di sistema del tenant della transazione, riconosciuti dalla chiave e non dall'id
 * (MTF-DEC-5): ogni tenant ha le proprie copie. La RLS limita la lettura al tenant corrente.
 * Memorizzata per transazione con cache() di React.
 */
export const getSystemRoleIds = cache(async (tx: TenantTx): Promise<SystemRoleIds> => {
  const rows = await tx.select({ idRole: role.idRole, systemKey: role.systemKey }).from(role).where(isNotNull(role.systemKey))
  const registered = rows.find(row => row.systemKey === 'REGISTERED')?.idRole
  const tenantAdmin = rows.find(row => row.systemKey === 'TENANT_ADMIN')?.idRole
  if (registered === undefined || tenantAdmin === undefined) throw new Error('system roles missing')
  return { registered, tenantAdmin }
})
```

- [✅] **Step 4: `resolveRequestTenant` legge la tabella.** Sostituire
  `lib/tenancy/request-tenant.ts`:

```ts
import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { tenant } from '@/lib/db/schema'
import { withGlobal } from '@/lib/db/tenant-db'
import { DEFAULT_TENANT_SLUG, toTenantId, type TenantId } from './tenant-id'

// L'id di un tenant non cambia mai: si legge una volta per processo.
let defaultTenant: TenantId | null = null

/**
 * Il tenant della richiesta corrente. In questo pezzo è sempre quello predefinito (MTF-DEC-2):
 * nel pezzo 4 leggerà il token o l'host, e chi lo chiama non dovrà cambiare.
 */
export const resolveRequestTenant = cache(async (): Promise<TenantId> => {
  if (defaultTenant === null) {
    const [row] = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, DEFAULT_TENANT_SLUG)))
    if (!row) throw new Error('default tenant missing')
    defaultTenant = toTenantId(row.id)
  }
  return defaultTenant
})
```

- [✅] **Step 5: Sostituire gli id fissi.**
  - **`lib/auth-policy.ts`:** `evaluateAuthorization(status, roleIds, adminRoleId)` con
    `isAdmin: effectiveRoleIds.includes(adminRoleId)`.
  - **`lib/rbac/auth-roles.ts`:**
    - in `selectUserAuthorization`, `const system = await getSystemRoleIds(tx)`;
    - l'inserimento del ruolo base usa `system.registered`;
    - il risultato è `evaluateAuthorization(user.idUserStatus, ids, system.tenantAdmin)`;
    - nel ramo "utente inesistente" si chiama `evaluateAuthorization(null, [], system.tenantAdmin)`;
    - `computeIsAdmin` diventa `computeIsAdmin(roleIds, tenantAdminId)`; aggiornare i suoi
      chiamanti (`grep -rn computeIsAdmin lib app`).
  - **`lib/rbac/users-actions.ts`** (`:18`, `:48`, `:54`): dentro la `withTenant` dell'azione
    prendere `const system = await getSystemRoleIds(tx)` e usare `system.tenantAdmin` e
    `system.registered`.
  - **`lib/rbac/grant-guards.ts:59`:** la funzione riceve `tenantAdminId: number` come parametro
    in più; i chiamanti lo passano da `getSystemRoleIds(tx)`.
  - **`ManageRolesModal.tsx`** riceve una prop `registeredRoleId: number` al posto della costante.
    - `UsersTableClient` la riceve e la passa.
    - La pagina della gestione utenti (trovarla con `grep -rln UsersTableClient app`) la calcola
      con `withTenant(actor.tenantId, getSystemRoleIds)` e la passa come prop.
  - **`lib/rbac/types.ts`:** rimuovere `ROLE_REGISTERED` e `ROLE_ADMINISTRATOR`.

Run: `cd sources/microservices/web-construct && grep -rn "ROLE_ADMINISTRATOR\|ROLE_REGISTERED\|includes(1)" lib app components`
Expected: nessuna riga.

- [✅] **Step 6: Verificare.**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run test:integration`
Expected: PASS, compresi i due nuovi test.

- [ ] **Step 7: Verificare nel browser.**
  - Come amministratore aprire Utenti, aprire "Gestisci ruoli" su un utente di prova e
    controllare che il ruolo base sia bloccato come prima.
  - Come utente non amministratore controllare che le voci di amministrazione non compaiano.

- [✅] **Step 8: E2E.**

Run: `uv run pytest`
Expected: PASS.

- [✅] **Step 9: Commit e checkbox.** Segnare MTF-6 come `- [✅]`.

```bash
git add sources/microservices/web-construct docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md
git commit -m "feat(rbac): system roles are found by key in the request tenant

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Rilascio:** il Task 8 va in produzione **prima** del Task 9 (§5.1 della specifica).

---

### Task 9: Migrazione 0047, il confine si accende (MTF-7)

**Files:**
- Create: `sources/devops/db/migrations/0047_tenant_rls.sql`
- Modify: `web-construct/lib/schema-contract.integration.test.ts`
- Modify: `sources/devops/db/db.mjs` (`boundaryCheck`)
- Modify: i test di integrazione che scrivono `permission`:
  `lib/rbac/permission-schema.integration.test.ts`, `roles-actions.integration.test.ts`,
  `navigation-actions.integration.test.ts`, `actor.integration.test.ts`,
  `users-actions-grants.integration.test.ts`
- Modify: `sources/devops/db/schema.sql`

**Interfaces:**
- Consumes: Task 7 (`protect_tenant_table`, `declare_global_table`), Task 4 (`withOwner`).
- Produces: ogni tabella di `public` (tranne la cronologia delle migrazioni) è nel registro, con
  RLS forzata e le policy della sua classe.

- [✅] **Step 1: Scrivere i test di contratto che falliscono.** In
  `schema-contract.integration.test.ts`:

```ts
  it('classifies every application table', async () => {
    const unclassified = await withGlobal(tx => tx.execute<{ name: string }>(sql`
      select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and c.relname <> 'construct_schema_migration'
        and not exists (select 1 from app_private.table_class tc where tc.table_name = c.relname)
      order by 1
    `))
    expect(unclassified.map(row => row.name)).toEqual([])
  })

  it('forces row level security on every classified table', async () => {
    const loose = await withGlobal(tx => tx.execute<{ name: string }>(sql`
      select tc.table_name as name
      from app_private.table_class tc
      join pg_class c on c.relname = tc.table_name and c.relnamespace = 'public'::regnamespace
      where not (c.relrowsecurity and c.relforcerowsecurity)
      order by 1
    `))
    expect(loose.map(row => row.name)).toEqual([])
  })

  it('guards every tenant table with the tenant policies, a leading index and composite keys', async () => {
    const violations = await withGlobal(tx => tx.execute<{ name: string; problem: string }>(sql`
      with tenant_tables as (
        select c.oid, c.relname
        from app_private.table_class tc
        join pg_class c on c.relname = tc.table_name and c.relnamespace = 'public'::regnamespace
        where tc.class = 'tenant'
      )
      select t.relname as name, 'id_tenant' as problem from tenant_tables t
      where not exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = 'id_tenant'
                        and a.attnotnull and a.atttypid = 'int8'::regtype)
      union all
      select t.relname, 'tenant_boundary' from tenant_tables t
      where not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = t.relname and p.policyname = 'tenant_boundary'
          and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL'
          and p.roles @> array['construct_runtime', 'construct_owner']::name[]
          and p.qual like '%current_tenant_id%' and p.with_check like '%current_tenant_id%')
      union all
      select t.relname, 'tenant_access' from tenant_tables t
      where not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = t.relname and p.policyname = 'tenant_access'
          and p.permissive = 'PERMISSIVE' and p.cmd = 'ALL')
      union all
      select t.relname, 'leading index' from tenant_tables t
      where not exists (
        select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
        where i.indrelid = t.oid and a.attname = 'id_tenant')
      union all
      select t.relname, 'foreign key ' || k.conname from tenant_tables t
      join pg_constraint k on k.conrelid = t.oid and k.contype = 'f'
      join tenant_tables target on target.oid = k.confrelid
      where not exists (
        select 1 from unnest(k.conkey) key_column(attnum)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = key_column.attnum
        where a.attname = 'id_tenant')
      order by 1, 2
    `))
    expect(violations).toEqual([])
  })

  it('gives global tables the policies and grants of their class', async () => {
    const violations = await withGlobal(tx => tx.execute<{ name: string; problem: string }>(sql`
      select tc.table_name as name, 'policy' as problem
      from app_private.table_class tc
      where tc.class <> 'tenant' and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = tc.table_name
          and p.policyname = case tc.class when 'global_write' then 'global_access' else 'global_read' end)
      union all
      select tc.table_name, 'write grant on a read-only table'
      from app_private.table_class tc
      where tc.class = 'global_read'
        and has_table_privilege('construct_runtime', format('public.%I', tc.table_name), 'insert,update,delete')
      order by 1, 2
    `))
    expect(violations).toEqual([])
  })
```

  Aggiornare anche il test aggiunto nel Task 2 (`runs every function in public with the caller
  rights`) perché copra `app_private`: nella condizione, `n.nspname = 'public'` diventa
  `n.nspname in ('public', 'app_private')`.

Run: `npm run test:integration -- lib/schema-contract.integration.test.ts`
Expected: FAIL, tutte le tabelle non classificate.

- [✅] **Step 2: Scrivere la migrazione** `0047_tenant_rls.sql`:

```sql
-- Multi-tenancy, pezzo 1 (specifica 2026-10-13, §2.4–2.5, MTF-7): il confine si accende.
-- Rilasciare solo dopo che il codice del Task 8 è in produzione (§5.1).
-- Ritorno indietro: una migrazione di correzione rimette sulle tabelle coinvolte la policy
-- permissiva `using (true)` di 0002 al posto delle due di tenant (§5.3).

select app_private.protect_tenant_table(t::regclass)
from unnest(array[
  'public.role', 'public.user_role', 'public.role_permission', 'public.menu_entry',
  'public.menu_entry_tag', 'public.role_functionality', 'public.app_theme'
]) as t;

select app_private.declare_global_table('public.tenant', false, 'registro dei tenant; lo scrive la piattaforma (pezzo 5)');
select app_private.declare_global_table('public.role_type', false, 'tabella di tipo');
select app_private.declare_global_table('public.functionality_type', false, 'tabella di tipo');
select app_private.declare_global_table('public.user_status', false, 'tabella di tipo');
select app_private.declare_global_table('public.permission', false, 'catalogo dei codici dichiarati nel sorgente (0041)');
select app_private.declare_global_table('public.users', true, 'identità globale (TB-DEC-02)');
select app_private.declare_global_table('public.auth_rate_limit', true, 'limiti per IP e per account');
select app_private.declare_global_table('public.password_set_tokens', true, 'provvisoria: inviti per tenant nel pezzo 3');
select app_private.declare_global_table('public.allowed_domains', true, 'provvisoria: diventa tenant_domain nel pezzo 3');
select app_private.declare_global_table('public.app_language', true, 'provvisoria: lingue attive per tenant nel pezzo 2');
select app_private.declare_global_table('public.translation_key', true, 'provvisoria: chiavi di piattaforma dal pezzo 2');
select app_private.declare_global_table('public.translation_value', true, 'provvisoria: sovrascritture per tenant nel pezzo 2');
```

- [✅] **Step 3: I fixture che scrivono `permission` passano a `withOwner`.**
  - Nei cinque file elencati, ogni `insert`, `update` o `delete` su `permission` fatto oggi con
    `db` o con `withGlobal` passa per `withOwner(tx => …)`. Per esempio, in
    `actor.integration.test.ts`:

```ts
    await withOwner(tx => tx.update(permission).set({ deprecatedAt: new Date().toISOString() }).where(eq(permission.code, 'read-menu')))
```

  - Aggiungere `afterAll(closeOwner)` in ognuno dei cinque file.
  - Trovare le scritture con:

Run: `cd sources/microservices/web-construct && grep -n "(permission)" lib/rbac/*.integration.test.ts`

- [✅] **Step 4: Estendere `boundary-check`.** In `db.mjs`, dentro `boundaryCheck()`, dopo le sonde
  del Task 3:

```js
    const unclassified = await sql`
      select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'construct_schema_migration'
        and not exists (select 1 from app_private.table_class tc where tc.table_name = c.relname)
    `
    report('every application table is classified', !unclassified.length, unclassified.map(row => row.name).join(', '))
    const loose = await sql`
      select tc.table_name as name
      from app_private.table_class tc
      join pg_class c on c.relname = tc.table_name and c.relnamespace = 'public'::regnamespace
      where not (c.relrowsecurity and c.relforcerowsecurity)
    `
    report('row level security is forced on every classified table', !loose.length, loose.map(row => row.name).join(', '))
    const unguarded = await sql`
      select tc.table_name as name
      from app_private.table_class tc
      where tc.class = 'tenant' and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = tc.table_name
          and p.policyname = 'tenant_boundary' and p.permissive = 'RESTRICTIVE')
    `
    report('every tenant table has its restrictive tenant policy', !unguarded.length, unguarded.map(row => row.name).join(', '))
```

- [✅] **Step 5: Applicare, rigenerare, verificare.**

```bash
set -a && . ./sources/devops/db/operator.env && set +a && TEST_DATABASE_DISPOSABLE=1 node sources/devops/db/db.mjs test-apply
node sources/devops/db/db.mjs schema-write && node sources/devops/db/db.mjs schema-check
cd sources/microservices/web-construct && npm run test && npm run test:integration
```

Expected: `applied migration(s): 0047`, tutto PASS.

- [✅] **Step 6: `boundary-check` sul database di test.**

Run: `DATABASE_URL="$TEST_DATABASE_URL" node sources/devops/db/db.mjs boundary-check`
Expected: tutte le righe `ok`, poi `the connection sits inside the runtime boundary`.

- [✅] **Step 7: E2E e verifica nel browser** (Review Focus 4).

Run: `uv run pytest`
Expected: PASS.

  Poi nel browser:
  - `/login` da disconnessi, con il colore dell'app;
  - accesso, menu, Utenti, Ruoli, Funzionalità, Tema, Lingue;
  - nessun `tenant boundary violation` nel log del server (`preview_logs`, ricerca `tenant`).

- [✅] **Step 8: Commit e checkbox.** Segnare MTF-7, MTF-OK-1 e MTF-OK-2 come `- [✅]`.

```bash
git add sources/devops/db sources/microservices/web-construct docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md
git commit -m "feat(db): the tenant boundary is enforced by PostgreSQL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Test di isolamento nel database (parte di MTF-8)

**Files:**
- Create: `web-construct/lib/db/tenant-isolation.integration.test.ts`

**Interfaces:**
- Consumes: Task 4 (`withTenant`, `withGlobal`, `withOwner`, `closeOwner`), Task 4
  (`defaultTestTenant`, `tenantIdForTest`), Task 9 (RLS attiva).
- Produces: niente per altri task; è la prova di MTF-OK-3.

- [✅] **Step 1: Scrivere il test.**

```ts
import postgres from 'postgres'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { appTheme, menuEntry, role, tenant, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'

const ROLE_TYPE_SYSTEM = 1
const ROLE_TYPE_SERVICE = 2
const A = defaultTestTenant()
let B: TenantId
let bRoleId: number
let bEntryId: number
let bAdminUserId: string
let aUserId: string

/** L'errore di Postgres dentro quello di Drizzle (0.45 avvolge la causa). */
function pgError(error: unknown): { code?: string; message?: string } {
  const outer = error as { code?: string; message?: string; cause?: { code?: string; message?: string } }
  return outer.cause ?? outer
}

beforeAll(async () => {
  const slug = `zzz-iso-${unique()}`.slice(0, 40)
  const [created] = await withOwner(tx => tx.insert(tenant).values({ slug, name: 'Isolation B' }).returning({ id: tenant.id }))
  B = tenantIdForTest(created.id)

  const [bAdmin] = await withGlobal(tx => tx.insert(users).values({ email: `zzz_iso_b_${unique()}@example.test`, idUserStatus: 2 }).returning({ id: users.id }))
  const [aUser] = await withGlobal(tx => tx.insert(users).values({ email: `zzz_iso_a_${unique()}@example.test`, idUserStatus: 2 }).returning({ id: users.id }))
  bAdminUserId = bAdmin.id
  aUserId = aUser.id

  await withOwner(async tx => {
    const [registered] = await tx.insert(role).values({ description: 'B registered', idRoleType: ROLE_TYPE_SYSTEM, systemKey: 'REGISTERED' }).returning({ idRole: role.idRole })
    const [admin] = await tx.insert(role).values({ description: 'B admin', idRoleType: ROLE_TYPE_SYSTEM, systemKey: 'TENANT_ADMIN' }).returning({ idRole: role.idRole })
    const [service] = await tx.insert(role).values({ description: 'B service', idRoleType: ROLE_TYPE_SERVICE }).returning({ idRole: role.idRole })
    await tx.insert(userRole).values([
      { userId: bAdminUserId, idRole: registered.idRole },
      { userId: bAdminUserId, idRole: admin.idRole },
    ])
    const [entry] = await tx.insert(menuEntry).values({ name: 'B entry' }).returning({ idMenuEntry: menuEntry.idMenuEntry })
    await tx.insert(appTheme).values({ primaryColor: '#123456' })
    bRoleId = service.idRole
    bEntryId = entry.idMenuEntry
  }, B)
})

afterAll(async () => {
  if (B !== undefined) {
    await withOwner(async tx => {
      await tx.delete(appTheme)
      await tx.delete(menuEntry)
      await tx.delete(userRole)
      await tx.delete(role)
    }, B)
    await withOwner(tx => tx.delete(tenant).where(eq(tenant.id, B)))
  }
  await withGlobal(tx => tx.delete(users).where(inArray(users.id, [bAdminUserId, aUserId].filter(Boolean))))
  await closeOwner()
})

describeIntegration('tenant isolation in the database', () => {
  it('shows tenant A only its own rows', async () => {
    const tenants = await withTenant(A, async tx => [
      ...(await tx.select({ t: role.idTenant }).from(role)),
      ...(await tx.select({ t: menuEntry.idTenant }).from(menuEntry)),
      ...(await tx.select({ t: userRole.idTenant }).from(userRole)),
      ...(await tx.select({ t: appTheme.idTenant }).from(appTheme)),
    ])
    expect(new Set(tenants.map(row => row.t))).toEqual(new Set([A]))
  })

  it('cannot update or delete a row of tenant B by id', async () => {
    const updated = await withTenant(A, tx => tx.update(role).set({ description: 'hijacked' }).where(eq(role.idRole, bRoleId)).returning())
    const deleted = await withTenant(A, tx => tx.delete(menuEntry).where(eq(menuEntry.idMenuEntry, bEntryId)).returning())
    expect(updated).toHaveLength(0)
    expect(deleted).toHaveLength(0)
  })

  it('cannot insert a row into tenant B', async () => {
    await expect(withTenant(A, tx => tx.insert(role).values({ idTenant: B, description: 'smuggled', idRoleType: ROLE_TYPE_SERVICE })))
      .rejects.toSatisfy(error => /row-level security/.test(pgError(error).message ?? ''))
  })

  it('cannot point a row of tenant A at a row of tenant B', async () => {
    await expect(withTenant(A, tx => tx.insert(userRole).values({ userId: aUserId, idRole: bRoleId })))
      .rejects.toSatisfy(error => pgError(error).code === '23503')
  })

  it('refuses every tenant table without a tenant', async () => {
    for (const table of [role, userRole, menuEntry, appTheme]) {
      await expect(withGlobal(tx => tx.select().from(table).limit(1)))
        .rejects.toSatisfy(error => pgError(error).code === '42501')
    }
  })

  it('still reads global tables without a tenant', async () => {
    const rows = await withGlobal(tx => tx.select({ id: users.id }).from(users).where(eq(users.id, aUserId)))
    expect(rows).toHaveLength(1)
  })

  it('leaves no tenant behind on a reused connection', async () => {
    const client = postgres(process.env.TEST_DATABASE_URL!, { prepare: false, max: 1 })
    try {
      await client.begin(async tx => { await tx`select set_config('app.tenant_id', ${String(A)}, true)` })
      await expect(client`select count(*) from public.role`).rejects.toSatisfy(
        (error: { code?: string }) => error.code === '42501')
    } finally {
      await client.end({ timeout: 5 })
    }
  })

  it('keeps the last active administrator per tenant', async () => {
    // A ha i propri amministratori: non salvano B.
    await expect(withTenant(B, tx => tx.execute(sql`select public.replace_user_roles_guarded(${bAdminUserId}, '{}'::bigint[])`)))
      .rejects.toSatisfy(error => /last_active_administrator/.test(pgError(error).message ?? ''))
  })

  it('does not make tenants wait on each other for the administrator lock', async () => {
    const holder = postgres(process.env.TEST_DATABASE_URL!, { prepare: false, max: 1 })
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const holding = holder.begin(async tx => {
      await tx`select set_config('app.tenant_id', ${String(A)}, true)`
      await tx`select pg_advisory_xact_lock(49374202, ${A}::integer)`
      await held
    })
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
      const started = Date.now()
      await withTenant(B, tx => tx.execute(sql`select public.set_user_status_guarded(${bAdminUserId}, 2)`))
      expect(Date.now() - started).toBeLessThan(2000)
    } finally {
      release()
      await holding
      await holder.end({ timeout: 5 })
    }
  })

  it('holds construct_owner to the boundary too', async () => {
    await expect(withOwner(tx => tx.select().from(role).limit(1)))
      .rejects.toSatisfy(error => pgError(error).code === '42501')
  })

  it('removes the memberships of a deleted user in every tenant', async () => {
    const [temp] = await withGlobal(tx => tx.insert(users).values({ email: `zzz_iso_tmp_${unique()}@example.test`, idUserStatus: 2 }).returning({ id: users.id }))
    await withOwner(tx => tx.insert(userRole).values({ userId: temp.id, idRole: bRoleId }), B)
    await withGlobal(tx => tx.delete(users).where(eq(users.id, temp.id)))
    const left = await withOwner(tx => tx.select().from(userRole).where(eq(userRole.userId, temp.id)), B)
    expect(left).toHaveLength(0)
  })
})
```

- [✅] **Step 2: Lanciare il test.**

Run: `cd sources/microservices/web-construct && npm run test:integration -- lib/db/tenant-isolation.integration.test.ts`
Expected: PASS. Se un caso fallisce, è un buco nel confine: va corretto nella migrazione o nel
codice del task che lo possiede, **non** nel test.

- [✅] **Step 3: Verificare che il test morda.** Su un database usa e getta, togliere a mano la
  policy restrittiva da `role`:

```bash
DATABASE_URL="$TEST_MIGRATION_DATABASE_URL" node sources/devops/db/db.mjs query "drop policy tenant_boundary on public.role"
```

  Rilanciare il test: `shows tenant A only its own rows` e `cannot update…` devono fallire. Poi
  ripristinare la policy:

```bash
DATABASE_URL="$TEST_MIGRATION_DATABASE_URL" node sources/devops/db/db.mjs query "set role construct_owner; select app_private.protect_tenant_table('public.role')"
```

- [✅] **Step 4: Commit e checkbox.** Segnare MTF-OK-3 come `- [✅]`.

```bash
git add sources/microservices/web-construct/lib/db/tenant-isolation.integration.test.ts docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md
git commit -m "test(db): tenant A can neither see nor touch tenant B

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Test di concorrenza attraverso il pooler (parte di MTF-8)

**Files:**
- Create: `web-construct/lib/db/tenant-concurrency.integration.test.ts`

**Interfaces:**
- Consumes: Task 4 (`createDatabase`, `createTenantAccess`), Task 10 (stesso schema di fixture).
- Produces: prova di MTF-OK-4.

- [✅] **Step 1: Scrivere il test.**
  - Gira su ogni URL configurato:
    - `TEST_DATABASE_URL`, modalità sessione, sempre presente;
    - `TEST_DATABASE_POOLED_URL`, modalità transazione, se c'è.
  - In CI (PostgreSQL vanilla, senza pooler) gira solo il primo; in locale, su Supabase,
    entrambi.

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDatabase } from '@/lib/db/client'
import { menuEntry, tenant } from '@/lib/db/schema'
import { createTenantAccess } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { unique } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'

const A = defaultTestTenant()
let B: TenantId

const targets = [
  { mode: 'session', url: process.env.TEST_DATABASE_URL },
  { mode: 'transaction pooler', url: process.env.TEST_DATABASE_POOLED_URL },
].filter((target): target is { mode: string; url: string } => Boolean(target.url))

const enabled = process.env.I18N_INTEGRATION_DB === '1'

beforeAll(async () => {
  if (!enabled) return
  const [created] = await withOwner(tx => tx.insert(tenant).values({ slug: `zzz-con-${unique()}`.slice(0, 40), name: 'Concurrency B' }).returning({ id: tenant.id }))
  B = tenantIdForTest(created.id)
  await withOwner(tx => tx.insert(menuEntry).values(Array.from({ length: 5 }, (_, i) => ({ name: `B ${i}` }))), B)
})

afterAll(async () => {
  if (!enabled) return
  if (B !== undefined) {
    await withOwner(tx => tx.delete(menuEntry), B)
    await withOwner(tx => tx.delete(tenant).where(eq(tenant.id, B)))
  }
  await closeOwner()
})

for (const target of targets) {
  (enabled ? describe : describe.skip)(`tenant isolation under concurrency (${target.mode})`, () => {
    it('never returns a row of the other tenant across 400 interleaved transactions', async () => {
      const { database, close } = createDatabase(target.url, { max: 10 })
      const { withTenant } = createTenantAccess(database)
      try {
        const runs = Array.from({ length: 400 }, (_, index) => {
          const expected = index % 2 === 0 ? A : B
          return withTenant(expected, async tx => {
            const first = await tx.select({ t: menuEntry.idTenant }).from(menuEntry)
            const second = await tx.select({ t: menuEntry.idTenant }).from(menuEntry)
            return { expected, seen: [...first, ...second].map(row => row.t) }
          })
        })
        const results = await Promise.all(runs)
        const leaks = results.filter(result => result.seen.some(t => t !== result.expected))
        expect(leaks).toEqual([])
        expect(results.every(result => result.seen.length > 0)).toBe(true)
      } finally {
        await close()
      }
    }, 60_000)
  })
}
```

- [✅] **Step 2: Lanciare il test.**

Run: `cd sources/microservices/web-construct && npm run test:integration -- lib/db/tenant-concurrency.integration.test.ts`
Expected: PASS. In locale si vedono due blocchi (`session` e `transaction pooler`), in CI uno.

- [✅] **Step 3: Commit e checkbox.** Segnare MTF-OK-4, MTF-8, MTF-RISK-4 come `- [✅]`.

```bash
git add sources/microservices/web-construct/lib/db/tenant-concurrency.integration.test.ts docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md
git commit -m "test(db): interleaved tenants never see each other through the pooler

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Verifica finale e misure

**Files:**
- Modify: `docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md` (checkbox
  rimaste e misure)

- [✅] **Step 1: Tutte le porte di qualità.**

Run: `cd sources/microservices/web-construct && npm run lint && npm run test && npm run test:integration && npm run build && npm run test:migrations && npm run test:env-contract && node ../../devops/db/db.mjs schema-check`
Expected: PASS.

- [✅] **Step 2: E2E completo** (a integrazione ferma).

Run: `uv run pytest`
Expected: PASS.

- [ ] **Step 3: Misure di MTF-RISK-2 e MTF-RISK-3.** Con l'anteprima di sviluppo misurare il tempo
  di risposta, mediana di 10 caricamenti, di `/`, `/user-management` e `/functionalities`
  sull'ultimo commit di `development` e su questo branch.
  - Se la differenza supera il 20%, **segnalarlo** al proprietario del progetto con i numeri,
    prima di proporre interventi (unire le letture dell'autorizzazione, dividere i loader in più
    `withTenant`).
  - Se resta sotto, segnare MTF-RISK-2 e MTF-RISK-3 come `- [✅]` annotando i numeri nella
    descrizione.

- [ ] **Step 4: `boundary-check` sul database di sviluppo** (sola lettura). Va fatto dopo aver
  applicato le migrazioni 0044–0047 allo sviluppo con `db.mjs apply`, solo su conferma del
  proprietario del progetto.

Run: `node sources/devops/db/db.mjs boundary-check`
Expected: tutte `ok`.

- [✅] **Step 5: Checkbox finali.** Segnare MTF-RISK-5 (eccezione documentata in §2.2 della
  specifica) e verificare che MTF-1…8, MTF-OK-1…5 e MTF-RISK-1…5 siano tutte `- [✅]`, o motivate
  se no.

- [ ] **Step 6: Commit.**

```bash
git add docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md
git commit -m "docs(multi-tenancy): piece 1 verified end to end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
