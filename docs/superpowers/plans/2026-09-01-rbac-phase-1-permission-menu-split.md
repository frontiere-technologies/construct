# RBAC Fase 1 — Separazione `permission` / `menu_entry` — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare il modello dati da `navigation_item` (voce di menu e permesso nella stessa riga) a `permission` + `menu_entry`, **senza cambiare di una virgola il comportamento dell'applicazione**.

**Architecture:** `navigation_item` viene rinominata `permission` e cede i campi di presentazione a una nuova `menu_entry` che ci punta contro con una chiave esterna annullabile; `role_item` diventa `role_permission` e perde `authorized`. Il percorso di lettura della barra laterale passa da `menu_entry`, quello dell'albero delle concessioni da `permission`. Ogni task lascia l'applicazione verde e osservabilmente identica.

**Tech Stack:** PostgreSQL (migrazioni SQL ordinate e immutabili in `sources/devops/db/migrations/`), Drizzle ORM, Next.js 16 App Router, Vitest, pytest/Playwright per E2E.

**Specifica:** [2026-09-01-rbac-permission-model-design.md](../specs/2026-09-01-rbac-permission-model-design.md) — §3 modello dati, §8 migrazione.

## Perimetro delle tre fasi

Questa fase è **solo il modello dati**. Non introduce permessi nuovi, non cambia chi può fare cosa, non tocca l'interfaccia. Il criterio di successo è «non è cambiato niente».

| Fase | Contenuto | Stato |
|---|---|---|
| **1 — Fondazione dati** (questo piano) | rinomina, `menu_entry`, `role_permission`, percorsi di lettura e scrittura | **eseguita** il 2026-09-01/02, ramo `feature/rbac-phase-1` (28 commit, migrazioni `0014`–`0022`), non ancora integrata |
| 2 — Catalogo ed enforcement | `permission-catalog.ts`, sincronizzazione, `resolveActor`, `requirePermission`, guardie AST, HOLE-1..4, token ridotto all'identità. **Aggiunto in corso d'opera**: il trigger a difesa dei permessi `SOURCE` promesso in §3.1 della specifica, che nessun task ha programmato e che ha senso solo quando la sincronizzazione farà nascere le prime righe `SOURCE` | da pianificare |
| 3 — Interfaccia | `/menu`, campo *Permesso richiesto*, pagina `/permissions`, semplificazione di `/roles-permissions`, `use-auth`. **Aggiunto in corso d'opera**: lo **spostamento di un permesso nell'albero**, oggi impossibile (DEC-15) — fino ad allora ogni permesso creato dalla console si accumula alla radice e nessuno può riordinare; e la **conversione categoria↔funzionalità** di una voce esistente, che la Fase 1 ha dovuto vietare invece di implementare (DEC-16; il cambio fra i tre *sottotipi* di funzionalità funziona già e non è rimandato) | da pianificare |

Il **progetto** delle tre fasi sta tutto nella [specifica](../specs/2026-09-01-rbac-permission-model-design.md), che non parla di fasi: §4 e §5 sono la Fase 2 sul catalogo, §6 la Fase 2 sull'enforcement, §7 la Fase 3. Questa tabella dice soltanto in quale ordine affrontarle. Chi pianificherà la Fase 2 parte da lì, non da qui.

## Global Constraints

- **Le migrazioni applicate sono immutabili.** Ogni migrazione è registrata in `public.construct_schema_migration` con un checksum, e `assertAppliedMigrationChecksums` rifiuta qualunque comando se un file già applicato è cambiato. Se una migrazione sbaglia, si scrive la successiva — non si modifica quella.
- **`sources/devops/db/schema.sql` non si scrive mai a mano.** È uno snapshot generato: `node ../../devops/db/db.mjs schema-write` lo rigenera, `npm run schema:check` verifica che sia allineato.
- **Ogni tabella nuova va concessa esplicitamente al ruolo di runtime.** Il modello di sicurezza di `0002_runtime_boundary.sql` è: `revoke all ... from public`, `grant select, insert, update, delete ... to construct_runtime`, più una policy RLS `construct_runtime_server_access`. Una tabella senza queste tre righe è invisibile all'applicazione e fa fallire `lib/schema-contract.integration.test.ts`. Le tabelle **rinominate** conservano privilegi e policy: è uno dei motivi per cui si rinomina invece di ricreare.
- **Le funzioni SQL vanno ricreate quando cambiano i nomi che citano.** I loro corpi sono testo, non riferimenti per OID: `apply_role_permission_deltas` e `replace_item_tags` smettono di funzionare al primo rename e vanno riscritte nella stessa migrazione.
- **Il database dei test E2E non è quello di sviluppo.** `node ../../devops/db/db.mjs test-apply` applica al database di test (`.env.test.local`); `node ../../devops/db/db.mjs apply` a quello puntato da `MIGRATION_DATABASE_URL`. Entrambi vanno migrati prima di eseguire le rispettive suite.
- **Comandi eseguiti da `sources/microservices/web-construct/`** salvo dove indicato diversamente.
- **Test di integrazione**: `npm run test:integration` (protetti da `I18N_INTEGRATION_DB=1`, richiedono un database vero).

---

### Task 1: Rinomina `navigation_item` → `permission` e `role_item` → `role_permission`

Task puramente meccanico e ad alto volume: nessuna colonna cambia, nessun comportamento cambia. Va per primo perché è la parte rischiosa (tocca 16 file) e conviene isolarla da qualunque cambio di semantica: se qualcosa si rompe qui, si è rotto un nome, non una regola.

**Files:**
- Create: `sources/devops/db/migrations/0014_permission_rename.sql`
- Create: `lib/rbac/permission-schema.integration.test.ts`
- Modify: `lib/db/schema.ts`
- Modify (meccanico): `lib/rbac/{functionalities-service,nav-row-mapper,nav-tree-builder,navigation-actions,navigation-service,permission-tree,roles-service,sidebar-adapter,types}.ts`, `lib/i18n/test-support/db-fixtures.ts`, `lib/schema-contract.integration.test.ts`, e i test che li accompagnano
- Modify: `sources/devops/db/schema.sql` (rigenerato, non a mano)

**Interfaces:**
- Consumes: niente — è il primo task.
- Produces: gli identificatori Drizzle `permission` (era `navigationItem`) e `rolePermission` (era `roleItem`); la colonna `permission.idPermission` (era `navigationItem.idItem`) e `rolePermission.idPermission` (era `roleItem.idItem`). Tutti i task successivi usano questi nomi.

- [✅] **Step 1: Scrivere il test di integrazione che fallisce**

Create `lib/rbac/permission-schema.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/** Il rename è riuscito solo se i nomi vecchi sono spariti: una vista o una
 *  funzione lasciata indietro punterebbe ancora là e fallirebbe a runtime, non qui. */
async function tableExists(name: string): Promise<boolean> {
  const rows = await db.execute(
    sql`select 1 from information_schema.tables where table_schema = 'public' and table_name = ${name}`,
  )
  return rows.length > 0
}

describe('rename delle tabelle RBAC', () => {
  it('espone permission e role_permission, e non più i nomi vecchi', async () => {
    expect(await tableExists('permission')).toBe(true)
    expect(await tableExists('role_permission')).toBe(true)
    expect(await tableExists('navigation_item')).toBe(false)
    expect(await tableExists('role_item')).toBe(false)
  })

  it('rinomina la chiave primaria in id_permission su entrambe', async () => {
    const rows = await db.execute(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('permission', 'role_permission')
        and column_name = 'id_permission'
      order by table_name
    `)
    expect(rows.map(r => r.table_name)).toEqual(['permission', 'role_permission'])
  })

  it('conserva privilegi e policy RLS che il rename non deve perdere', async () => {
    const grants = await db.execute(sql`
      select table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'construct_runtime'
        and table_name in ('permission', 'role_permission')
      group by table_name order by table_name
    `)
    expect(grants.map(r => r.table_name)).toEqual(['permission', 'role_permission'])
  })

  it('mantiene eseguibile apply_role_permission_deltas dopo il rename', async () => {
    const rows = await db.execute(sql`
      select 1 from pg_proc where proname = 'apply_role_permission_deltas'
    `)
    expect(rows.length).toBe(1)
  })
})
```

- [✅] **Step 2: Eseguirlo e verificare che fallisca**

```bash
npm run test:integration -- lib/rbac/permission-schema.integration.test.ts
```

Atteso: FAIL — `expected false to be true`, perché `permission` non esiste ancora.

- [✅] **Step 3: Scrivere la migrazione**

Create `sources/devops/db/migrations/0014_permission_rename.sql`:

```sql
-- navigation_item era gia' il permesso: e' role_item a puntarci contro. Il nome
-- diceva l'altra meta' del lavoro — la voce di menu — e quella meta' esce da qui
-- nella migrazione 0016. Questa rinomina soltanto: nessuna colonna cambia,
-- nessun dato si muove, nessuna concessione si perde.
--
-- Si rinomina invece di ricreare-e-copiare perche' ALTER TABLE ... RENAME
-- conserva privilegi, policy RLS e chiavi esterne. Ricreare significherebbe
-- riconcedere tutto a construct_runtime a mano, e dimenticarne una e' un buco
-- che si scopre in produzione.

