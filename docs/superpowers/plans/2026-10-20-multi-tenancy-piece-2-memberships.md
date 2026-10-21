# Multi-tenancy, pezzo 2: tenant e appartenenze — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** una persona appartiene a uno o più tenant con uno stato per ciascuno; l'amministratore di
un tenant vede, aggiunge per email esatta e disattiva solo i membri del suo tenant; la piattaforma
crea un tenant da un tenant modello con un comando di `db.mjs`.

**Architecture:** quattro migrazioni nuove (0048–0051) e il codice che le usa, dentro
l'architettura del pezzo 1. L'appartenenza è una tabella di tenant protetta dalla RLS; le regole
che toccano più tenant (ultimo amministratore, "membro altrove", copia dal modello, primo
amministratore) vivono in funzioni SQL `security invoker`, così l'app e il comando le chiamano
con un'istruzione sola. L'autorizzazione legge lo stato dell'appartenenza dentro l'istruzione
unica del lavoro sulle prestazioni, senza viaggi in più.

**Tech Stack:** Next.js 16 (App Router), Auth.js v5, Drizzle ORM 0.45 con postgres.js 3.4
(`prepare: false`), PostgreSQL 15+ (sviluppo su Supabase 17.6), Vitest, pytest + Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-20-multi-tenancy-piece-2-memberships-design.md`](../specs/2026-10-20-multi-tenancy-piece-2-memberships-design.md)
(MT2-DEC-1…12, §2 database, §3 applicazione, §4 test, MT2-OK-1…4, MT2-RISK-1…3). Contesto: la
[specifica del pezzo 1](../specs/2026-10-13-multi-tenancy-foundations-design.md), il suo
[piano](2026-10-13-multi-tenancy-foundations.md) e il
[piano delle prestazioni](2026-10-15-multi-tenancy-performance.md).

**Mappa del codice:** `.superpowers/sdd/piece-2/code-map.md` (ignorata da git) elenca file e righe
esatte toccati da questo piano: convenzioni delle migrazioni, funzioni protette, istruzione unica
dell'autorizzazione, percorsi di accesso, pagina Utenti, `db.mjs`, test da adattare. Chi esegue un
task la legge prima di cominciare.

## Global Constraints

- **Prima del Task 1** il proprietario committa insieme la frase del README, la specifica e questo piano. Nessun task li ricommitta per conto suo, salvo le spunte.
- **Isolamento del pezzo 1 invariato:**
  - `withTenant` e `withGlobal` (`lib/db/tenant-db.ts`) restano le sole porte verso il database dell'app;
  - nessuna funzione `security definer` (lo vietano il contratto di schema e `boundary-check`): ogni funzione nuova è `security invoker set search_path = ''`, con nomi qualificati (`public.users`, `app_private.current_tenant_id()`);
  - ogni funzione nuova chiamata dall'app ha `revoke all on function … from public; grant execute on function … to construct_runtime;`; quelle riservate alla piattaforma hanno solo il `revoke`.
- **Una funzione che cambia `app.tenant_id` lo rimette com'era prima di uscire** (`set_config('app.tenant_id', v_origine, true)`), anche quando esce prima del previsto con `return`.
- **Migrazioni:**
  - nomi `NNNN_snake_name.sql`, intestazione in italiano `-- Multi-tenancy, pezzo 2 (specifica 2026-10-20, §x, MT2-…): …`, sezioni numerate come la 0046;
  - una migrazione già applicata al database di prova non si modifica: ogni task che cambia lo schema aggiunge la sua (0048 Task 1, 0049 Task 5, 0050 Task 6, 0051 Task 7);
  - l'esecutore parte con `app.tenant_id` vuoto: chi scrive tabelle di tenant imposta il tenant con `select set_config('app.tenant_id', …, true)`;
  - dopo ogni migrazione: `node sources/devops/db/db.mjs schema-write`, poi `schema-check`; `lib/db/schema.ts` cambia nello stesso task (il contratto confronta Drizzle e catalogo esattamente).
- **Comandi del database di prova** (dalla radice del repository):
  ```bash
  set -a && . ./sources/devops/db/operator.env && set +a && TEST_DATABASE_DISPOSABLE=1 node sources/devops/db/db.mjs test-apply
  ```
  ```bash
  cd sources/microservices/web-construct && npm run test:integration -- <file>
  ```
- **Database:**
  - non esiste una produzione in uso; il database di sviluppo è alla 0047 e si migra **solo nel Task 8, dopo un sì esplicito del proprietario**;
  - test di integrazione ed E2E solo sul database di prova usa e getta, **mai insieme** (condividono il database); E2E solo con la configurazione `web-construct-e2e`; per un E2E lungo il computer resta sveglio (`caffeinate -dims uv run pytest`).
- **Viaggi verso il database:** i tetti di `lib/db/round-trip-budget.integration.test.ts` non salgono (MT2-RISK-3).
- **Traduzioni:** ogni chiave usata nel codice (`'users.add.title'`) è seminata in una migrazione con `public.apply_translation_seed`, altrimenti il controllo `devops/i18n-key-inventory.test.mjs` fallisce.
- **Lingua:** commenti, messaggi per l'utente e uscita del comando in italiano; commit in inglese, `type(scope): …`, chiusi da `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Checkbox:** quando un elemento MT2-OK o MT2-RISK della specifica è finito e verificato, si segna `- [✅]` nella specifica (AGENTS.md); i task di questo piano si spuntano qui.
- **Base dei test unitari:** gli 8 fallimenti già noti in 4 file `components/Sidebar*.test.tsx` (Node 26, `localStorage` sperimentale) non dipendono da questo lavoro; contano solo i fallimenti in più.

## Review Focus

1. **Il controllo "membro di un altro tenant" lascia la transazione nel tenant sbagliato.** Per
   leggere le appartenenze degli altri tenant la funzione cambia `app.tenant_id`; se non lo
   rimette, le istruzioni successive della stessa transazione scrivono in un altro tenant. → test
   "il contesto torna quello di partenza", Task 1.
2. **Una persona di un'organizzazione separata finisce nel tenant predefinito** registrandosi o
   entrando con Google (MT2-DEC-12). → test di `ensure_default_membership` (Task 1) e del primo
   accesso (Task 2).
3. **Un'appartenenza disattivata torna attiva** da un percorso automatico: primo accesso,
   registrazione, aggiunta per email. → test nei Task 1, 2 e 4.
4. **Una tabella di tenant aggiunta in futuro viene dimenticata dalla copia dal modello**, e i
   tenant nuovi nascono senza quei dati. → la funzione di copia rifiuta di lavorare se il registro
   `app_private.table_class` contiene una tabella di tenant che non conosce; test nel Task 6.