alter table public.navigation_item rename to permission;
alter table public.permission rename column id_item to id_permission;
alter table public.permission rename column id_item_parent to id_parent;

alter table public.role_item rename to role_permission;
alter table public.role_permission rename column id_item to id_permission;
-- La chiave primaria e' un indice, non una tabella: ALTER TABLE ... RENAME non
-- la raggiunge. Il rename dell'indice e' cosmetico ma tenerlo allineato evita
-- che il prossimo che legge schema.sql cerchi una role_item che non c'e' piu'.
alter index public.role_item_pkey rename to role_permission_pkey;

alter sequence public.s_id_navigation_item rename to s_id_permission;

-- I corpi delle funzioni sono testo, non riferimenti per OID: dopo il rename
-- citano tabelle che non esistono piu' e fallirebbero alla prima chiamata.
create or replace function public.apply_role_permission_deltas(
  p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[]
) returns void language plpgsql security definer set search_path = public as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_permission (id_role, id_permission, authorized)
      select p_role_id, unnest(p_grant_ids), true
      on conflict (id_role, id_permission) do update set authorized = true;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_permission
      where id_role = p_role_id and id_permission = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end $$;

create or replace function public.replace_item_tags(p_id_item bigint, p_tags jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.navigation_item_tag where id_item = p_id_item;
  insert into public.navigation_item_tag (id_item, tag_lan, tag)
    select p_id_item, elem->>'tag_lan', elem->>'tag'
    from jsonb_array_elements(p_tags) as elem
    on conflict do nothing;
end $$;

grant execute on function public.apply_role_permission_deltas(bigint, bigint[], bigint[]) to construct_runtime;
grant execute on function public.replace_item_tags(bigint, jsonb) to construct_runtime;

-- role_list_view conta le concessioni: la sua definizione cita i nomi vecchi.
drop view if exists public.role_list_view;
create view public.role_list_view with (security_invoker = true) as
  select r.id_role as id,
         r.description,
         rt.description as role_type,
         r.date_ins,
         r.date_mod,
         (select count(*) from public.user_role ur where ur.id_role = r.id_role) as associated_users,
         exists (select 1 from public.role_permission rp
                 where rp.id_role = r.id_role and rp.authorized) as has_permissions
  from public.role r
  left join public.role_type rt on rt.id_role_type = r.id_role_type;

revoke all on table public.role_list_view from public;
grant select on table public.role_list_view to construct_runtime;
```

> **Prima di scrivere il blocco `create view`**: rileggere la definizione reale in `sources/devops/db/schema.sql` (`grep -A20 'role_list_view' sources/devops/db/schema.sql`) e riprodurla identica cambiando solo `role_item`→`role_permission` e `id_item`→`id_permission`. La versione qui sopra è la forma attesa, non necessariamente l'ultima parola: se il file diverge, vince il file.

- [✅] **Step 4: Applicare la migrazione ai due database**

```bash
node ../../devops/db/db.mjs test-apply
```

Poi, con `MIGRATION_DATABASE_URL` esportata, quello di sviluppo:

```bash
node ../../devops/db/db.mjs apply
```

- [✅] **Step 5: Rinominare gli identificatori nel modello Drizzle**

In `lib/db/schema.ts`: `navigationItem` → `permission`, `roleItem` → `rolePermission`, `pgTable('navigation_item')` → `pgTable('permission')`, `pgTable('role_item')` → `pgTable('role_permission')`, `idItem: bigint('id_item')` → `idPermission: bigint('id_permission')`, `idItemParent: bigint('id_item_parent')` → `idParent: bigint('id_parent')`, e `nextval('s_id_navigation_item')` → `nextval('s_id_permission')`.

`navigationItemType` e `navigationItemTag` **non** si toccano in questo task: la prima sparisce nel Task 7, la seconda diventa `menu_entry_tag` nel Task 3.

- [✅] **Step 6: Propagare il rename al resto del sorgente**

Il compilatore è la lista dei posti da toccare:

```bash
npm run typecheck
```

Correggere finché è pulito. I sedici file coinvolti sono quelli che citano `navigationItem` o `roleItem`; i campi interni dei DTO (`id_item` dentro `NavigationItemRow`, `idItem` dentro `PermissionDelta`) **restano invariati in questo task** — rinominare anche quelli allargherebbe il diff senza aggiungere niente, e il Task 5 li tocca comunque.

- [✅] **Step 7: Rigenerare lo snapshot e far girare tutto**

```bash
node ../../devops/db/db.mjs schema-write
npm run schema:check && npm run lint && npm run typecheck && npm run test
npm run test:integration
```

Atteso: tutto verde, compreso il nuovo `permission-schema.integration.test.ts`.

- [✅] **Step 8: Commit**

```bash
git add sources/devops/db/migrations/0014_permission_rename.sql sources/devops/db/schema.sql sources/microservices/web-construct/
git commit -m "refactor(rbac): navigation_item diventa permission, role_item diventa role_permission

Rinomina e basta: nessuna colonna cambia, nessun dato si muove. ALTER TABLE
RENAME conserva privilegi, policy RLS e chiavi esterne — ricreare le tabelle
avrebbe richiesto di riconcedere tutto a construct_runtime a mano.

Le due funzioni SQL e role_list_view citano i nomi per testo, non per OID:
sono riscritte nella stessa migrazione o fallirebbero alla prima chiamata.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Colonne `kind`, `code`, `origin`, `deprecated_at` su `permission`

Aggiunge le colonne che la Fase 2 userà, con il popolamento dai dati esistenti. Nessun codice le legge ancora: il task si chiude quando il database le ha e i vincoli reggono.

**Files:**
- Create: `sources/devops/db/migrations/0015_permission_identity.sql`
- Modify: `lib/db/schema.ts`
- Modify: `lib/rbac/permission-schema.integration.test.ts`

**Interfaces:**
- Consumes: `permission` con `idPermission`, `idParent` (Task 1).
- Produces: `permission.kind` (`'CATEGORY' | 'GRANT'`), `permission.code` (`string | null`), `permission.origin` (`'SOURCE' | 'CONSOLE'`), `permission.deprecatedAt` (`string | null`). Il Task 6 legge `kind`; la Fase 2 legge `code` e `origin`.

- [✅] **Step 1: Scrivere i test che falliscono**

Aggiungere a `lib/rbac/permission-schema.integration.test.ts`:

```ts
describe('identità del permesso', () => {
  it('assegna kind a ogni riga esistente', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as orfane from public.permission
      where kind not in ('CATEGORY', 'GRANT')
    `)
    expect(rows[0].orfane).toBe(0)
  })

  it('dà un code a ogni GRANT e a nessuna CATEGORY', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as violazioni from public.permission
      where (kind = 'GRANT' and code is null) or (kind = 'CATEGORY' and code is not null)
    `)
    expect(rows[0].violazioni).toBe(0)
  })

  it('rifiuta un GRANT senza code', async () => {
    await expect(
      db.execute(sql`
        insert into public.permission (kind, code, origin, description, id_parent, order_position)
        values ('GRANT', null, 'CONSOLE', 'senza codice', 0, 0)
      `),
    ).rejects.toThrow()
  })

  it('rifiuta due permessi con lo stesso code', async () => {
    await db.execute(sql`
      insert into public.permission (kind, code, origin, description, id_parent, order_position)
      values ('GRANT', 'test-duplicato', 'CONSOLE', 'primo', 0, 0)
    `)
    await expect(
      db.execute(sql`
        insert into public.permission (kind, code, origin, description, id_parent, order_position)
        values ('GRANT', 'test-duplicato', 'CONSOLE', 'secondo', 0, 0)
      `),
    ).rejects.toThrow()
    await db.execute(sql`delete from public.permission where code = 'test-duplicato'`)
  })
})
```

- [✅] **Step 2: Eseguirli e verificare che falliscano**

```bash
npm run test:integration -- lib/rbac/permission-schema.integration.test.ts
```

Atteso: FAIL — `column "kind" does not exist`.

- [✅] **Step 3: Scrivere la migrazione**

Create `sources/devops/db/migrations/0015_permission_identity.sql`:

```sql
-- Le quattro colonne che rendono un permesso identificabile dal sorgente.
-- Nessun codice le legge ancora: servono alla Fase 2, e stanno qui perche' il
-- popolamento dai dati esistenti va fatto una volta sola, adesso che i dati
-- esistenti sono ancora tutti in una tabella.
--
-- origin = 'CONSOLE' per tutto: ogni riga presente oggi e' stata creata dalla
-- console o seminata come se lo fosse. La sincronizzazione del catalogo, in
-- Fase 2, adottera' quelle che le competono ribaltando origin a 'SOURCE'.

alter table public.permission
  add column kind text,
  add column code varchar(80),
  add column origin text not null default 'CONSOLE',
  add column deprecated_at timestamptz;

-- id_item_type: 1 = categoria, 2 = funzionalita'.
update public.permission set kind = case when id_item_type = 1 then 'CATEGORY' else 'GRANT' end;

-- Un code leggibile e stabile dal nome, reso univoco dall'id quando serve.
-- E' provvisorio per definizione: la Fase 2 lo sostituira' con i codici del
-- catalogo per le righe che il catalogo copre. Le altre se lo tengono, ed e'
-- il motivo per cui vale la pena guardarli una volta a mano prima di andare
-- avanti — DEC-3 dice che un code non cambia mai piu'.
update public.permission
set code = regexp_replace(
      lower(coalesce(nullif(trim(name), ''), 'permesso-' || id_permission::text)),
      '[^a-z0-9]+', '-', 'g')
where kind = 'GRANT';

update public.permission p
set code = p.code || '-' || p.id_permission::text
where p.kind = 'GRANT'
  and exists (select 1 from public.permission q
              where q.kind = 'GRANT' and q.code = p.code and q.id_permission <> p.id_permission);

update public.permission set code = trim(both '-' from code) where kind = 'GRANT';

alter table public.permission
  alter column kind set not null,
  add constraint permission_kind_valid check (kind in ('CATEGORY', 'GRANT')),
  add constraint permission_origin_valid check (origin in ('SOURCE', 'CONSOLE')),
  add constraint permission_code_matches_kind
    check ((kind = 'GRANT' and code is not null) or (kind = 'CATEGORY' and code is null));

create unique index permission_code_unique on public.permission (code) where code is not null;
```

- [✅] **Step 4: Applicare e verificare**

```bash
node ../../devops/db/db.mjs test-apply && node ../../devops/db/db.mjs apply
npm run test:integration -- lib/rbac/permission-schema.integration.test.ts
```

Atteso: PASS.

- [✅] **Step 5: Ispezionare i codici generati**

```bash
node ../../devops/db/db.mjs query "select id_permission, code from public.permission where kind = 'GRANT' order by id_permission"
```

Leggerli davvero. DEC-3 stabilisce che un `code` non cambia mai più: se la generazione automatica ha prodotto nomi illeggibili, questo è l'ultimo momento comodo per correggerli, con una `update` dentro una migrazione `0015b` scritta apposta.

- [✅] **Step 6: Allineare il modello Drizzle**

In `lib/db/schema.ts`, dentro `permission`:

```ts
kind: text('kind', { enum: ['CATEGORY', 'GRANT'] }).notNull(),
code: varchar('code', { length: 80 }),
origin: text('origin', { enum: ['SOURCE', 'CONSOLE'] }).notNull().default('CONSOLE'),
deprecatedAt: timestamp('deprecated_at', { withTimezone: true, mode: 'string' }),
```

- [✅] **Step 7: Rigenerare lo snapshot e far girare tutto**

```bash
node ../../devops/db/db.mjs schema-write
npm run schema:check && npm run typecheck && npm run test && npm run test:integration
```

- [✅] **Step 8: Commit**

```bash
git add sources/devops/db/ sources/microservices/web-construct/lib/
git commit -m "feat(rbac): kind, code, origin e deprecated_at su permission

Popolate dai dati esistenti: id_item_type discrimina CATEGORY da GRANT, e il
code nasce dal nome reso univoco. Tutto parte da origin CONSOLE — la
sincronizzazione del catalogo, in Fase 2, adottera' cio' che le compete.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Tabelle `menu_entry` e `menu_entry_tag`

Crea le tabelle e travasa i dati. Nessun codice le legge ancora: il percorso di lettura passa nel Task 4.

**Files:**
- Create: `sources/devops/db/migrations/0016_menu_entry.sql`
- Modify: `lib/db/schema.ts`
- Modify: `lib/rbac/permission-schema.integration.test.ts`

**Interfaces:**
- Consumes: `permission` con `kind` (Task 2).
- Produces: la tabella Drizzle `menuEntry` con `idMenuEntry`, `idPermission` (annullabile), `idParent`, `orderPosition`, `navbarPosition`, `iconPath`, `functionalityLink`, `openInNewTab`, `idFunctionalityType`, `itemTranslation`, `name`, `isImmutable`; e `menuEntryTag` con `idMenuEntry`, `tagLan`, `tag`. Il Task 4 legge `menuEntry`, il Task 5 ci scrive.

- [✅] **Step 1: Scrivere i test che falliscono**

Aggiungere a `lib/rbac/permission-schema.integration.test.ts`:

```ts
describe('travaso in menu_entry', () => {
  it('crea una voce per ogni riga che oggi comparirebbe nel menu', async () => {
    // Le righe sotto Operations (id -1) e quelle di tipo funzionalità PERMISSION (5)
    // erano già invisibili: non devono generare voci. «Sotto Operations» è
    // l'intero sottoalbero, non i soli figli diretti.
    const rows = await db.execute(sql`
      with recursive sotto_operations as (
        select id_permission from public.permission where id_permission = -1
        union all
        select c.id_permission from public.permission c
        join sotto_operations d on c.id_parent = d.id_permission
      ),
      visibili as (
        select id_permission from public.permission
        where id_permission not in (0, -1)
          and id_permission not in (select id_permission from sotto_operations)
          and coalesce(id_functionality_type, 0) <> 5
          and config_visibility <> 1
      )
      select
        (select count(*)::int from visibili) as attese,
        (select count(*)::int from public.menu_entry) as create
    `)
    expect(rows[0].create).toBe(rows[0].attese)
  })

  it('lascia id_permission nullo sulle voci pubbliche e sulle categorie', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as sbagliate
      from public.menu_entry me
      join public.permission p on p.id_permission = me.id_permission
      where p.kind = 'CATEGORY'
    `)
    expect(rows[0].sbagliate).toBe(0)
  })

  it('concede la tabella nuova al ruolo di runtime', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as concesse from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'construct_runtime'
        and table_name in ('menu_entry', 'menu_entry_tag')
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    `)
    expect(rows[0].concesse).toBe(8)
  })

  it('rifiuta di cancellare un permesso a cui una voce punta', async () => {
    const [voce] = await db.execute(sql`
      select id_permission from public.menu_entry where id_permission is not null limit 1
    `)
    await expect(
      db.execute(sql`delete from public.permission where id_permission = ${voce.id_permission}`),
    ).rejects.toThrow()
  })
})
```

- [✅] **Step 2: Eseguirli e verificare che falliscano**

```bash
npm run test:integration -- lib/rbac/permission-schema.integration.test.ts
```

Atteso: FAIL — `relation "public.menu_entry" does not exist`.

- [✅] **Step 3: Scrivere la migrazione**

Create `sources/devops/db/migrations/0016_menu_entry.sql`:

```sql
-- La voce di menu esce dal permesso. Da qui in poi sono due cose: una riga di
-- permission dice cosa si puo' fare, una riga di menu_entry dice cosa si vede e
-- dove. La freccia va in una direzione sola, ed e' annullabile: id_permission
-- nullo significa voce pubblica, e manda in pensione la colonna
-- no_permission_need_for_navigation.
--
-- on delete restrict e' voluto: cancellare un permesso a cui una voce punta
-- deve fallire con un messaggio, non svuotare il collegamento in silenzio.

create sequence if not exists public.s_id_menu_entry;

create table public.menu_entry (
  id_menu_entry bigint primary key default nextval('public.s_id_menu_entry'),
  id_permission bigint references public.permission(id_permission) on delete restrict,
  -- Deferrable perche' il travaso qui sotto e' un INSERT ... SELECT solo: dentro
  -- una sola istruzione Postgres non garantisce che un genitore sia inserito
  -- prima dei suoi figli, e con un vincolo immediato la migrazione fallirebbe a
  -- seconda dell'ordine in cui il pianificatore restituisce le righe.
  id_parent bigint references public.menu_entry(id_menu_entry) on delete cascade
    deferrable initially deferred,
  name text,
  order_position integer not null default 0,
  navbar_position text check (navbar_position in ('TOP', 'BOTTOM')),
  icon_path text,
  id_functionality_type bigint references public.functionality_type(id_functionality_type),
  functionality_link text,
  open_in_new_tab smallint not null default 1,
  item_translation jsonb,
  is_immutable smallint not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index menu_entry_parent_order_idx on public.menu_entry (id_parent, order_position);
create index menu_entry_permission_idx on public.menu_entry (id_permission);

create table public.menu_entry_tag (
  id_menu_entry bigint not null references public.menu_entry(id_menu_entry) on delete cascade,
  tag_lan varchar(5) not null,
  tag varchar(50) not null,
  date_ins timestamptz not null default now(),
  primary key (id_menu_entry, tag_lan, tag)
);

-- Travaso. L'id della voce riusa l'id del permesso, cosi' le rotte
-- /embedded/{id} gia' emesse continuano a risolvere e i tag si ripuntano con
-- una join banale. E' l'unico punto in cui i due mondi condividono un numero:
-- da qui in avanti le sequenze sono separate.
insert into public.menu_entry (
  id_menu_entry, id_permission, id_parent, name, order_position, navbar_position,
  icon_path, id_functionality_type, functionality_link, open_in_new_tab,
  item_translation, is_immutable
)
select
  p.id_permission,
  case when p.kind = 'GRANT' and p.no_permission_need_for_navigation = 0
       then p.id_permission else null end,
  nullif(p.id_parent, 0),
  p.name,
  p.order_position,
  p.navbar_position,
  p.icon_path,
  p.id_functionality_type,
  p.functionality_link,
  p.open_in_new_tab,
  p.item_translation,
  p.is_immutable
from public.permission p
where p.id_permission not in (0, -1)
  -- L'intero sottoalbero di Operations, non la sola radice: una riga il cui
  -- genitore e' -1 genererebbe una voce che punta a un menu_entry(-1)
  -- inesistente, e la chiave esterna fallirebbe. Quelle righe erano gia'
  -- invisibili nel menu, quindi non c'e' niente da travasare.
  and not exists (
    with recursive discendenti as (
      select id_permission from public.permission where id_permission = -1
      union all
      select c.id_permission from public.permission c
      join discendenti d on c.id_parent = d.id_permission
    )
    select 1 from discendenti where discendenti.id_permission = p.id_permission
  )
  and coalesce(p.id_functionality_type, 0) <> 5
  and p.config_visibility <> 1;

select setval('public.s_id_menu_entry', (select coalesce(max(id_menu_entry), 0) + 1 from public.menu_entry), false);

insert into public.menu_entry_tag (id_menu_entry, tag_lan, tag, date_ins)
select t.id_item, t.tag_lan, t.tag, t.date_ins
from public.navigation_item_tag t
join public.menu_entry me on me.id_menu_entry = t.id_item;

-- Il modello di sicurezza di 0002: senza queste tre righe l'applicazione non
-- vede la tabella e schema-contract.integration.test.ts fallisce.
revoke all on table public.menu_entry, public.menu_entry_tag from public;
grant select, insert, update, delete on table public.menu_entry, public.menu_entry_tag to construct_runtime;
grant usage, select on sequence public.s_id_menu_entry to construct_runtime;

alter table public.menu_entry enable row level security;
alter table public.menu_entry_tag enable row level security;
create policy construct_runtime_server_access on public.menu_entry
  for all to construct_runtime using (true) with check (true);
create policy construct_runtime_server_access on public.menu_entry_tag
  for all to construct_runtime using (true) with check (true);

-- replace_item_tags scrive sui tag: ora i tag stanno sulle voci.
create or replace function public.replace_menu_entry_tags(p_id_menu_entry bigint, p_tags jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.menu_entry_tag where id_menu_entry = p_id_menu_entry;
  insert into public.menu_entry_tag (id_menu_entry, tag_lan, tag)
    select p_id_menu_entry, elem->>'tag_lan', elem->>'tag'
    from jsonb_array_elements(p_tags) as elem
    on conflict do nothing;
end $$;

grant execute on function public.replace_menu_entry_tags(bigint, jsonb) to construct_runtime;
```

- [✅] **Step 4: Applicare e verificare**

```bash
node ../../devops/db/db.mjs test-apply && node ../../devops/db/db.mjs apply
npm run test:integration -- lib/rbac/permission-schema.integration.test.ts
```

Atteso: PASS su tutti e quattro i nuovi test.

- [✅] **Step 5: Aggiungere le tabelle al modello Drizzle**

In `lib/db/schema.ts`:

```ts
export const menuEntry = pgTable('menu_entry', {
  idMenuEntry: bigint('id_menu_entry', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_menu_entry')`),
  idPermission: bigint('id_permission', { mode: 'number' }).references(() => permission.idPermission),
  idParent: bigint('id_parent', { mode: 'number' }).references((): AnyPgColumn => menuEntry.idMenuEntry, { onDelete: 'cascade' }),
  name: text('name'),
  orderPosition: integer('order_position').notNull().default(0),
  navbarPosition: text('navbar_position', { enum: ['TOP', 'BOTTOM'] }),
  iconPath: text('icon_path'),
  idFunctionalityType: bigint('id_functionality_type', { mode: 'number' }).references(() => functionalityType.idFunctionalityType),
  functionalityLink: text('functionality_link'),
  openInNewTab: smallint('open_in_new_tab').notNull().default(1),
  itemTranslation: jsonb('item_translation'),
  isImmutable: smallint('is_immutable').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (t) => [
  index('menu_entry_parent_order_idx').on(t.idParent, t.orderPosition),
  index('menu_entry_permission_idx').on(t.idPermission),
])

export const menuEntryTag = pgTable('menu_entry_tag', {
  idMenuEntry: bigint('id_menu_entry', { mode: 'number' }).notNull().references(() => menuEntry.idMenuEntry, { onDelete: 'cascade' }),
  tagLan: varchar('tag_lan', { length: 5 }).notNull(),
  tag: varchar('tag', { length: 50 }).notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.idMenuEntry, t.tagLan, t.tag] })])
```

- [✅] **Step 6: Rigenerare lo snapshot e far girare tutto**

```bash
node ../../devops/db/db.mjs schema-write
npm run schema:check && npm run typecheck && npm run test && npm run test:integration
```

`lib/schema-contract.integration.test.ts` va aggiornato con le due tabelle nuove: è il test che verifica che il catalogo distribuito coincida col modello Drizzle, e due tabelle in più sono esattamente ciò che deve notare.

- [✅] **Step 7: Commit**

```bash
git add sources/devops/db/ sources/microservices/web-construct/lib/
git commit -m "feat(rbac): tabelle menu_entry e menu_entry_tag, con travaso

La voce di menu esce dal permesso. id_permission nullo significa voce
pubblica e sostituisce no_permission_need_for_navigation; on delete restrict
fa fallire con un messaggio la cancellazione di un permesso ancora puntato.

L'id della voce riusa l'id del permesso, cosi' le rotte /embedded/{id} gia'
emesse continuano a risolvere. E' l'unico punto in cui i due mondi
condividono un numero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: La barra laterale legge da `menu_entry`

Primo task che cambia un percorso di lettura. Il criterio è che la barra laterale resti **identica**, quindi i test esistenti di `sidebar-adapter` sono la rete di sicurezza e vanno riscritti sui tipi nuovi, non cancellati.

**Files:**
- Modify: `lib/rbac/sidebar-adapter.ts`, `lib/rbac/sidebar-adapter.test.ts`
- Modify: `lib/rbac/navigation-service.ts`
- Modify: `lib/rbac/types.ts`

**Interfaces:**
- Consumes: `menuEntry`, `menuEntryTag` (Task 3); `permission`, `rolePermission` (Task 1).
- Produces:
  - `interface MenuEntryRow { id_menu_entry: number; id_permission: number | null; id_parent: number | null; name: string | null; order_position: number; navbar_position: 'TOP' | 'BOTTOM' | null; icon_path: string | null; id_functionality_type: number | null; functionality_link: string | null; open_in_new_tab: number; item_translation: Record<string, ItemTranslation> | null; is_immutable: number }`
  - `resolveGrantedPermissionIds(rolePermissions: { id_role: number; id_permission: number }[], roleIds: number[]): Set<number>`
  - `mapMenuToSidebar(entries: MenuEntryRow[], grantedIds: Set<number>, locale?: Locale, fallbackLocale?: Locale): MenuItem[]`
  - `getSidebarMenu(roleIds: number[], locale?: Locale, fallbackLocale?: Locale): Promise<MenuItem[]>` — firma invariata.

- [✅] **Step 1: Scrivere il test che fallisce**

In `lib/rbac/sidebar-adapter.test.ts`, sostituire i casi che costruivano `NavigationItemRow` con:

```ts
import { describe, expect, it } from 'vitest'
import { mapMenuToSidebar, resolveGrantedPermissionIds } from './sidebar-adapter'
import type { MenuEntryRow } from './types'

const voce = (over: Partial<MenuEntryRow> & { id_menu_entry: number }): MenuEntryRow => ({
  id_permission: null, id_parent: null, name: `voce-${over.id_menu_entry}`,
  order_position: 0, navbar_position: null, icon_path: null,
  id_functionality_type: 1, functionality_link: null, open_in_new_tab: 1,
  item_translation: null, is_immutable: 0, ...over,
})

describe('mapMenuToSidebar', () => {
  it('mostra la voce pubblica anche senza nessuna concessione', () => {
    const out = mapMenuToSidebar([voce({ id_menu_entry: 7, id_permission: null })], new Set())
    expect(out.map(m => m.id)).toEqual(['7'])
  })

  it('nasconde la voce il cui permesso non è concesso', () => {
    const out = mapMenuToSidebar([voce({ id_menu_entry: 8, id_permission: 42 })], new Set())
    expect(out).toEqual([])
  })

  it('mostra la voce il cui permesso è concesso', () => {
    const out = mapMenuToSidebar([voce({ id_menu_entry: 8, id_permission: 42 })], new Set([42]))
    expect(out.map(m => m.id)).toEqual(['8'])
  })

  // La risalita agli antenati sparisce: una categoria è un contenitore del
  // proprio albero, e si mostra se contiene qualcosa di visibile. Non serve
  // più cercare concessioni sui genitori, perché i genitori non sono permessi.
  it('mostra la categoria che contiene una voce visibile, e non quella vuota', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 1, id_permission: null, id_functionality_type: null }),
      voce({ id_menu_entry: 2, id_permission: 42, id_parent: 1 }),
      voce({ id_menu_entry: 3, id_permission: null, id_functionality_type: null }),
      voce({ id_menu_entry: 4, id_permission: 99, id_parent: 3 }),
    ], new Set([42]))
    expect(out.map(m => m.id).sort()).toEqual(['1', '2'])
  })

  it('due voci sullo stesso permesso si mostrano entrambe', () => {
    const out = mapMenuToSidebar([
      voce({ id_menu_entry: 10, id_permission: 42 }),
      voce({ id_menu_entry: 11, id_permission: 42 }),
    ], new Set([42]))
    expect(out.map(m => m.id).sort()).toEqual(['10', '11'])
  })
})

describe('resolveGrantedPermissionIds', () => {
  it('tiene solo le concessioni dei ruoli dell\'utente', () => {
    const granted = resolveGrantedPermissionIds(
      [{ id_role: 1, id_permission: 10 }, { id_role: 2, id_permission: 20 }],
      [1],
    )
    expect([...granted]).toEqual([10])
  })
})
```

- [✅] **Step 2: Eseguirlo e verificare che fallisca**

```bash
npm run test -- lib/rbac/sidebar-adapter.test.ts
```

Atteso: FAIL — `mapMenuToSidebar is not a function`.

- [✅] **Step 3: Riscrivere `sidebar-adapter.ts`**

`resolveAuthorizedItemIds`, `isRenderable`, `isUnderOperations` e `resolveVisibleIds` spariscono. Al loro posto:

```ts
import type { MenuItem, MenuPosition } from '@/types/menu'
import { type MenuEntryRow, type Locale, DEFAULT_LOCALE, FUNCTYPE_EMBEDDED_PAGE, FUNCTYPE_EXTERNAL_LINK } from './types'
import { resolveNavigationText } from './navigation-locales'

/** Presenza della riga = concessione (DEC-7): non c'è più un flag da leggere. */
export function resolveGrantedPermissionIds(
  rolePermissions: { id_role: number; id_permission: number }[],
  roleIds: number[],
): Set<number> {
  const roleSet = new Set(roleIds)
  const ids = new Set<number>()
  for (const rp of rolePermissions) if (roleSet.has(rp.id_role)) ids.add(rp.id_permission)
  return ids
}

/** id_permission nullo = voce pubblica. Sostituisce no_permission_need_for_navigation. */
function isEntryVisible(entry: MenuEntryRow, grantedIds: Set<number>): boolean {
  return entry.id_permission === null || grantedIds.has(entry.id_permission)
}

function normalizeRoute(link: string | null): string | undefined {
  if (!link) return undefined
  if (link.startsWith('/') || link.startsWith('http')) return link
  return '/' + link
}

/**
 * Una categoria è un contenitore: si mostra se contiene qualcosa di visibile.
 * Prima serviva risalire i genitori di ogni foglia concessa, perché categoria e
 * permesso erano la stessa riga e una sezione appena creata non aveva
 * concessioni proprie. Ora i genitori non sono permessi e la risalita non serve.
 */
function resolveVisibleIds(entries: MenuEntryRow[], grantedIds: Set<number>): Set<number> {
  const byId = new Map(entries.map(e => [e.id_menu_entry, e]))
  const visible = new Set<number>()
  for (const entry of entries) {
    const isContainer = entry.id_functionality_type === null
    if (isContainer || !isEntryVisible(entry, grantedIds)) continue
    visible.add(entry.id_menu_entry)
    let parent = entry.id_parent != null ? byId.get(entry.id_parent) : undefined
    while (parent && !visible.has(parent.id_menu_entry)) {
      visible.add(parent.id_menu_entry)
      parent = parent.id_parent != null ? byId.get(parent.id_parent) : undefined
    }
  }
  return visible
}

export function mapMenuToSidebar(
  entries: MenuEntryRow[],
  grantedIds: Set<number>,
  locale: Locale = DEFAULT_LOCALE,
  fallbackLocale: Locale = DEFAULT_LOCALE,
): MenuItem[] {
  const visible = resolveVisibleIds(entries, grantedIds)
  const out: MenuItem[] = []
  for (const entry of entries) {
    if (!visible.has(entry.id_menu_entry)) continue
    const isContainer = entry.id_functionality_type === null
    const position: MenuPosition =
      entry.navbar_position === 'TOP' ? 'top' : entry.navbar_position === 'BOTTOM' ? 'bottom' : 'main'
    out.push({
      id: String(entry.id_menu_entry),
      label: resolveNavigationText(entry.item_translation, 'name', locale, fallbackLocale, entry.name),
      icon: entry.icon_path ?? undefined,
      route: isContainer
        ? undefined
        : entry.id_functionality_type === FUNCTYPE_EMBEDDED_PAGE
          ? `/embedded/${entry.id_menu_entry}`
          : normalizeRoute(entry.functionality_link),
      type: isContainer ? 'container' : 'link',
      target: entry.id_functionality_type === FUNCTYPE_EXTERNAL_LINK
        ? (entry.open_in_new_tab === 0 ? '_self' : '_blank')
        : undefined,
      parentId: entry.id_parent == null ? null : String(entry.id_parent),
      order: entry.order_position,
      visible: true,
      active: true,
      position,
      collapsible: isContainer ? true : undefined,
      system: entry.is_immutable === 1,
    })
  }
  const emitted = new Set(out.map(m => m.id))
  return out.filter(m => m.parentId === null || emitted.has(m.parentId))
}
```

Aggiungere `MenuEntryRow` a `lib/rbac/types.ts` con la forma indicata nel blocco **Interfaces**.

- [✅] **Step 4: Aggiornare `navigation-service.ts`**

```ts
export const getSidebarMenu = cache(async (
  roleIds: number[],
  locale: Locale = DEFAULT_LOCALE,
  fallbackLocale: Locale = DEFAULT_LOCALE,
): Promise<MenuItem[]> => {
  const [entryRows, grantRows] = await Promise.all([
    db.select().from(menuEntry).orderBy(asc(menuEntry.orderPosition)),
    roleIds.length
      ? db
          .select({ id_role: rolePermission.idRole, id_permission: rolePermission.idPermission })
          .from(rolePermission)
          .where(inArray(rolePermission.idRole, roleIds))
      : Promise.resolve([]),
  ])
  const entries = entryRows.map(toMenuEntryRow)
  const granted = resolveGrantedPermissionIds(grantRows, roleIds)
  return mapMenuToSidebar(entries, granted, locale, fallbackLocale)
})
```

`toMenuEntryRow` è il gemello di `toNavigationItemRow`: aggiungerlo a `lib/rbac/nav-row-mapper.ts` mappando ogni campo Drizzle sul corrispondente `snake_case` di `MenuEntryRow`.

- [✅] **Step 5: Eseguire i test e verificare che passino**

```bash
npm run test -- lib/rbac/sidebar-adapter.test.ts
npm run typecheck && npm run test
```

- [✅] **Step 6: Verificare nel browser che la barra laterale sia identica**

Il build che compila non dimostra niente sul rendering. Avviare l'anteprima e confrontare a occhio con la barra laterale di prima:

```bash
npm run dev
```

Aprire l'applicazione, entrare come amministratore, e verificare: le voci sono le stesse, nello stesso ordine, con le stesse icone; le categorie si aprono e si chiudono; un link esterno apre ancora nella scheda giusta; una pagina incorporata si apre ancora su `/embedded/{id}` con lo stesso id di prima.

- [✅] **Step 7: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/
git commit -m "refactor(rbac): la barra laterale legge da menu_entry

resolveAuthorizedItemIds diventa resolveGrantedPermissionIds e legge la
presenza della riga invece del flag authorized. La risalita agli antenati
sparisce: serviva perche' categoria e permesso erano la stessa riga e una
sezione appena creata non aveva concessioni proprie. Ora i genitori del menu
non sono permessi, e una categoria si mostra se contiene qualcosa di visibile.

Spariscono anche isUnderOperations e l'esclusione del tipo PERMISSION: quelle
righe non generano piu' voci, quindi non c'e' piu' niente da escludere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: L'editor delle funzionalità scrive su entrambe le tabelle

`navigation-actions.ts` è il file più denso del perimetro (31 riferimenti). Creare una voce di menu oggi crea una riga sola; ora ne crea due, dentro una transazione.

**Files:**
- Modify: `lib/rbac/navigation-actions.ts`, `lib/rbac/navigation-actions.integration.test.ts`
- Modify: `lib/rbac/functionalities-service.ts`
- Modify: `lib/rbac/nav-tree-builder.ts`, `lib/rbac/nav-tree-builder.test.ts`
- Modify: `lib/rbac/nav-row-mapper.ts`

**Interfaces:**
- Consumes: `menuEntry`, `menuEntryTag`, `replace_menu_entry_tags` (Task 3); `MenuEntryRow`, `toMenuEntryRow` (Task 4).
- Produces: `createNavigationItem`, `updateNavigationItem`, `moveNavigationItem`, `deleteNavigationItem` con firme invariate, che scrivono la coppia permesso+voce.

- [✅] **Step 1: Scrivere il test di integrazione che fallisce**

In `lib/rbac/navigation-actions.integration.test.ts`:

```ts
it('creare una funzionalità crea il permesso e la voce, collegati', async () => {
  const { id } = await createNavigationItem({
    name: 'Rapporti', idItemType: 2, idFunctionalityType: 3,
    functionalityLink: '/rapporti', iconPath: null, idItemParent: null, idRootParent: 0,
    description: 'rapporti', itemTranslation: { IT: { name: 'Rapporti' } }, tagTranslations: {},
  })

  const [voce] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
  expect(voce.idPermission).not.toBeNull()

  const [perm] = await db.select().from(permission).where(eq(permission.idPermission, voce.idPermission!))
  expect(perm.kind).toBe('GRANT')
  expect(perm.origin).toBe('CONSOLE')
  expect(perm.code).toBeTruthy()
})

it('creare una categoria crea la sola voce, senza permesso', async () => {
  const { id } = await createNavigationItem({
    name: 'Sezione', idItemType: 1, idFunctionalityType: null,
    functionalityLink: null, iconPath: null, idItemParent: null, idRootParent: 0,
    description: 'sezione', itemTranslation: { IT: { name: 'Sezione' } }, tagTranslations: {},
  })
  const [voce] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
  expect(voce.idPermission).toBeNull()
})

it('eliminare una funzionalità elimina anche il permesso che aveva creato', async () => {
  const { id } = await createNavigationItem({
    name: 'Effimera', idItemType: 2, idFunctionalityType: 3,
    functionalityLink: '/effimera', iconPath: null, idItemParent: null, idRootParent: 0,
    description: '', itemTranslation: {}, tagTranslations: {},
  })
  const [voce] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
  const idPerm = voce.idPermission!

  await deleteNavigationItem(id)

  expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))).toHaveLength(0)
  expect(await db.select().from(permission).where(eq(permission.idPermission, idPerm))).toHaveLength(0)
})
```

- [✅] **Step 2: Eseguirlo e verificare che fallisca**

```bash
npm run test:integration -- lib/rbac/navigation-actions.integration.test.ts
```

Atteso: FAIL — `voce.idPermission` è `undefined`, la voce non viene creata.

- [✅] **Step 3: Riscrivere le quattro azioni**

> **Corretto il 2026-09-02 (DEC-14).** Una versione precedente di questo piano faceva generare qui un `code` dal nome della voce. È sbagliato: il `code` è il patto con `requirePermission('...')` nel sorgente, e un permesso creato dalla console non ha controparte nel sorgente. **Un permesso di origine `CONSOLE` nasce con `code` nullo**, e `toPermissionCode`/`reserveUniqueCode` non esistono più — le rimuove il task di riparazione che precede questo. Se le trovi ancora in `lib/rbac/navigation-actions.ts`, fermati e segnalalo: vuol dire che quel task non è stato completato.

**Creare** — una funzionalità inserisce due righe, una categoria una sola:

```ts
export async function createNavigationItem(input: CreateNavItemInput): Promise<{ id: number }> {
  await requireAdmin()
  const isCategory = input.idItemType === ITEM_TYPE_CATEGORY

  return db.transaction(async tx => {
    // Una categoria di menu non è un permesso: raggruppa voci, non protegge niente.
    let idPermission: number | null = null
    if (!isCategory) {
      const [created] = await tx.insert(permission).values({
        kind: 'GRANT',
        // Nessun code: lo porta solo un permesso dichiarato dal sorgente (DEC-14).
        // La voce di menu si collega a questo permesso per identificativo.
        origin: 'CONSOLE',
        name: input.name,
        description: input.description,
        itemTranslation: input.itemTranslation,
        idParent: null,
        orderPosition: 0,
      }).returning({ id: permission.idPermission })
      idPermission = created.id
    }

    const [entry] = await tx.insert(menuEntry).values({
      idPermission,
      idParent: input.idItemParent,
      name: input.name,
      idFunctionalityType: input.idFunctionalityType,
      functionalityLink: input.functionalityLink,
      iconPath: input.iconPath,
      openInNewTab: input.openInNewTab === false ? 0 : 1,
      itemTranslation: input.itemTranslation,
      orderPosition: 0,
    }).returning({ id: menuEntry.idMenuEntry })

    await tx.execute(sql`select public.replace_menu_entry_tags(${entry.id}, ${JSON.stringify(
      Object.entries(input.tagTranslations).flatMap(([lan, tags]) => tags.map(tag => ({ tag_lan: lan, tag }))),
    )}::jsonb)`)

    return { id: entry.id }
  })
}
```

**Modificare** — i campi di presentazione vanno sulla voce, le sole etichette sul permesso. Il `code` non si tocca mai in modifica (DEC-3):

```ts
export async function updateNavigationItem(id: number, input: UpdateNavItemInput): Promise<void> {
  await requireAdmin()
  await db.transaction(async tx => {
    const [entry] = await tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)).limit(1)
    if (!entry) throw new Error(`Menu entry ${id} not found`)

    await tx.update(menuEntry).set({
      name: input.name,
      idFunctionalityType: input.idFunctionalityType,
      functionalityLink: input.functionalityLink,
      iconPath: input.iconPath,
      openInNewTab: input.openInNewTab === false ? 0 : 1,
      itemTranslation: input.itemTranslation,
      updatedAt: new Date().toISOString(),
    }).where(eq(menuEntry.idMenuEntry, id))

    if (entry.idPermission !== null) {
      // Il code resta quello di sempre: è il patto col sorgente, non un'etichetta.
      await tx.update(permission).set({
        name: input.name,
        description: input.description,
        itemTranslation: input.itemTranslation,
      }).where(eq(permission.idPermission, entry.idPermission))
    }

    await tx.execute(sql`select public.replace_menu_entry_tags(${id}, ${JSON.stringify(
      Object.entries(input.tagTranslations).flatMap(([lan, tags]) => tags.map(tag => ({ tag_lan: lan, tag }))),
    )}::jsonb)`)
  })
}
```

**Spostare** — tocca il solo albero del menu. Riordinare una voce non muove l'albero dei permessi:

```ts
export async function moveNavigationItem(id: number, move: MoveInput): Promise<void> {
  await requireAdmin()
  await db.update(menuEntry)
    .set({ idParent: move.targetParentId, orderPosition: move.orderPosition })
    .where(eq(menuEntry.idMenuEntry, id))
}
```

Il caso `isVirtualRoot` che l'implementazione attuale gestisce (`targetParentId === ROOT_ID || === OPERATIONS_ID`) diventa `targetParentId === null`: la radice del menu è l'assenza di genitore, non un id speciale. Aggiornare di conseguenza il chiamante nel componente di trascinamento.

**Eliminare** — prima la voce, poi il permesso, e solo se lo ha creato la console:

```ts
export async function deleteNavigationItem(id: number): Promise<void> {
  await requireAdmin()
  await db.transaction(async tx => {
    const [entry] = await tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)).limit(1)
    if (!entry) return

    // L'ordine conta: on delete restrict fa fallire la cancellazione del
    // permesso finché una voce ci punta contro.
    await tx.delete(menuEntry).where(eq(menuEntry.idMenuEntry, id))

    if (entry.idPermission !== null) {
      const [perm] = await tx.select({ origin: permission.origin })
        .from(permission).where(eq(permission.idPermission, entry.idPermission)).limit(1)
      // Un permesso SOURCE non si cancella da qui: lo possiede il sorgente.
      // In Fase 1 non ne esistono ancora, ma il ramo va scritto adesso.
      if (perm?.origin === 'CONSOLE') {
        await tx.delete(permission).where(eq(permission.idPermission, entry.idPermission))
      }
    }
  })
}
```

- [✅] **Step 4: Aggiornare `functionalities-service.ts` e `nav-tree-builder.ts`**

L'albero mostrato dalla pagina Funzionalità è l'albero **del menu**: `loadNavAndTags` legge `menuEntry` e `menuEntryTag`; `buildNavTree` costruisce da `MenuEntryRow`; `mapRowToDto` mappa `id_menu_entry` su `id` e ricava `type` da `id_functionality_type === null ? 'CATEGORY' : 'FUNCTIONALITY'` invece che da `id_item_type`.

`ROOT_ID` (0) e `OPERATIONS_ID` (−1) escono da questo file: le voci di primo livello hanno `id_parent` nullo, e la radice del menu è `null`. Il parametro `root: 'root' | 'operations'` di `getNavigationSubtree` perde significato — la pagina Funzionalità mostra un albero solo. Ridurlo a `getNavigationSubtree(): Promise<UserNavigationTreeDto[]>` e aggiornare i chiamanti in `app/(protected)/(admin)/functionalities/`.

Il filtro `config_visibility === 1` in `buildNavTree` sparisce: quelle righe non hanno generato voci.

- [✅] **Step 5: Eseguire i test e verificare che passino**

```bash
npm run test:integration -- lib/rbac/navigation-actions.integration.test.ts
npm run typecheck && npm run test
```

- [✅] **Step 6: Verificare nel browser il ciclo completo**

```bash
npm run dev
```

Su `/functionalities`: creare una categoria, creare dentro una funzionalità, trascinarla per riordinarla, modificarne il nome e i tag, eliminarla. Dopo ogni passo verificare che la barra laterale rifletta il cambiamento. Il trascinamento è il punto delicato — `onDragMove` e l'indicatore hanno una storia di corse fra rendering.

- [✅] **Step 7: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/ sources/microservices/web-construct/app/
git commit -m "refactor(rbac): l'editor delle funzionalita' scrive permesso e voce

Creare una funzionalita' inserisce due righe in transazione: il permesso con
origin CONSOLE e la voce che ci punta. Una categoria di menu resta una voce
sola — non e' un permesso, e non deve diventarlo.

Spostare agisce sul solo albero del menu: riordinare una voce non muove
l'albero dei permessi. Il code non si tocca in modifica (DEC-3).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: L'albero delle concessioni legge da `permission`

La pagina Ruoli & Permessi smette di mostrare due radici e passa all'albero dei permessi.

**Files:**
- Modify: `lib/rbac/permission-tree.ts`, `lib/rbac/permission-tree.test.ts`
- Modify: `lib/rbac/roles-service.ts`
- Modify: `app/(protected)/(admin)/roles-permissions/[roleId]/page.tsx`
- Modify: `lib/rbac/types.ts`

**Interfaces:**
- Consumes: `permission` con `kind` (Task 2); `rolePermission` (Task 1).
- Produces: `getRoleAuthorizationTree(roleId: number): Promise<UserNavigationTreeDto[]>` — **il secondo parametro `rootName` sparisce**; `buildAuthTree(permissions: PermissionRow[], grantedIds: Set<number>, locale?: Locale): UserNavigationTreeDto[]`; e il tipo:

```ts
export interface PermissionRow {
  id_permission: number
  kind: 'CATEGORY' | 'GRANT'
  code: string | null
  name: string | null
  id_parent: number | null
  order_position: number
  item_translation: Record<string, ItemTranslation> | null
  description: string | null
  deprecated_at: string | null
}
```

- [✅] **Step 1: Scrivere il test che fallisce**

In `lib/rbac/permission-tree.test.ts`:

```ts
const perm = (over: Partial<PermissionRow> & { id_permission: number }): PermissionRow => ({
  kind: 'GRANT', code: `code-${over.id_permission}`, id_parent: null, order_position: 0,
  item_translation: null, description: null, deprecated_at: null, name: null, ...over,
})

it('costruisce un albero solo, senza radici speciali', () => {
  const tree = buildAuthTree([
    perm({ id_permission: 1, kind: 'CATEGORY', code: null }),
    perm({ id_permission: 2, id_parent: 1 }),
  ], new Set([2]))
  expect(tree).toHaveLength(1)
  expect(tree[0].children.map(c => c.id)).toEqual([2])
  expect(tree[0].children[0].authorization).toBe(true)
})

it('non concede mai una categoria: la concessione sta sulle foglie', () => {
  const tree = buildAuthTree([
    perm({ id_permission: 1, kind: 'CATEGORY', code: null }),
    perm({ id_permission: 2, id_parent: 1 }),
  ], new Set([2]))
  expect(tree[0].authorization).toBe(false)
})

it('esclude i permessi deprecati', () => {
  const tree = buildAuthTree([
    perm({ id_permission: 1, deprecated_at: '2026-01-01T00:00:00Z' }),
    perm({ id_permission: 2 }),
  ], new Set())
  expect(tree.map(n => n.id)).toEqual([2])
})
```

- [✅] **Step 2: Eseguirlo e verificare che fallisca**

```bash
npm run test -- lib/rbac/permission-tree.test.ts
```

Atteso: FAIL — `buildAuthTree` riceve ancora `rootId` come terzo parametro.

- [✅] **Step 3: Riscrivere `buildAuthTree`**

Costruire da `id_parent`, partendo dai nodi con `id_parent` nullo invece che da un `rootId`; `type` deriva da `kind` (`'CATEGORY'` → `'CATEGORY'`, `'GRANT'` → `'FUNCTIONALITY'`); `authorization` è `grantedIds.has(id_permission)` e resta `false` per le categorie; le righe con `deprecated_at` non nullo si scartano prima di costruire.

`applyToggle` resta com'è nella sostanza — accendere una categoria accende i discendenti — ma la propagazione va limitata alle foglie `GRANT`: una categoria non riceve mai una riga in `role_permission`.

- [✅] **Step 4: Aggiornare `roles-service.ts` e la pagina**

`getRoleAuthorizationTree` perde il parametro `rootName` e legge:

```ts
const [permRows, grantRows] = await Promise.all([
  db.select().from(permission).where(isNull(permission.deprecatedAt)).orderBy(asc(permission.orderPosition)),
  db.select({ idPermission: rolePermission.idPermission }).from(rolePermission).where(eq(rolePermission.idRole, roleId)),
])
```

In `roles-permissions/[roleId]/page.tsx`, le due chiamate (`'ROOT'` e `'OPERATIONS'`) diventano una sola, e il componente che mostrava i due alberi affiancati ne mostra uno.

- [✅] **Step 5: Eseguire i test e verificare che passino**

```bash
npm run test -- lib/rbac/permission-tree.test.ts
npm run typecheck && npm run test && npm run test:integration
```

- [✅] **Step 6: Verificare nel browser**

```bash
npm run dev
```

Su `/roles-permissions`: aprire un ruolo di servizio, accendere una categoria e verificare che si accendano le foglie sotto, salvare, ricaricare e verificare che le concessioni siano quelle. Poi entrare con un utente che ha quel ruolo e controllare che la barra laterale mostri esattamente le voci concesse.

- [✅] **Step 7: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/ sources/microservices/web-construct/app/
git commit -m "refactor(rbac): l'albero delle concessioni legge da permission

Un albero solo: spariscono il parametro rootName, la radice Operations e la
distinzione fra i due sottoalberi. Le categorie non ricevono mai una riga in
role_permission — la concessione sta sulle foglie, e accendere un ramo le
accende tutte in scrittura.

I permessi deprecati escono dall'albero e conservano le concessioni.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Eliminare le colonne e le tabelle che non servono più

Ultima migrazione della fase. Va per ultima perché fino a qui il codice vecchio poteva ancora leggere le colonne travasate: da adesso non può più, ed è quello il punto.

**Files:**
- Create: `sources/devops/db/migrations/0017_permission_cleanup.sql`
- Modify: `lib/db/schema.ts`
- Modify: `lib/rbac/types.ts`
- Modify: `lib/rbac/permission-schema.integration.test.ts`

**Interfaces:**
- Consumes: tutti i percorsi di lettura e scrittura migrati (Task 4, 5, 6).
- Produces: `permission` ridotta alle colonne di §3.1 della specifica; `role_permission` senza `authorized`.

- [✅] **Step 1: Scrivere il test che fallisce**

```ts
it('lascia su permission le sole colonne del modello', async () => {
  const rows = await db.execute(sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'permission' order by column_name
  `)
  expect(rows.map(r => r.column_name)).toEqual([
    'code', 'date_ins', 'date_mod', 'deprecated_at', 'description', 'id_parent',
    'id_permission', 'is_immutable', 'item_translation', 'kind', 'name',
    'order_position', 'origin',
  ])
})