5. **L'email dell'aggiunta scritta con maiuscole o spazi** crea un secondo account invece di
   trovare quello esistente. → test con `'  Persona@Esempio.IT '`, Task 4.

---

## Mappa dei file

| File | Responsabilità | Task |
|---|---|---|
| `devops/db/migrations/0048_tenant_membership.sql` | appartenenze, regola dell'ultimo amministratore, ingresso nel predefinito | 1 |
| `devops/db/migrations/0049_users_add_translations.sql` | chiavi `users.add.*` | 5 |
| `devops/db/migrations/0050_tenant_template.sql` | colonna `is_template`, funzioni di copia, creazione del modello | 6 |
| `devops/db/migrations/0051_tenant_admin_registration.sql` | `register_tenant_admin` | 7 |
| `devops/db/schema.sql` | generato da `schema-write` | 1, 5, 6, 7 |
| `web-construct/lib/db/schema.ts` | `tenantMembership`, `tenant.isTemplate`, FK di `user_role` | 1, 6 |
| `web-construct/lib/db/testing.ts` | `deleteTenantForTest` | 6 |
| `web-construct/lib/tenancy/membership.ts` | tipo e letture dell'appartenenza, ingresso nel predefinito, aggiunta di un membro | 2, 3, 4 |
| `web-construct/lib/tenancy/tenant-membership.integration.test.ts` | isolamento, ultimo amministratore, `not_a_member`, ingresso nel predefinito | 1 |
| `web-construct/lib/auth-policy.ts` | `evaluateAuthorization` con l'appartenenza | 2 |
| `web-construct/lib/rbac/auth-roles.ts` | stato dell'appartenenza nell'istruzione unica, primo accesso | 2 |
| `web-construct/lib/auth.ts` | rifiuto all'accesso per appartenenza disattivata | 3 |
| `web-construct/lib/invitation-email.ts` | link e invio dell'email d'invito, oggi duplicati | 3 |
| `web-construct/app/api/auth/register/route.ts`, `app/api/admin/send-invite/route.ts` | usano `invitation-email.ts`; la registrazione crea l'appartenenza | 3 |
| `web-construct/lib/rbac/users-service.ts`, `users-actions.ts`, `types.ts`, `user-mappers.ts`, `user-management-loader.ts` | elenco dai membri, stato per tenant, `addUserByEmail` | 4 |
| `web-construct/components/rbac/users/AddUserDialog.tsx`, `UsersTableClient.tsx`, `app/(protected)/(admin)/user-management/page.tsx` | "Aggiungi persona" | 5 |
| `web-construct/lib/tenancy/tenant-template.integration.test.ts` | copia dal modello | 6 |
| `devops/db/migration-lib.mjs`, `migration-lib.test.mjs`, `db.mjs` | `tenant-create`, `test-tenant-create` | 7 |
| `web-construct/lib/tenancy/tenant-create-command.integration.test.ts` | il comando e MT2-OK-4 | 7 |
| `tests/e2e/test_users.py` | aggiunta per email dal browser | 5 |
| `README.md`, specifica, documento delle cose rimandate | comandi, spunte | 7, 8 |

`web-construct/` sta per `sources/microservices/web-construct/`; `devops/` per `sources/devops/`.

---

### Task 1: Appartenenze nel database e regola dell'ultimo amministratore per tenant (§2.1, §2.2, §2.5, MT2-DEC-1, 3, 4, 12)