it('toglie authorized da role_permission', async () => {
  const rows = await db.execute(sql`
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'role_permission' and column_name = 'authorized'
  `)
  expect(rows.length).toBe(0)
})

it('elimina navigation_item_tag e navigation_item_type', async () => {
  expect(await tableExists('navigation_item_tag')).toBe(false)
  expect(await tableExists('navigation_item_type')).toBe(false)
})
```

> Prima di fissare la lista attesa allo Step 1, leggere le colonne effettive (`node ../../devops/db/db.mjs query "select column_name from information_schema.columns where table_name = 'permission' order by column_name"`) e sottrarre quelle che la migrazione elimina. La lista qui sopra è la forma attesa; se `permission` porta colonne che questo piano non ha incontrato, vanno tenute e aggiunte all'elenco, non eliminate di soppiatto.

- [✅] **Step 2: Eseguirlo e verificare che fallisca**

```bash
npm run test:integration -- lib/rbac/permission-schema.integration.test.ts
```

- [✅] **Step 3: Scrivere la migrazione**

```sql
-- Le colonne di presentazione sono su menu_entry dal 0016 e nessuno le legge
-- piu' da qui. Vanno via adesso, non prima: finche' esistevano, un percorso di
-- lettura dimenticato avrebbe continuato a funzionare leggendo dati fermi, ed e'
-- il modo peggiore di scoprire un errore.

alter table public.permission
  drop column id_item_type,
  drop column id_functionality_type,
  drop column functionality_link,
  drop column icon_path,
  drop column navbar_position,
  drop column open_in_new_tab,
  drop column config_visibility,
  drop column no_permission_need_for_navigation,
  drop column external_id,
  drop column click_count,
  drop column created_at,
  drop column updated_at;

-- Le righe a false non erano un divieto: resolveAuthorizedItemIds le ignorava.
delete from public.role_permission where authorized = false;
alter table public.role_permission drop column authorized;

create or replace function public.apply_role_permission_deltas(
  p_role_id bigint, p_grant_ids bigint[], p_revoke_ids bigint[]
) returns void language plpgsql security definer set search_path = public as $$
begin
  if array_length(p_grant_ids, 1) is not null then
    insert into public.role_permission (id_role, id_permission)
      select p_role_id, unnest(p_grant_ids)
      on conflict (id_role, id_permission) do nothing;
  end if;
  if array_length(p_revoke_ids, 1) is not null then
    delete from public.role_permission
      where id_role = p_role_id and id_permission = any(p_revoke_ids);
  end if;
  update public.role set date_mod = now() where id_role = p_role_id;
end $$;

grant execute on function public.apply_role_permission_deltas(bigint, bigint[], bigint[]) to construct_runtime;