**Files:**
- Create: `devops/db/migrations/0048_tenant_membership.sql`
- Create: `web-construct/lib/tenancy/tenant-membership.integration.test.ts`
- Modify: `web-construct/lib/db/schema.ts`, `devops/db/schema.sql`
- Modify (fixture con `user_role`, che ora richiede l'appartenenza): `web-construct/lib/auth-security.integration.test.ts`, `lib/rbac/loaders.integration.test.ts`, `lib/rbac/auth-roles.integration.test.ts`, `lib/rbac/actor.integration.test.ts`, `lib/rbac/users-actions.integration.test.ts`, `lib/rbac/users-actions-grants.integration.test.ts`, `lib/db/tenant-isolation.integration.test.ts`, `lib/db/round-trip-budget.integration.test.ts`

**Interfaces:**
- Produces (SQL, tutte nel tenant corrente):
  - tabella `public.tenant_membership (id_tenant, user_id, status, created_at, updated_at)`, PK `(id_tenant, user_id)`, indice `tenant_membership_user_id_idx (user_id)`, trigger `tenant_membership_updated_at`;
  - `user_role_membership_fkey`: `user_role (id_tenant, user_id)` → `tenant_membership` on delete cascade;
  - `app_private.count_active_admins() returns bigint` — appartenenza `active`, `users.id_user_status = 2`, ruolo con `system_key = 'TENANT_ADMIN'`;
  - `public.replace_user_roles_guarded(p_user_id uuid, p_role_ids bigint[])` — come oggi, più `not_a_member`;
  - `public.set_membership_status_guarded(p_user_id uuid, p_status text) returns void`;
  - `app_private.is_member_elsewhere(p_user_id uuid) returns boolean`;
  - `public.ensure_default_membership(p_user_id uuid) returns text` — stato dell'appartenenza nel tenant corrente dopo la chiamata, o `null`.
- Produces (Drizzle): `tenantMembership` in `lib/db/schema.ts`, con `status: text('status', { enum: ['active', 'deactivated'] })`.

- [✅] **Step 1: Scrivi i test che falliscono**

In `lib/tenancy/tenant-membership.integration.test.ts`, con due tenant: il predefinito e un tenant
B creato in `beforeAll` con `withOwner` (come fa `lib/db/tenant-isolation.integration.test.ts`),
con i suoi ruoli `REGISTERED` e `TENANT_ADMIN`. `afterAll` cancella appartenenze, ruoli, utenti e
tenant di prova.

```ts
it('a member of B is invisible and untouchable from the default tenant', async () => {
  // membro solo di B
  expect(await withTenant(defaultTestTenant(), tx => tx.select().from(tenantMembership).where(eq(tenantMembership.userId, onlyB)))).toEqual([])
  const updated = await withTenant(defaultTestTenant(), tx => tx.update(tenantMembership).set({ status: 'deactivated' }).where(eq(tenantMembership.userId, onlyB)).returning())
  expect(updated).toEqual([])
})
it('replace_user_roles_guarded refuses a non-member with not_a_member', …)           // errore con message 'not_a_member'
it('the last active admin of the default tenant cannot be deactivated even if B has admins', …) // 'last_active_administrator'
it('deactivating a membership in the default tenant leaves B and users.id_user_status untouched', …)
it('set_membership_status_guarded rejects an unknown status with invalid_user_status', …)
it('deleting a membership removes its roles in that tenant', …)                       // cascata della FK
it('ensure_default_membership creates an active membership for an unaffiliated user', …)   // ritorna 'active'
it('ensure_default_membership never reactivates a deactivated membership', …)          // ritorna 'deactivated', riga invariata
it('ensure_default_membership creates nothing for a member of B', …)                   // ritorna null, nessuna riga nel predefinito
it('ensure_default_membership creates nothing when the current tenant is not the default', …) // chiamata con il contesto di B
it('ensure_default_membership leaves app.tenant_id as it found it', async () => {
  const after = await withTenant(defaultTestTenant(), async tx => {
    await tx.execute(sql`select public.ensure_default_membership(${memberOfB}::uuid)`)
    return tx.execute(sql`select current_setting('app.tenant_id') as t`)
  })
  expect(after[0].t).toBe(String(defaultTestTenant()))
})
```

Per le asserzioni sugli errori usa lo stesso modo dei test esistenti di
`users-actions.integration.test.ts` (messaggio dell'eccezione Postgres).

- [✅] **Step 2: Verifica che falliscano**

Run: `cd sources/microservices/web-construct && npm run test:integration -- lib/tenancy/tenant-membership.integration.test.ts`
Expected: FAIL, `relation "public.tenant_membership" does not exist` o import mancante di `tenantMembership`.

- [✅] **Step 3: Scrivi la migrazione 0048**

Sezioni, in quest'ordine:

1. **Tabella.** `id_tenant bigint not null default app_private.current_tenant_id() references public.tenant(id)`, `user_id uuid not null references public.users(id) on delete cascade`, `status text not null default 'active' check (status in ('active', 'deactivated'))`, `created_at`/`updated_at timestamptz not null default now()`; PK `tenant_membership_pkey (id_tenant, user_id)`; indice `tenant_membership_user_id_idx (user_id)`; trigger `before update … execute function public.set_updated_at()`; `select app_private.protect_tenant_table('public.tenant_membership'::regclass);`.
2. **Appartenenze di oggi** (§2.2): imposta il tenant predefinito (`select set_config('app.tenant_id', (select id::text from public.tenant where slug = 'default'), true);`) e inserisci un'appartenenza `active` per **ogni** riga di `public.users`, con o senza ruoli.
3. **FK** `user_role_membership_fkey` da `user_role (id_tenant, user_id)` a `tenant_membership (id_tenant, user_id)` on delete cascade.
4. **`app_private.count_active_admins()`** e `grant execute … to construct_runtime`.
5. **`replace_user_roles_guarded`** (`create or replace`, corpo di partenza in `0046_tenant_schema.sql:210`): stesso lock `pg_advisory_xact_lock(49374202, v_tenant::integer)` e stessi errori nello stesso ordine; dopo `user_not_found` aggiungi `not_a_member` se non esiste un'appartenenza (in qualunque stato) nel tenant corrente; il controllo finale usa `app_private.count_active_admins() = 0`.
6. **`set_membership_status_guarded(p_user_id uuid, p_status text)`**: stesso lock; `invalid_user_status` se `p_status` non è `active` o `deactivated`; `not_a_member` se l'appartenenza non esiste; aggiorna `status`; `last_active_administrator` se `count_active_admins() = 0`. Grant a `construct_runtime`.
7. **`set_user_status_guarded`** (`create or replace`, `0046:252`): invariata, salvo il conteggio degli amministratori, che usa `count_active_admins()`. Commento: riservata alla piattaforma, l'app non la chiama più.
8. **`app_private.is_member_elsewhere(p_user_id uuid) returns boolean`**: salva `v_origine := current_setting('app.tenant_id', true)`; per ogni `id` di `public.tenant` diverso dal corrente imposta `set_config('app.tenant_id', id::text, true)` e controlla se esiste un'appartenenza (qualunque stato); rimette `v_origine` prima di **ogni** `return`. Grant a `construct_runtime` (la chiama la funzione sotto, con i diritti di chi chiama).
9. **`public.ensure_default_membership(p_user_id uuid) returns text`**, in quest'ordine: se esiste l'appartenenza nel tenant corrente ritorna il suo stato; se il tenant corrente non ha slug `default` ritorna `null`; se `is_member_elsewhere` ritorna `null`; altrimenti inserisce `active` (`on conflict do nothing`) e ritorna `'active'`. Grant a `construct_runtime`.

- [✅] **Step 4: Schema Drizzle e fixture**

- `lib/db/schema.ts`: `tenantMembership` dichiarata prima di `userRole`, con `tenantIdColumn()`, PK `tenant_membership_pkey`, indice `tenant_membership_user_id_idx`, `references(() => users.id, { onDelete: 'cascade' })`; in `userRole` la `foreignKey` `user_role_membership_fkey` con `.onDelete('cascade')`.
- Negli 8 file di integrazione elencati sopra, ogni fixture che inserisce `user_role` inserisce prima l'appartenenza `active` nello stesso tenant; ogni `afterAll` che cancella utenti o tenant di prova cancella anche le appartenenze (o si affida alla cascata da `users`).

- [✅] **Step 5: Applica e rigenera lo schema**

```bash
set -a && . ./sources/devops/db/operator.env && set +a && TEST_DATABASE_DISPOSABLE=1 node sources/devops/db/db.mjs test-apply
```
```bash
node sources/devops/db/db.mjs schema-write && node sources/devops/db/db.mjs schema-check
```
Expected: `0048_tenant_membership` applicata; `schema.sql matches ordered migrations`.

- [✅] **Step 6: Verifica che passino**

Run: `cd sources/microservices/web-construct && npm run test:integration`
Expected: PASS, compresi `lib/schema-contract.integration.test.ts` (la tabella nuova è di tenant, con le due policy, indice in testa `id_tenant` e FK composte) e i tetti dei viaggi.

Run (dalla radice; `TEST_DATABASE_URL` sta in `.env.test.local`): `set -a && . ./sources/microservices/web-construct/.env.test.local && set +a && DATABASE_URL="$TEST_DATABASE_URL" node sources/devops/db/db.mjs boundary-check`
Expected: nessuna violazione.

- [✅] **Step 7: Commit**

```bash
git add sources/devops/db/migrations/0048_tenant_membership.sql sources/devops/db/schema.sql sources/microservices/web-construct/lib
git commit -m "feat(tenancy): tenant memberships and per-tenant last-admin rule"
```

---

### Task 2: Autorizzazione con l'appartenenza e primo accesso nel predefinito (§3.1, MT2-OK-2, MT2-RISK-3)

**Files:**
- Create: `web-construct/lib/tenancy/membership.ts`
- Modify: `web-construct/lib/auth-policy.ts`, `lib/auth-policy.test.ts`, `lib/rbac/auth-roles.ts`, `lib/rbac/actor.ts`, `lib/rbac/actor.test.ts`, `lib/rbac/auth-guard.test.ts`
- Test: `web-construct/lib/rbac/auth-roles.integration.test.ts`, `lib/rbac/actor.integration.test.ts`, `lib/auth-security.integration.test.ts`

**Interfaces:**
- Consumes: `public.ensure_default_membership` (Task 1), `tenantMembership` (Task 1).
- Produces:
  - in `lib/tenancy/membership.ts`: `type MembershipStatus = 'active' | 'deactivated'`; `MEMBERSHIP_ACTIVE`, `MEMBERSHIP_DEACTIVATED`; `isMembershipStatus(value: unknown): value is MembershipStatus`; `ensureDefaultMembership(tx: TenantTx, userId: string): Promise<MembershipStatus | null>` (chiama la funzione SQL);
  - `evaluateAuthorization(status: number | null | undefined, membershipStatus: MembershipStatus | null, roleIds: number[], adminRoleId: number)` → stesso risultato di oggi; `accountActive` = account attivo **e** `membershipStatus === 'active'`;
  - `AuthorizationSnapshot` con il campo in più `membershipStatus: MembershipStatus | null`.

- [✅] **Step 1: Scrivi i test che falliscono**

`lib/auth-policy.test.ts`:

```ts
it('needs an active membership as well as an active account', () => {
  expect(evaluateAuthorization(2, 'active', [0, 1], 1)).toEqual({ accountActive: true, roleIds: [0, 1], isAdmin: true })
  expect(evaluateAuthorization(2, 'deactivated', [0, 1], 1)).toEqual({ accountActive: false, roleIds: [], isAdmin: false })
  expect(evaluateAuthorization(2, null, [0, 1], 1)).toEqual({ accountActive: false, roleIds: [], isAdmin: false })
  expect(evaluateAuthorization(1, 'active', [0, 1], 1)).toEqual({ accountActive: false, roleIds: [], isAdmin: false })
})
```

`lib/rbac/auth-roles.integration.test.ts` (tenant B come nel Task 1):

```ts
it('a person active in the default tenant and deactivated in B is authorized only in the default tenant', …)
// resolveUserAuthorization(default).accountActive === true; resolveUserAuthorization(B).accountActive === false
it('a person with no membership in B is not authorized in B', …)
it('first sign-in creates the default membership and the base role', …)
// resolveUserAuthorization(default, nuovo, true) → membership 'active' e ruolo REGISTERED nel predefinito; nessuna riga in B
it('first sign-in creates nothing in the default tenant for a member of B', …)
it('first sign-in leaves a deactivated default membership deactivated and adds no role', …)
```

`lib/rbac/actor.integration.test.ts`: `resolveActor(B, userId)` è `null` per chi è disattivato in B e
non `null` nel predefinito.

- [✅] **Step 2: Verifica che falliscano**

Run: `cd sources/microservices/web-construct && npx vitest run lib/auth-policy.test.ts`
Expected: FAIL, il secondo caso dà `accountActive: true`.

Run: `npm run test:integration -- lib/rbac/auth-roles.integration.test.ts lib/rbac/actor.integration.test.ts`
Expected: FAIL sui casi nuovi.

- [✅] **Step 3: Implementa**

- `selectAuthorizationSnapshot` (`lib/rbac/auth-roles.ts:33`): aggiungi alla stessa istruzione la sottoquery scalare `(select m.status from public.tenant_membership m where m.user_id = ${userId}) as membership_status`, convertita con `isMembershipStatus` (altro valore → `null`).
- `evaluateAuthorization` con il nuovo secondo parametro; aggiorna i chiamanti (`auth-roles.ts`, `actor.ts`) e i test unitari che costruiscono l'autorizzazione (`actor.test.ts`, `auth-guard.test.ts`).
- `selectUserAuthorization(tx, userId, ensureRegisteredRole)`: con `ensureRegisteredRole`, **prima** dell'istruzione unica chiama `ensureDefaultMembership(tx, userId)`; dopo, il ruolo base si aggiunge solo se `accountActive` (non più solo `status === ACTIVE_USER_STATUS`). Senza `ensureRegisteredRole` nessuna istruzione in più.

- [✅] **Step 4: Verifica che passino**

Run: `npx vitest run lib/auth-policy.test.ts lib/rbac/actor.test.ts lib/rbac/auth-guard.test.ts`
Expected: PASS.

Run: `npm run test:integration -- lib/rbac lib/auth-security.integration.test.ts lib/db/round-trip-budget.integration.test.ts`
Expected: PASS; i tetti (`resolveUserAuthorization` ≤5, `resolveActor` ≤5, pagina utenti ≤11) invariati.

- [✅] **Step 5: Spunta MT2-RISK-3 nella specifica e commit**

```bash
git add sources/microservices/web-construct/lib docs/superpowers/specs/2026-10-20-multi-tenancy-piece-2-memberships-design.md
git commit -m "feat(rbac): authorization requires an active tenant membership"
```

---

### Task 3: Accesso respinto per appartenenza disattivata, registrazione nel predefinito (§3.1)

**Files:**
- Create: `web-construct/lib/invitation-email.ts`, `web-construct/lib/invitation-email.test.ts`
- Modify: `web-construct/lib/tenancy/membership.ts`, `lib/auth.ts`, `app/api/auth/register/route.ts`, `app/api/admin/send-invite/route.ts`
- Test: `web-construct/lib/tenancy/tenant-membership.integration.test.ts`, `app/api/auth/register/route.test.ts` (crealo se non esiste)

**Interfaces:**
- Consumes: `ensureDefaultMembership`, `MembershipStatus` (Task 2); `resolveRequestTenant()`; `PreparedInvitation`, `recordInvitationDelivery` (`lib/auth-invitations.ts`).
- Produces:
  - in `lib/tenancy/membership.ts`: `isMembershipDeactivated(tenantId: TenantId, userId: string): Promise<boolean>` (`true` solo se la riga esiste ed è `deactivated`); `joinDefaultTenant(userId: string): Promise<MembershipStatus | null>` (`withTenant(await resolveRequestTenant(), tx => ensureDefaultMembership(tx, userId))`);
  - in `lib/invitation-email.ts`: `buildSetPasswordLink(baseUrl: string, rawToken: string): string`; `sendInvitationEmail(invitation: PreparedInvitation): Promise<{ ok: true } | { ok: false; code: string }>` — legge `AUTH_URL ?? NEXTAUTH_URL`, manda l'email di oggi e registra l'esito con `recordInvitationDelivery`, come fanno ora le due rotte.

- [✅] **Step 1: Scrivi i test che falliscono**

`lib/invitation-email.test.ts`:

```ts
it('builds the set-password link without a double slash', () => {
  expect(buildSetPasswordLink('https://app.example.it/', 'abc')).toBe('https://app.example.it/set-password?token=abc')
})
it('records server_configuration when no base URL is set', …)   // mock di mailer e recordInvitationDelivery
```

`lib/tenancy/tenant-membership.integration.test.ts`: `isMembershipDeactivated` è `true` per una
riga `deactivated`, `false` per una `active` e per chi non ha la riga.

`app/api/auth/register/route.test.ts` (mock di `prepareInvitation`, `sendInvitationEmail`,
`joinDefaultTenant`, `withGlobal` per i domini consentiti, `enforceAuthRateLimit`): per un'email di
un dominio consentito chiama `joinDefaultTenant(invitation.userId)` prima di `sendInvitationEmail`
e risponde `{ ok: true }`; quando `prepareInvitation` dà `null` non chiama nessuno dei due.

- [✅] **Step 2: Verifica che falliscano**

Run: `cd sources/microservices/web-construct && npx vitest run lib/invitation-email.test.ts app/api/auth/register/route.test.ts`
Expected: FAIL, modulo `@/lib/invitation-email` mancante.

- [✅] **Step 3: Implementa**

- Sposta link, testo e HTML dell'email da `register/route.ts` e `send-invite/route.ts` in `lib/invitation-email.ts`; le due rotte lo usano e rispondono come oggi.
- `register/route.ts`: dopo `prepareInvitation`, `await joinDefaultTenant(invitation.userId)`, poi l'invio.
- `lib/auth.ts`:
  - `authorize` (`:85`): solo **dopo** che `verifyCredentialCandidate` è riuscita, `if (await isMembershipDeactivated(await resolveRequestTenant(), user.id))` → registra il motivo `'membership'` e ritorna `null`, come un account disattivato;
  - provider `test` (`:131`): stesso controllo dopo `isActiveAccount`;
  - callback `signIn` (`:165`): per un utente OIDC esistente, `false` anche se `isMembershipDeactivated(...)`.
  Il messaggio mostrato a chi entra resta quello di oggi.

- [✅] **Step 4: Verifica che passino**

Run: `npx vitest run lib/invitation-email.test.ts app/api/auth/register/route.test.ts && npm run test:integration -- lib/tenancy/tenant-membership.integration.test.ts lib/auth-security.integration.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: nessun errore; solo gli 8 fallimenti noti di `Sidebar*`.

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib sources/microservices/web-construct/app
git commit -m "feat(auth): refuse sign-in for deactivated memberships; registration joins the default tenant"
```

---

### Task 4: Pagina Utenti dai membri, disattivazione per tenant, aggiunta per email (§3.2, MT2-DEC-5, 6, MT2-OK-3)

**Files:**
- Modify: `web-construct/lib/tenancy/membership.ts`, `lib/rbac/users-service.ts`, `lib/rbac/users-service.test.ts`, `lib/rbac/users-actions.ts`, `lib/rbac/types.ts`, `lib/rbac/user-mappers.ts`, `lib/rbac/user-mappers.test.ts`, `lib/rbac/user-management-loader.ts`, `components/rbac/users/ManageRolesModal.truncation.test.tsx`, `guards/permission-declared.test.ts`
- Test: `web-construct/lib/rbac/users-actions.integration.test.ts`, `lib/rbac/users-actions-grants.integration.test.ts`, `lib/rbac/users-service.integration.test.ts` (crealo se non esiste)

**Interfaces:**
- Consumes: `set_membership_status_guarded`, `tenantMembership` (Task 1); `sendInvitationEmail` (Task 3); `prepareInvitation`; `getSystemRoleIds`.
- Produces:
  - in `lib/tenancy/membership.ts`: `addTenantMember(tx: TenantTx, userId: string): Promise<boolean>` — inserisce l'appartenenza `active` con `on conflict do nothing`; solo se l'ha creata aggiunge il ruolo `REGISTERED` e ritorna `true`;
  - in `lib/rbac/users-actions.ts`: `addUserByEmail(email: string): Promise<{ ok: true }>`, server action che comincia con `await requirePermission('invite-users')`;
  - `setUserStatus(userId, status: UserStatusId)` con la stessa firma di oggi, che agisce sull'appartenenza;
  - `loadUserManagementPage(actor)` restituisce anche `canInvite: boolean` (`hasPermission(actor, 'invite-users')`);
  - `UserDto` senza `tenantValidationPending` e `multiTenancyEnabled` (DEF-2.1: erano sempre `false`).

- [✅] **Step 1: Scrivi i test che falliscono**

`lib/rbac/users-service.test.ts`: la query renderizzata parte da `"tenant_membership"` (join con
`"users"`) e il filtro sugli stati usa `"tenant_membership"."status"`; togli le asserzioni su
`"users"."id_user_status"`.

Integrazione, con tenant B come nel Task 1 e `vi.mock('@/lib/mailer')`:

```ts
it('lists only members of the current tenant, with the membership status', …)
// un membro solo di B non compare; un membro disattivato nel predefinito ha status.idUserStatus === 1
it('setUserStatus deactivates the membership and leaves users.id_user_status at 2', …)
it('setUserStatus does not touch the same person in B', …)
it('addUserByEmail answers the same for an existing and an unknown email', async () => {
  const a = await addUserByEmail(existingEmail)
  const b = await addUserByEmail(`nuovo-${randomUUID()}@esempio.it`)
  expect(a).toEqual({ ok: true })
  expect(b).toEqual(a)
})
it('addUserByEmail creates the membership and the base role', …)
it('addUserByEmail finds the existing account whatever the case and spaces', …)   // '  Persona@Esempio.IT ' → stesso users.id, nessun account nuovo
it('addUserByEmail leaves a deactivated member deactivated', …)
it('addUserByEmail sends an invitation only to an account without password', …)  // mock di sendEmail chiamato una volta sola
```

Nei test esistenti che verificano la disattivazione, `statusOf` legge `tenant_membership.status`
invece di `users.id_user_status` (MT2-OK-1: stesso comportamento visibile).

- [✅] **Step 2: Verifica che falliscano**

Run: `cd sources/microservices/web-construct && npx vitest run lib/rbac/users-service.test.ts`
Expected: FAIL sulle asserzioni nuove.

- [✅] **Step 3: Implementa**

- `users-service.ts`: `listUsers` e `countUsers` partono da `tenantMembership` con `innerJoin(users, eq(users.id, tenantMembership.userId))`. Lo stato è l'espressione `case tenant_membership.status when 'active' then 2 else 1 end` come `UserStatusId`, usata per la colonna, per l'ordinamento della chiave `id_user_status` e per il filtro `statuses` (filtrare su `tenantMembership.status` con i valori tradotti va bene). Le date restano quelle di `users`.
- `users-actions.ts`:
  - `setUserStatus` chiama `public.set_membership_status_guarded(${userId}, ${status === USER_STATUS_ACTIVE ? 'active' : 'deactivated'})`;
  - `not_a_member` → `"La persona non fa parte di questo tenant"`, sia in `setUserStatus` sia in `updateUserRoles`; gli altri messaggi restano;
  - `addUserByEmail`: valida con `z.string().trim().toLowerCase().email().max(254)` (errore: `"Email non valida"`); `prepareInvitation(email, actor.userId)`; `userId` dall'invito o, se è `null`, con `withGlobal` per email; `withTenant(actor.tenantId, tx => addTenantMember(tx, userId))`; se c'era un invito, `sendInvitationEmail` (un errore d'invio si registra nel log e non cambia la risposta); ritorna `{ ok: true }`.
- `guards/permission-declared.test.ts`: `'lib/rbac/users-actions.ts#addUserByEmail': 'invite-users'`.
- Togli `tenantValidationPending` e `multiTenancyEnabled` da `UserDto`, `user-mappers.ts` e dai test che li citano.

Limite noto, da scrivere nel commento di `addUserByEmail`: l'email parte solo per un account nuovo,
quindi il tempo di risposta può differire; il contenuto della risposta no. È lo stesso limite di
oggi della registrazione.

- [✅] **Step 4: Verifica che passino**

Run: `npx vitest run lib/rbac guards && npm run test:integration -- lib/rbac lib/db/round-trip-budget.integration.test.ts`
Expected: PASS; tetto della pagina utenti invariato (≤11).

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct
git commit -m "feat(users): list tenant members, per-tenant deactivation, add by email"
```

---

### Task 5: "Aggiungi persona" nella pagina Utenti (§3.2)

**Files:**
- Create: `devops/db/migrations/0049_users_add_translations.sql`
- Create: `web-construct/components/rbac/users/AddUserDialog.tsx`, `components/rbac/users/AddUserDialog.test.tsx`
- Modify: `web-construct/components/rbac/users/UsersTableClient.tsx`, `app/(protected)/(admin)/user-management/page.tsx`, `devops/db/schema.sql`
- Test: `tests/e2e/test_users.py`

**Interfaces:**
- Consumes: `addUserByEmail`, `canInvite` (Task 4).
- Produces: `AddUserDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void })`; `UsersTableClient` riceve `canInvite: boolean`.

Chiavi da seminare (namespace `users`, modulo `rbac`):

| Chiave | it | en |
|---|---|---|
| `users.add.open` | Aggiungi persona | Add person |
| `users.add.title` | Aggiungi una persona | Add a person |
| `users.add.email_label` | Email | Email |
| `users.add.submit` | Aggiungi | Add |
| `users.add.done` | Persona aggiunta o invitata. | Person added or invited. |
| `users.add.invalid_email` | Scrivi un indirizzo email valido. | Enter a valid email address. |
| `users.add.error` | Non è stato possibile aggiungere la persona. | Could not add the person. |

- [✅] **Step 1: Scrivi i test che falliscono**

`AddUserDialog.test.tsx` (mock di `addUserByEmail`):

```ts
it('submits the email and shows the neutral confirmation', …)   // testo di users.add.done in role="status"; onAdded chiamata una volta
it('shows the invalid-email message without calling the action', …)
it('shows the generic error in role="alert" when the action fails', …)
```

`tests/e2e/test_users.py::test_add_person_by_email`: con l'amministratore, prima e dopo
`test-delete-user` (usa `E2E_REGISTER_EMAIL`); apre "Aggiungi persona", scrive l'email, conferma,
vede "Persona aggiunta o invitata."; filtrando la griglia per quell'email trova una riga con stato
"Attivo"; ripetendo l'aggiunta vede lo stesso messaggio.

- [✅] **Step 2: Verifica che falliscano**

Run: `cd sources/microservices/web-construct && npx vitest run components/rbac/users/AddUserDialog.test.tsx`
Expected: FAIL, componente mancante.

- [✅] **Step 3: Implementa**

- Migrazione 0049 con `apply_translation_seed` (modello in `0042`/`0043`); `test-apply`, `schema-write`, `schema-check` come nel Task 1.
- `AddUserDialog` su `AccessibleDialog` (come `ManageRolesModal.tsx`), campo `type="email"` con etichetta `users.add.email_label`; dopo il successo mostra `users.add.done` e chiama `onAdded`.
- `UsersTableClient`: bottone `users.add.open` nei `children` di `GridToolbar`, solo se `canInvite`; `onAdded` → `gridApiRef.current?.refreshInfiniteCache()`.
- `page.tsx`: passa `canInvite` da `loadUserManagementPage`.

- [✅] **Step 4: Verifica che passino**

Run: `npx vitest run components/rbac/users guards && npm run test:i18n-keys`
Expected: PASS.

Run (configurazione `web-construct-e2e`, nessun test di integrazione in corso): `caffeinate -dims uv run pytest sources/tests/e2e/test_users.py`
Expected: PASS, compreso il test che cambia lo stato dalla riga (MT2-OK-1).

- [✅] **Step 5: Commit**

```bash
git add sources/devops/db sources/microservices/web-construct sources/tests/e2e/test_users.py
git commit -m "feat(users): add a person by email from the users page"
```

---

### Task 6: Tenant modello e copia (§2.3, §2.4, MT2-DEC-7, 8, MT2-RISK-1)

**Files:**
- Create: `devops/db/migrations/0050_tenant_template.sql`
- Create: `web-construct/lib/tenancy/tenant-template.integration.test.ts`
- Modify: `web-construct/lib/db/schema.ts`, `lib/db/testing.ts`, `devops/db/schema.sql`

**Interfaces:**
- Produces (SQL, riservate alla piattaforma: solo `revoke … from public`):
  - colonna `tenant.is_template boolean not null default false`, indice unico parziale `tenant_single_template on public.tenant (is_template) where is_template`;
  - `app_private.copy_tenant(p_source bigint, p_slug text, p_name text, p_is_template boolean) returns bigint`;
  - `app_private.create_tenant_from_template(p_slug text, p_name text) returns bigint` — errore `template_missing` se non c'è un modello;
- Produces (TS): `tenant.isTemplate` e l'indice in `lib/db/schema.ts`; `deleteTenantForTest(tenantId: TenantId): Promise<void>` in `lib/db/testing.ts` (con `withOwner`: cancella le righe del tenant da ogni tabella di tenant, poi la riga di `tenant`).

- [✅] **Step 1: Scrivi i test che falliscono**

`lib/tenancy/tenant-template.integration.test.ts` (crea i tenant con `withOwner` e
`create_tenant_from_template`, li cancella con `deleteTenantForTest`):

```ts
it('the migration created one template, slug template, with no memberships', …)
it('a copy has the same number of menu entries, tags, roles, permission and functionality grants, and a theme', …)
it('a copy has the same content as the template once ids are mapped', …)
// confronta per tabella le tuple ordinate senza id, con i riferimenti tradotti in contenuto
// (per esempio il percorso dei nomi delle voci, la descrizione e la system_key del ruolo)
it('every internal reference of the copy points to rows of the copy', …)   // zero orfani con il contesto del nuovo tenant
it('the copy shares no id with the template', …)                         // id_menu_entry e id_role disgiunti
it('the template and the default tenant are unchanged after a copy', …)  // md5 di string_agg delle righe, prima e dopo
it('getSystemRoleIds works inside the copy', …)
it('an invalid or duplicate slug leaves no tenant behind', …)            // nessuna riga nuova in tenant né nelle tabelle di tenant
it('a second template is refused', …)                                    // indice tenant_single_template
it('the runtime role cannot create a tenant', …)                          // 42501 chiamando la funzione con withTenant
it('copy_tenant refuses to run when a tenant table is unknown to it', …)
// con withOwner, in una transazione poi annullata: inserisci in app_private.table_class una
// tabella di tenant fittizia; la copia fallisce con 'tenant_table_not_copied:<nome>'
```

- [✅] **Step 2: Verifica che falliscano**

Run: `cd sources/microservices/web-construct && npm run test:integration -- lib/tenancy/tenant-template.integration.test.ts`
Expected: FAIL, colonna `is_template` o funzione mancante.

- [✅] **Step 3: Scrivi la migrazione 0050**

1. Colonna e indice.
2. `copy_tenant`, in una funzione sola:
   - prima di tutto confronta le tabelle di tenant di `app_private.table_class` con l'elenco che conosce: copiate `menu_entry`, `menu_entry_tag`, `role`, `role_permission`, `role_functionality`, `app_theme`; saltate apposta `user_role`, `tenant_membership`. Una tabella fuori elenco → `raise exception using errcode = 'P0001', message = 'tenant_table_not_copied:' || nome`;
   - salva `v_origine := current_setting('app.tenant_id', true)`;
   - inserisce la riga di `public.tenant` (`slug`, `name`, `is_template`) e ne prende l'id;
   - con il contesto del tenant di partenza legge le righe in tabelle temporanee (`drop table if exists` all'inizio, `drop table` alla fine: la funzione si può chiamare più volte nella stessa transazione) e costruisce le corrispondenze vecchio→nuovo id con `nextval('public.s_id_menu_entry')` e `nextval('public.s_id_role')`;
   - con il contesto del nuovo tenant inserisce tutto con gli id nuovi: genitore delle voci (`null` resta `null`), voce delle etichette, ruolo e voce delle concessioni; `role_permission.id_permission` resta (tabella globale); `created_at`/`updated_at`/`date_ins`/`date_mod` a `now()`;
   - rimette `v_origine` e ritorna l'id.
3. `create_tenant_from_template`: `copy_tenant(<id del modello>, p_slug, p_name, false)`.
4. `revoke all on function … from public` per le due funzioni.
5. **Ultima sezione**, perché lascia controlli differiti sulle voci di menu fino alla fine della transazione: `select app_private.copy_tenant((select id from public.tenant where slug = 'default'), 'template', 'Modello', true);`.

- [✅] **Step 4: Applica, rigenera, verifica**

`test-apply`, `schema-write`, `schema-check` come nel Task 1, poi:

Run: `npm run test:integration -- lib/tenancy lib/schema-contract.integration.test.ts`
Expected: PASS; `lib/tenancy/tenant-schema.integration.test.ts` trova ancora un solo tenant `default`.

- [✅] **Step 5: Spunta MT2-RISK-1 nella specifica e commit**

```bash
git add sources/devops/db sources/microservices/web-construct/lib docs/superpowers/specs/2026-10-20-multi-tenancy-piece-2-memberships-design.md
git commit -m "feat(tenancy): template tenant and copy function"
```

---

### Task 7: Comando `db.mjs tenant-create` e primo amministratore (§3.3, MT2-DEC-9, 10, MT2-OK-4)

**Files:**
- Create: `devops/db/migrations/0051_tenant_admin_registration.sql`
- Create: `web-construct/lib/tenancy/tenant-create-command.integration.test.ts`
- Modify: `devops/db/migration-lib.mjs`, `devops/db/migration-lib.test.mjs`, `devops/db/db.mjs`, `devops/db/schema.sql`, `README.md`

**Interfaces:**
- Consumes: `create_tenant_from_template` (Task 6); `resolveActor` (Task 2); `deleteTenantForTest` (Task 6).
- Produces:
  - `app_private.register_tenant_admin(p_email text) returns table (user_id uuid, invitation_token text)`, nel tenant corrente, riservata alla piattaforma: email `lower(trim(...))`; crea l'account (`auth_provider = 'credentials'`) se manca; appartenenza `active`; ruoli `REGISTERED` e `TENANT_ADMIN` (`system_roles_missing` se mancano); se l'account non ha password inserisce in `password_set_tokens` un invito come quello di `prepareInvitation` ma già consegnato (`token = gen_random_uuid()::text`, `purpose = 'invitation'`, `delivery_status = 'sent'`, `delivery_attempted_at` e `delivered_at` a `now()`, `expires_at = now() + interval '48 hours'`) e ne ritorna il token, altrimenti `null`;
  - `parseTenantCreateArguments(args: string[]): { slug: string; name: string; admin: string }` in `migration-lib.mjs`;
  - comandi `tenant-create` (identità delle migrazioni, `migrationDatabaseUrl()`) e `test-tenant-create` (`testMigrationDatabaseUrl()`, stessa regola `TEST_DATABASE_DISPOSABLE=1`).

Uscita del comando, una riga per voce:

```
Tenant creato: id=<id> slug=<slug> nome=<nome>
Primo amministratore: <email> (account nuovo | account esistente)
Link per impostare la password (valido 48 ore): <AUTH_URL>/set-password?token=<token>
```

L'ultima riga c'è solo per un account nuovo. Senza `AUTH_URL` stampa il percorso
`/set-password?token=<token>` e, sotto, `AUTH_URL non impostata: anteponi l'indirizzo del sito.`

- [✅] **Step 1: Scrivi i test che falliscono**

`migration-lib.test.mjs`:

```js
test('parses tenant-create flags', () => {
  assert.deepEqual(parseTenantCreateArguments(['--slug', 'acme', '--name', 'Acme Spa', '--admin', ' Capo@Acme.IT ']),
    { slug: 'acme', name: 'Acme Spa', admin: 'capo@acme.it' })
})
test('rejects a missing flag, an unknown flag, a bad slug, an admin without @', …)  // 'Ab', 'a_b', 41 caratteri
```

`tenant-create-command.integration.test.ts` (lancia
`node ../../devops/db/db.mjs test-tenant-create …` con `execFile` e l'ambiente del processo, che
`vitest.integration.config.ts` ha già riempito con `TEST_MIGRATION_DATABASE_URL` e
`TEST_DATABASE_DISPOSABLE`):

```ts
it('creates the tenant and a new first admin with a set-password link', …)
// uscita con le tre righe; appartenenza active, REGISTERED e TENANT_ADMIN nel nuovo tenant;
// token 'invitation' 'sent' che scade fra 47 e 49 ore
it('the first admin is an admin actor inside the new tenant', async () => {
  const actor = await resolveActor(newTenant, adminId)
  expect(actor?.isAdmin).toBe(true)                                   // MT2-OK-4
})
it('links an existing account without printing a link', …)
it('a duplicate slug fails with exit code 1 and leaves no account, membership or tenant behind', …)
```

- [✅] **Step 2: Verifica che falliscano**

Run: `cd sources/microservices/web-construct && npm run test:migrations`
Expected: FAIL, `parseTenantCreateArguments` non esportata.

- [✅] **Step 3: Implementa**

- Migrazione 0051 con `register_tenant_admin` e il suo `revoke`; `test-apply`, `schema-write`, `schema-check`.
- `db.mjs`: `runTenantCreate(url, options)` con `postgres(url, { prepare: false, max: 1 })` e una transazione: `set local role construct_owner`; `create_tenant_from_template`; `set_config('app.tenant_id', <nuovo id>, true)`; `register_tenant_admin`; stampa. Un errore annulla tutto e segue la gestione di oggi (`ERROR: …`, codice d'uscita 1). Aggiungi i due comandi a `supported` e alla riga d'uso.
- `README.md`: nella parte sui comandi di `db.mjs`, `tenant-create` con l'esempio di §3.3 e i due limiti noti di §5.3 della specifica (tenant usabili dal pezzo 4, modello modificabile solo via SQL).

- [✅] **Step 4: Verifica che passino**

Run: `npm run test:migrations && npm run test:integration -- lib/tenancy/tenant-create-command.integration.test.ts`
Expected: PASS.

Run: `npm run test:env-contract && npm run test:docs-contract`
Expected: PASS, nessuna variabile d'ambiente nuova.

- [✅] **Step 5: Spunta MT2-OK-4 nella specifica e commit**

```bash
git add sources/devops/db sources/microservices/web-construct/lib README.md docs/superpowers/specs/2026-10-20-multi-tenancy-piece-2-memberships-design.md
git commit -m "feat(db): tenant-create command registers the first tenant admin"
```

---

### Task 8: Verifica finale, documenti, database di sviluppo (MT2-OK-1…3, MT2-RISK-2)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-20-multi-tenancy-piece-2-memberships-design.md`, `docs/input-specs/multi-tenancy/2026-10-13-multi-tenancy-deferred.md`, `docs/runbooks/legacy-rbac-recovery.md` (solo se cita `user_role` in un modo che l'appartenenza rende sbagliato)

- [ ] **Step 1: Controlli completi sul database di prova**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint && npm run test && npm run test:migrations && npm run test:i18n-keys && npm run test:env-contract && npm run test:docs-contract && npm run build`
Expected: nessun errore; solo gli 8 fallimenti noti di `Sidebar*`.

Run: `npm run test:integration`
Expected: PASS.

Run (finiti i test di integrazione, configurazione `web-construct-e2e`): `caffeinate -dims uv run pytest`
Expected: PASS, E2E completo (MT2-OK-1).

Run (dalla radice): `node sources/devops/db/db.mjs schema-check` e `boundary-check` sul database di prova come nel Task 1.
Expected: tutto in regola.

- [ ] **Step 2: Spunte**

- Specifica: MT2-OK-1, MT2-OK-2, MT2-OK-3 a `- [✅]`.
- Documento delle cose rimandate: DEF-2.2, DEF-2.3, DEF-2.6 a `- [✅]` con "fatto nel pezzo 2"; DEF-2.1 resta aperta con la nota "tabella e stati active/deactivated nel pezzo 2; invited e pending nel pezzo 3".

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs(multi-tenancy): tick piece-2 criteria and deferred items"
```

- [ ] **Step 4: FERMATI e chiedi al proprietario prima di toccare il database di sviluppo**

Prima di chiedere, conta in sola lettura sul database di sviluppo (MT2-RISK-2):

```bash
node sources/devops/db/db.mjs query "select count(*) as utenti from public.users"
```

Mostra al proprietario il numero e le migrazioni da applicare (0048–0051). Solo dopo un sì
esplicito:

```bash
set -a && . ./sources/devops/db/operator.env && set +a && node sources/devops/db/db.mjs apply
```
```bash
node sources/devops/db/db.mjs query "select count(*) as appartenenze from public.tenant_membership"
```
```bash
node sources/devops/db/db.mjs boundary-check
```
Expected: `appartenenze` uguale a `utenti` contato prima (salvo chi si è registrato nel frattempo);
`boundary-check` senza violazioni. Poi spunta MT2-RISK-2 e committa la spunta.