drop view if exists public.role_list_view;
create view public.role_list_view with (security_invoker = true) as
  select r.id_role as id, r.description, rt.description as role_type, r.date_ins, r.date_mod,
         (select count(*) from public.user_role ur where ur.id_role = r.id_role) as associated_users,
         exists (select 1 from public.role_permission rp where rp.id_role = r.id_role) as has_permissions
  from public.role r
  left join public.role_type rt on rt.id_role_type = r.id_role_type;

revoke all on table public.role_list_view from public;
grant select on table public.role_list_view to construct_runtime;

drop function if exists public.replace_item_tags(bigint, jsonb);
drop table if exists public.navigation_item_tag;
drop table if exists public.navigation_item_type;
```

> `external_id`, `click_count`, `created_at` e `updated_at` sono nell'elenco perché non hanno lettori nel sorgente. Verificarlo prima di eseguire (`grep -rn "externalId\|clickCount" --include="*.ts" --include="*.tsx" .`): se un lettore esiste, la colonna resta e si toglie dalla lista.

- [✅] **Step 4: Applicare e verificare**

```bash
node ../../devops/db/db.mjs test-apply && node ../../devops/db/db.mjs apply
npm run test:integration
```

- [✅] **Step 5: Ripulire il modello Drizzle e i tipi**

Togliere le colonne eliminate da `permission` e `rolePermission` in `lib/db/schema.ts`, rimuovere `navigationItemTag` e `navigationItemType`. In `lib/rbac/types.ts` eliminare `NavigationItemRow`, `RoleItemRow`, `ITEM_TYPE_CATEGORY`, `ITEM_TYPE_FUNCTIONALITY`, `FUNCTYPE_PERMISSION`, `ROOT_ID`, `OPERATIONS_ID` e ogni altro simbolo rimasto senza consumatori. Il compilatore li elenca.

- [✅] **Step 6: Far girare tutto**

```bash
node ../../devops/db/db.mjs schema-write
npm run schema:check && npm run lint && npm run typecheck && npm run test && npm run test:integration
```

- [✅] **Step 7: Commit**

```bash
git add sources/devops/db/ sources/microservices/web-construct/
git commit -m "refactor(rbac): via le colonne e le tabelle che il modello ha assorbito

permission perde i campi di presentazione, role_permission perde authorized,
navigation_item_tag e navigation_item_type spariscono. Ultima migrazione della
fase, e va per ultima: finche' le colonne esistevano, un percorso di lettura
dimenticato avrebbe continuato a funzionare leggendo dati fermi.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Verifica end-to-end che non sia cambiato niente

Il criterio di successo di questa fase è negativo, e va dimostrato, non affermato.

**Files:**
- Modify: `sources/tests/e2e/` — i test che citano le tabelle o le rotte rinominate
- Modify: `docs/superpowers/specs/2026-09-01-rbac-permission-model-design.md` (spuntare HOLE-3 se il Task 4 lo ha già chiuso)

**Interfaces:**
- Consumes: tutto il lavoro dei Task 1–7.

- [✅] **Step 1: Migrare il database E2E e far girare la suite**

```bash
node sources/devops/db/db.mjs test-apply
uv run pytest
```

Atteso: verde. I fallimenti attesi sono quelli dei test che si appoggiano ai nomi vecchi o al parametro `root=operations` della pagina Funzionalità — vanno aggiornati, non disattivati.

- [✅] **Step 2: Verificare i tre percorsi che la fase ha toccato**

```bash
uv run pytest sources/tests/e2e/test_sidebar.py
```

Poi, a mano nel browser con `npm run dev`, con **due utenti diversi**: un amministratore e un utente con un ruolo di servizio limitato. Per ciascuno confrontare la barra laterale con quella di prima della fase (`git stash` su un ramo pulito è il modo più rapido di avere il termine di paragone). Verificare in particolare che una pagina incorporata si apra ancora sul **suo id di prima** — è l'invariante che la migrazione 0016 protegge riusando l'id.

- [✅] **Step 3: Verificare che la sessione di test non sia quella di sviluppo**

Il database E2E e quello di sviluppo sono diversi, e l'account del database di test non è amministratore. Se la verifica manuale al passo 2 mostra una barra laterale vuota dove ne attendevi una piena, controllare a quale database punta l'anteprima prima di cercare un errore nel codice.

- [✅] **Step 4: Rileggere la specifica e spuntare ciò che questa fase ha chiuso**

Aprire [la specifica](../specs/2026-09-01-rbac-permission-model-design.md) e marcare `- [✅]` gli elementi di §6.4 effettivamente chiusi. HOLE-3 (la pagina incorporata che usa la presenza nel menu come controllo di sicurezza) **non** è chiuso da questa fase: `requirePermission` arriva in Fase 2. Non spuntarlo.

- [✅] **Step 5: Commit**

```bash
git add sources/tests/e2e/ docs/
git commit -m "test(rbac): la suite E2E sui nomi nuovi, e la barra laterale invariata

Il criterio di successo della Fase 1 e' negativo — non deve essere cambiato
niente — e questo lo dimostra su due utenti con ruoli diversi.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Cosa questa fase deliberatamente non fa

- **Non introduce `requirePermission`.** `requireAdmin()` resta esattamente dov'è, e continua a controllare il possesso del ruolo 1. I sette punti che si fidano del token restano tali fino alla Fase 2.
- **Non crea nessun permesso del catalogo.** I 15 codici di §4.2 della specifica arrivano con la sincronizzazione, in Fase 2. Qui i permessi esistenti ricevono un `code` generato dal nome, che la migrazione `0019` azzera subito dopo: per DEC-14 il codice appartiene solo ai permessi dichiarati dal sorgente.
- **Non cambia l'interfaccia.** `/functionalities` resta dov'è e come si chiama; la pagina Ruoli & Permessi perde il secondo albero perché non ha più niente da mostrarci, ma non cambia forma.
- **Non tocca il token.** `roleIds` e `isAdmin` continuano a viaggiarci dentro fino alla Fase 2.
