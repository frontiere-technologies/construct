# Multi-tenancy, pezzo 4: tenant corrente — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** il tenant in cui si lavora dipende dall'indirizzo da cui si entra e dalla scelta della
persona; si sceglie da una pagina a schede, si cambia dalla barra laterale, si registra nel tenant
dell'indirizzo, e nessun ingresso attraversa i tenant.

**Architecture:** un registro globale degli indirizzi (`tenant_host`) dice quali tenant rispondono su
un indirizzo; tutto il resto è il "principale". Il callback `jwt` di Auth.js sceglie il tenant
all'accesso e lo rivalida a ogni richiesta dentro l'istruzione unica dell'autorizzazione;
`resolveRequestTenant()` restituisce il tenant rivalidato o, prima dell'accesso, quello
dell'indirizzo. Le regole che toccano più tenant (elenco dei tenant della persona, ingresso con la
registrazione) sono funzioni SQL `security invoker` come nel pezzo 2.

**Tech Stack:** Next.js 16.3 (App Router, `proxy.ts`), Auth.js 5.0.0-beta.32, Drizzle ORM con
postgres.js (`prepare: false`), PostgreSQL 15+ (sviluppo su Supabase), Vitest, pytest + Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-21-multi-tenancy-piece-4-current-tenant-design.md`](../specs/2026-10-21-multi-tenancy-piece-4-current-tenant-design.md)
(MT4-DEC-1…17, §2 database, §3 applicazione, §4 test, MT4-OK-1…5, MT4-RISK-1…4). Contesto: le
specifiche dei [pezzi 1](../specs/2026-10-13-multi-tenancy-foundations-design.md) e
[2](../specs/2026-10-20-multi-tenancy-piece-2-memberships-design.md) e il
[piano del pezzo 2](2026-10-20-multi-tenancy-piece-2-memberships.md), da cui questo piano riprende
forma e convenzioni.

**Mappa del codice:** `.superpowers/sdd/piece-4/code-map.md` (ignorata da git): file e righe di
`resolveRequestTenant` e chiamanti, callback di Auth.js, proxy, barra laterale, pagine prima
dell'accesso, impostazioni e permessi, link assoluti, inventario degli ingressi, E2E. Chi esegue un
task la legge prima di cominciare.

## Global Constraints

- **Isolamento del pezzo 1 invariato:** `withTenant`/`withGlobal` restano le sole porte verso il database dell'app; nessuna funzione `security definer`; ogni funzione nuova è `security invoker set search_path = ''` con nomi qualificati; quelle chiamate dall'app hanno `revoke all … from public; grant execute … to construct_runtime`, quelle della piattaforma solo il `revoke`.
- **Una funzione che cambia `app.tenant_id` lo rimette com'era prima di ogni uscita.**
- **Solo `lib/tenancy` costruisce un `TenantId`** (`guards/tenant-boundary.test.ts`): ogni codice nuovo che ricava un tenant da indirizzo, token o scelta vive lì.
- **Nessun ingresso accetta il tenant dal client** (MT4-DEC-7): il tenant viene solo dal token rivalidato o dall'indirizzo confrontato con il registro; l'id passato a `chooseTenant` è una richiesta, valida solo se compare fra i tenant disponibili.
- **L'indirizzo della richiesta decide solo quali tenant sono possibili e non entra mai nei link** (MT4-DEC-12): i link si costruiscono con `AUTH_URL` sostituendo il nome dell'host con l'indirizzo principale del tenant (`tenant_host.is_primary`), se esiste.
- **Regola degli indirizzi (decisa qui):** un indirizzo si confronta in minuscolo e **senza porta** (`A.Localhost:3000` → `a.localhost`); `tenant_host.host` si salva nella stessa forma.
- **Migrazioni:** dalla 0053, una per task che cambia lo schema; una migrazione applicata al database di prova non si modifica; intestazione in italiano `-- Multi-tenancy, pezzo 4 (specifica 2026-10-21, §x, MT4-…): …`; dopo ogni migrazione `node sources/devops/db/db.mjs schema-write` e `schema-check`; `lib/db/schema.ts` cambia nello stesso task.
- **Comandi del database di prova** (dalla radice del repository):
  ```bash
  set -a && . ./sources/devops/db/operator.env && set +a && TEST_DATABASE_DISPOSABLE=1 node sources/devops/db/db.mjs test-apply
  ```
  ```bash
  cd sources/microservices/web-construct && npm run test:integration -- <file>
  ```
- **Database:** nessuna produzione in uso; il database di sviluppo è alla 0052 e si migra **solo nel Task 12, dopo il merge e un sì esplicito del proprietario**; test di integrazione ed E2E solo sul database di prova, **mai insieme**; E2E con la configurazione `web-construct-e2e` avviata dal controllore; per un E2E lungo `caffeinate -dims uv run pytest`.
- **Viaggi verso il database:** i tetti di `lib/db/round-trip-budget.integration.test.ts` non salgono; un aumento va motivato nel task e approvato dal revisore.
- **Traduzioni:** ogni chiave usata nel codice è seminata in una migrazione con `public.apply_translation_seed` (`npm run test:i18n-keys`).
- **Permessi:** ogni azione, rotta e pagina protetta nuova comincia con un `require*`/`allow*` ed è dichiarata in `guards/permission-declared.test.ts`.
- **Lingua:** commenti, messaggi e uscita dei comandi in italiano; commit in inglese, `type(scope): …`, chiusi da `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Checkbox:** gli elementi MT4-OK e MT4-RISK della specifica si spuntano `- [✅]` quando sono finiti e verificati; i passi di questo piano si spuntano qui.
- **Base dei test unitari:** gli 8 fallimenti noti di `components/Sidebar*.test.tsx` (Node 26) non contano.

## Review Focus

1. **Un token valido per il tenant B usato su un indirizzo dove B non risponde** (cookie copiato,
   client non browser): deve dare la scelta o il messaggio, mai i dati di B. → test nel Task 4 e E2E
   nel Task 11.
2. **La funzione che elenca i tenant della persona lascia la transazione in un altro tenant.** →
   test "il contesto torna quello di partenza" nel Task 3.
3. **L'intestazione `Host` falsificata finisce in un link d'invito o di recupero.** → test nel Task 8
   con `Host: evil.example` sulla registrazione e sul recupero.
4. **Un'appartenenza disattivata mentre la persona lavora nel tenant**: alla richiesta successiva
   deve passare alla scelta o al messaggio, senza restare nel tenant. → test nel Task 4.
5. **Indirizzo con maiuscole o con la porta** (`A.LOCALHOST:3000`): stesso tenant di `a.localhost`.
   → test nei Task 1 e 3.

---

## Mappa dei file

| File | Responsabilità | Task |
|---|---|---|
| `web-construct/lib/tenancy/request-host.ts` | indirizzo della richiesta, normalizzato | 1 |
| `web-construct/lib/auth.ts`, `lib/auth.config.ts`, `next.config.ts` | `trustHost`, indirizzi locali ammessi | 1, 4, 5 |
| `devops/db/migrations/0053_tenant_hosts_and_settings.sql` | `tenant_host`, `tenant_settings`, `users.last_tenant_id`, permesso, copia | 2 |
| `devops/db/migrations/0054_tenant_selection_functions.sql` | tenant dell'indirizzo, tenant disponibili, ingresso con la registrazione | 3 |
| `devops/db/migrations/0055_piece4_translations_and_menu.sql` | chiavi dell'interfaccia, voce di menu delle impostazioni | 5 |
| `web-construct/lib/db/schema.ts`, `devops/db/schema.sql` | schema | 2, 3, 5 |
| `web-construct/lib/tenancy/host-tenants.ts` | tenant dell'indirizzo prima dell'accesso, tenant disponibili | 3 |
| `web-construct/lib/tenancy/tenant-selection.ts` | scelta pura del tenant all'accesso e alla rivalidazione | 4 |
| `web-construct/lib/tenancy/request-tenant.ts` | tenant della richiesta da token o indirizzo | 4 |
| `web-construct/lib/rbac/auth-roles.ts` | idoneità del tenant nell'istruzione unica | 4 |
| `web-construct/types/next-auth.d.ts` | campi del token | 4 |
| `web-construct/app/select-tenant/page.tsx`, `app/no-tenant/page.tsx`, `lib/tenancy/tenant-actions.ts` | scelta, messaggio, azione di scelta e cambio | 5 |
| `web-construct/components/TenantSwitcher.tsx`, `components/Sidebar.tsx`, `app/(protected)/layout.tsx` | selettore in cima alla barra | 6 |
| `web-construct/app/(protected)/(admin)/admin/tenant-settings/page.tsx`, `components/settings/TenantSettings.tsx`, `lib/tenancy/tenant-settings-actions.ts` | interruttore delle registrazioni | 7 |
| `web-construct/lib/tenancy/tenant-base-url.ts`, `lib/invitation-email.ts`, `app/api/auth/{register,forgot-password}/route.ts` | link e pagine prima dell'accesso | 8 |
| `devops/db/db.mjs`, `devops/db/migration-lib.mjs` | `--host`, `tenant-host-add` | 9 |
| `web-construct/lib/tenancy/cross-tenant-entry-points.integration.test.ts` | ogni ingresso fra tenant | 10 |
| `tests/e2e/test_tenants.py`, `tests/e2e/conftest.py` | E2E con `a.localhost`, `b.localhost` | 11 |

`web-construct/` sta per `sources/microservices/web-construct/`; `devops/` per `sources/devops/`.

---

### Task 1: Indirizzo della richiesta e Auth.js su più indirizzi (MT4-RISK-1, MT4-RISK-2)

Prima di tutto si prova che l'indirizzo arriva uguale dove serve e che l'accesso resta
sull'indirizzo della richiesta: tutto il resto del piano si appoggia su questo.

**Files:**
- Create: `web-construct/lib/tenancy/request-host.ts`, `lib/tenancy/request-host.test.ts`
- Modify: `web-construct/lib/auth.ts` (`trustHost: true`), `web-construct/next.config.ts` (`allowedDevOrigins: ['a.localhost', 'b.localhost']`)
- Test: `tests/e2e/test_tenants.py` (creato qui con il primo caso)

**Interfaces:**
- Produces: `normalizeHost(raw: string | null | undefined): string | null` (minuscolo, senza porta, senza punto finale; `null` se vuoto o non valido); `readRequestHost(): Promise<string | null>` (da `headers()` di Next, intestazione `host`; `x-forwarded-host` solo se `TRUST_FORWARDED_HOST === 'true'`, documentata in `.env.template` e nel contratto delle variabili).

- [✅] **Step 1: Scrivi i test che falliscono**

```ts
it('normalizes case, port and trailing dot', () => {
  expect(normalizeHost('A.Localhost:3000')).toBe('a.localhost')
  expect(normalizeHost('a.localhost.')).toBe('a.localhost')
  expect(normalizeHost('[::1]:3000')).toBe('::1')
  expect(normalizeHost('')).toBeNull()
  expect(normalizeHost('a b')).toBeNull()
})
it('reads x-forwarded-host only when trusted', …)   // mock di next/headers
```

E2E `test_login_stays_on_subdomain`: con il server `web-construct-e2e`, l'accesso di prova da
`http://a.localhost:3000/login` porta a `http://a.localhost:3000/` (mai a `localhost:3000`) e
l'uscita riporta a `http://a.localhost:3000/login`. In questo task il tenant è ancora quello
predefinito: il test verifica solo l'indirizzo.

- [✅] **Step 2: Verifica che falliscano**

Run: `cd sources/microservices/web-construct && npx vitest run lib/tenancy/request-host.test.ts`
Expected: FAIL, modulo mancante. L'E2E fallisce con il ritorno su `localhost:3000`.

- [✅] **Step 3: Implementa**

`request-host.ts`; `trustHost: true` in `NextAuth({...})`; `allowedDevOrigins`. Poi una sonda
temporanea (non committata): registra `readRequestHost()` dentro il callback `jwt` chiamato sia dal
proxy sia da una pagina e da una rotta `app/api`, su `a.localhost`; annota nel rapporto se
`headers()` è disponibile in tutti e tre i punti. Se nel proxy non lo è, la soluzione scelta (per
esempio leggere l'intestazione nel proxy e non chiamare `headers()` nel callback) va scritta nel
rapporto e usata dal Task 4.

- [✅] **Step 4: Verifica che passino**

Run: `npx vitest run lib/tenancy/request-host.test.ts && npm run test:env-contract`
Expected: PASS.

Il controllore avvia `web-construct-e2e`; poi, dalla radice: `uv run pytest sources/tests/e2e/test_tenants.py -k stays_on_subdomain` e `uv run pytest sources/tests/e2e/test_auth.py`
Expected: PASS.

- [✅] **Step 5: Spunta MT4-RISK-1 e MT4-RISK-2 nella specifica e commit**

```bash
git commit -m "feat(tenancy): read the request host and serve auth on several hosts"
```

---

### Task 2: Indirizzi, impostazioni del tenant, ultimo tenant usato (§2.1–§2.3, MT4-DEC-10, 13, 17)

**Files:**
- Create: `devops/db/migrations/0053_tenant_hosts_and_settings.sql`, `web-construct/lib/tenancy/tenant-hosts-schema.integration.test.ts`
- Modify: `web-construct/lib/db/schema.ts`, `devops/db/schema.sql`, `web-construct/lib/rbac/permission-catalog.ts`, `web-construct/lib/tenancy/tenant-template.integration.test.ts` (tabelle copiate)

**Interfaces:**
- Produces (SQL):
  - `public.tenant_host (host text primary key, id_tenant bigint not null references tenant(id), is_primary boolean not null default false, created_at timestamptz not null default now())`, `check (host = lower(host) and host !~ ':')`, indice unico parziale `tenant_host_single_primary on (id_tenant) where is_primary`; dichiarata globale in sola lettura (`app_private.declare_global_table('public.tenant_host', false, …)`);
  - trigger `tenant_host_guard` che rifiuta (`P0001`, `host_not_allowed`) un indirizzo per il tenant con slug `default` o con `is_template`;
  - `public.tenant_settings (id_tenant bigint primary key default app_private.current_tenant_id() references tenant(id), self_registration boolean not null default false, updated_at timestamptz not null default now())`, protetta con `protect_tenant_table`; righe: predefinito `true`, modello `false`;
  - `users.last_tenant_id bigint references tenant(id) on delete set null`;
  - permesso `manage-tenant-settings` (modello `0041_permission_catalog.sql`), concesso al ruolo con `system_key = 'TENANT_ADMIN'` nel predefinito e nel modello;
  - `app_private.copy_tenant` (`create or replace`, corpo di partenza in `0051`): copia anche `tenant_settings`; l'elenco delle tabelle note la include.
- Produces (Drizzle): `tenantHost`, `tenantSettings`, `users.lastTenantId`; `'manage-tenant-settings'` in `PERMISSION_CODES`.

- [✅] **Step 1: Scrivi i test che falliscono**

```ts
it('stores hosts lowercase and without port', …)                 // insert 'A.localhost' o 'a.localhost:3000' → errore di check
it('refuses a host for the default tenant and for the template', …) // 'host_not_allowed'
it('allows at most one primary host per tenant', …)
it('the runtime role cannot write tenant_host', …)                // 42501
it('tenant_settings: default accepts self registration, template does not', …)
it('a tenant created from the template starts with self registration off', …)
it('the TENANT_ADMIN role has manage-tenant-settings in default and template', …)
```

Nel test del modello (`tenant-template.integration.test.ts`), l'elenco delle tabelle note include
`tenant_settings`.

- [✅] **Step 2: Verifica che falliscano**

Run: `npm run test:integration -- lib/tenancy/tenant-hosts-schema.integration.test.ts`
Expected: FAIL, relazione mancante.

- [✅] **Step 3: Scrivi la migrazione 0053, lo schema Drizzle e il catalogo dei permessi**

- [✅] **Step 4: Applica, rigenera, verifica**

`test-apply`, `schema-write`, `schema-check`, poi:
Run: `npm run test:integration -- lib/tenancy lib/schema-contract.integration.test.ts && npx vitest run guards`
Expected: PASS; `boundary-check` sul database di prova in regola
(`set -a && . ./sources/microservices/web-construct/.env.test.local && set +a && DATABASE_URL="$TEST_DATABASE_URL" node sources/devops/db/db.mjs boundary-check`).

- [✅] **Step 5: Commit**

```bash
git commit -m "feat(tenancy): tenant hosts, tenant settings and last used tenant"
```

---

### Task 3: Tenant dell'indirizzo e tenant disponibili per la persona (§2.4, MT4-DEC-1, 2, 9, 10)

**Files:**
- Create: `devops/db/migrations/0054_tenant_selection_functions.sql`, `web-construct/lib/tenancy/host-tenants.ts`, `lib/tenancy/host-tenants.integration.test.ts`
- Modify: `devops/db/schema.sql`

**Interfaces:**
- Consumes: `tenant_host`, `tenant_settings` (Task 2); `normalizeHost` (Task 1).
- Produces (SQL, chiamabili dall'app):
  - `public.host_tenant_ids(p_host text) returns setof bigint` — se `p_host` è in `tenant_host`, il suo tenant; altrimenti tutti i tenant senza indirizzo, `active`, non modello;
  - `public.available_tenants(p_user_id uuid, p_host text) returns table (id_tenant bigint, name text, is_admin boolean)` — fra `host_tenant_ids(p_host)`, quelli dove la persona ha appartenenza `active` e account con `id_user_status = 2`; `is_admin` se ha il ruolo `TENANT_ADMIN`; ordinati per nome; cambia `app.tenant_id` e lo rimette;
  - `public.has_deactivated_membership_on_host(p_user_id uuid, p_host text) returns boolean` — per MT4-DEC-15, stessa tecnica;
  - `public.join_by_registration(p_user_id uuid) returns text` — nel tenant corrente: se `tenant_settings.self_registration` è falso ritorna `null`; se la persona è membro di qualunque tenant (`app_private.is_member_elsewhere` o appartenenza qui) ritorna lo stato esistente o `null`; altrimenti crea l'appartenenza `active` e il ruolo `REGISTERED` e ritorna `'active'`;
  - `public.ensure_default_membership` (`create or replace`, corpo in `0048`): ritorna `null` anche se `self_registration` del predefinito è falso (MT4-DEC-10).
- Produces (TS, `lib/tenancy/host-tenants.ts`):
  - `type AvailableTenant = { tenantId: TenantId; name: string; isAdmin: boolean }`;
  - `listAvailableTenants(userId: string, host: string | null): Promise<AvailableTenant[]>` (con `withGlobal`; `host` nullo = principale);
  - `resolveHostTenant(host: string | null): Promise<TenantId>` — il tenant dell'indirizzo prima dell'accesso: quello dedicato, altrimenti il predefinito.

- [✅] **Step 1: Scrivi i test che falliscono**

Fixture: tenant A con `a.localhost` (primario), tenant C senza indirizzo, persona membro attivo di
predefinito, A e C, persona solo di A, persona disattivata nel predefinito.

```ts
it('main address lists default and C but not A, template or suspended tenants', …)
it('a.localhost lists only A', …)
it('A.LOCALHOST and null host follow the same rules as a.localhost and the main address', …)
it('a deactivated membership or a globally deactivated account is not available', …)
it('available_tenants leaves app.tenant_id as it found it', …)
it('has_deactivated_membership_on_host is true only for a deactivated membership on that host', …)
it('join_by_registration creates membership and base role only when the tenant accepts it and the person belongs nowhere', …)
it('join_by_registration does nothing for a member of another tenant', …)
it('ensure_default_membership returns null when the default tenant refuses self registration', …)
it('resolveHostTenant returns A for a.localhost and default for unknown hosts', …)
```

- [✅] **Step 2: Verifica che falliscano**

Run: `npm run test:integration -- lib/tenancy/host-tenants.integration.test.ts`
Expected: FAIL, funzioni mancanti.

- [✅] **Step 3: Migrazione 0054 e `host-tenants.ts`**

- [✅] **Step 4: Applica e verifica**

`test-apply`, `schema-write`, `schema-check`; `npm run test:integration -- lib/tenancy`
Expected: PASS.

- [✅] **Step 5: Commit**

```bash
git commit -m "feat(tenancy): host tenants, available tenants and registration join"
```

---

### Task 4: Tenant nel token, rivalidato a ogni richiesta (§3.1, MT4-DEC-4, 7, 15, 16; DEF-4.1)

**Files:**
- Create: `web-construct/lib/tenancy/tenant-selection.ts`, `lib/tenancy/tenant-selection.test.ts`
- Modify: `web-construct/lib/auth.ts`, `lib/auth.test.ts`, `types/next-auth.d.ts`, `lib/tenancy/request-tenant.ts`, `lib/rbac/auth-roles.ts`, `lib/rbac/auth-roles.integration.test.ts`, `lib/db/round-trip-budget.integration.test.ts`, `lib/theme-server.ts`, `lib/rbac/auth-guard.ts` e gli altri chiamanti di `resolveRequestTenant` elencati nella mappa del codice

**Interfaces:**
- Consumes: `readRequestHost` (Task 1); `listAvailableTenants`, `resolveHostTenant`, `has_deactivated_membership_on_host` (Task 3); `users.lastTenantId` (Task 2).
- Produces:
  - campi del token: `tenantId: number | null`, `tenantState: 'ready' | 'choose' | 'none'`, `tenantHost: string | null` (indirizzo su cui il tenant è stato scelto); la sessione espone `tenantState` e `tenantName`;
  - `selectTenant(input: { available: AvailableTenant[]; lastTenantId: number | null; current: number | null }): { state: 'ready'; tenantId: TenantId } | { state: 'choose' } | { state: 'none' }` — `current` disponibile → resta; altrimenti un solo disponibile → quello; più disponibili e `lastTenantId` fra loro → quello; più disponibili → `choose`; nessuno → `none`;
  - `resolveRequestTenant(): Promise<TenantId>` — sessione con `tenantState === 'ready'` → il tenant del token; nessuna sessione → `resolveHostTenant(await readRequestHost())`; sessione in stato `choose` o `none` → errore `tenant_not_selected` (le pagine protette non ci arrivano, vedi Task 5);
  - `selectAuthorizationSnapshot(tx, userId, { permissionCodes?, host? })` — con `host`, la stessa istruzione legge anche `tenant_eligible: boolean` (tenant della transazione `active`, non modello, e in `host_tenant_ids(host)`).

- [✅] **Step 1: Scrivi i test che falliscono**

`tenant-selection.test.ts` con le cinque regole sopra, più: `current` non più disponibile e
`lastTenantId` disponibile → `lastTenantId`; `lastTenantId` non disponibile con più tenant →
`choose` (MT4-DEC-16 vale nel Task 5: qui `lastTenantId` si legge soltanto).

`auth-roles.integration.test.ts`:

```ts
it('tenant_eligible is false for the template, a suspended tenant, or a tenant not on the host', …)
it('a token for B presented on a.localhost is not ready', …)       // Review Focus #1
it('a membership deactivated during the session moves the token to choose or none at the next request', …) // Review Focus #4
```

`auth.test.ts` (callback e `authorize` con i mock del pezzo 2):

```ts
it('sign-in on an address with one tenant gives state ready', …)
it('sign-in with several tenants and no last tenant gives state choose', …)
it('sign-in with several tenants enters the last used one', …)
it('entering directly (single tenant or last used) never writes last_tenant_id', …) // MT4-DEC-16
it('sign-in with no tenant on the address and a deactivated membership there is refused as today', …) // MT4-DEC-15
it('sign-in with no membership on the address gives state none', …)
it('a token without tenant fields (session from before the release) is treated as a new sign-in', …) // §5.1
it('no request parameter, form field or header other than the host changes the tenant', …)
```

- [✅] **Step 2: Verifica che falliscano**

Run: `npx vitest run lib/tenancy/tenant-selection.test.ts lib/auth.test.ts`
Expected: FAIL.

- [✅] **Step 3: Implementa**

- `jwt`: all'accesso legge host, tenant disponibili e `lastTenantId`, applica `selectTenant`; a ogni
  richiesta successiva, se `tenantState === 'ready'`, l'istruzione unica con `host` rivalida il
  tenant (nessun viaggio in più): se non è idoneo o l'appartenenza non è attiva, ricalcola con
  `selectTenant` (qui sì una lettura in più, solo in quel caso). Un token con `tenantHost` diverso
  dall'indirizzo della richiesta va ricalcolato allo stesso modo.
- `authorize` e `signIn`: il controllo del pezzo 2 (`isMembershipDeactivated` sul tenant della
  richiesta) diventa: nessun tenant disponibile e `has_deactivated_membership_on_host` → respinto.
- `resolveRequestTenant` come sopra; i chiamanti non cambiano firma. `joinDefaultTenant` usa
  `resolveHostTenant`.

- [✅] **Step 4: Verifica che passino**

Run: `npx vitest run lib && npm run test:integration -- lib/rbac lib/tenancy lib/auth-security.integration.test.ts lib/db/round-trip-budget.integration.test.ts`
Expected: PASS; tetti invariati (o aumento motivato nel rapporto).

- [✅] **Step 5: Spunta MT4-RISK-3 e commit**

```bash
git commit -m "feat(auth): current tenant in the token, revalidated on every request"
```

---

### Task 5: Pagina di scelta, messaggio "non configurato", azione di scelta e cambio (MT4-DEC-3, 4, 5, 6, 16)

**Files:**
- Create: `devops/db/migrations/0055_piece4_translations_and_menu.sql`, `web-construct/app/select-tenant/page.tsx`, `components/tenancy/TenantChooser.tsx`, `components/tenancy/TenantChooser.test.tsx`, `app/no-tenant/page.tsx`, `lib/tenancy/tenant-actions.ts`, `lib/tenancy/tenant-actions.integration.test.ts`
- Modify: `web-construct/lib/auth.config.ts`, `lib/auth.config.test.ts`, `guards/permission-declared.test.ts`, `devops/db/schema.sql`

**Interfaces:**
- Consumes: token fields, `selectTenant`, `listAvailableTenants` (Task 4, 3).
- Produces:
  - `chooseTenant(tenantId: number): Promise<void>` (`'use server'`, comincia con `allowAnyAuthenticated()` o una dichiarazione dedicata in `access-declarations.ts`): ricava la persona dalla sessione, verifica che `tenantId` sia in `listAvailableTenants(userId, host)`, altrimenti errore `tenant_not_available` senza cambiare niente; aggiorna `users.last_tenant_id` (`withGlobal`), aggiorna il token (`unstable_update` esportato da `lib/auth.ts`, ramo `trigger === 'update'` nel callback `jwt` che accetta solo un `tenantId` già verificato e lo rivalida) e fa `redirect('/')`;
  - percorsi `/select-tenant` e `/no-tenant`: in `authorized`, sessione con `tenantState === 'choose'` → solo `/select-tenant` (ogni altra pagina reindirizza lì); `'none'` → solo `/no-tenant`; `'ready'` → queste due pagine reindirizzano a `/`.
  - chiavi seminate in 0055 (namespace `tenancy`, modulo `rbac`): `tenancy.choose.title` ("Ciao {name}, dove vuoi entrare?" / "Hi {name}, where do you want to go?"), `tenancy.choose.hint` ("Potrai cambiare in qualunque momento dalla barra laterale." / "You can switch at any time from the sidebar."), `tenancy.role.admin` ("Amministratore"/"Administrator"), `tenancy.role.user` ("Utente"/"User"), `tenancy.none.message` ("Non sei configurato su questo indirizzo." / "You are not set up on this address."), `tenancy.none.logout` ("Esci"/"Sign out"), `tenancy.switch.label` ("Cambia tenant"/"Switch tenant"), `tenancy.switch.current` ("Tenant corrente"/"Current tenant"), `tenancy.settings.title` ("Impostazioni del tenant"/"Tenant settings"), `tenancy.settings.self_registration` ("Accetta registrazioni autonome"/"Accept self-registration"), `tenancy.settings.self_registration_hint` ("Chi si registra da questo indirizzo entra nel tenant, se non è già membro di un altro." / "People who sign up from this address join the tenant, unless they already belong to another one."), `tenancy.settings.saved` ("Impostazioni salvate."/"Settings saved."). La stessa migrazione aggiunge la voce di menu "Impostazioni del tenant" (`admin/tenant-settings`) nel predefinito e nel modello, accanto a "Theme & Styles", concessa al ruolo `TENANT_ADMIN`.

- [✅] **Step 1: Scrivi i test che falliscono**

```ts
// tenant-actions.integration.test.ts
it('chooseTenant to an available tenant updates last_tenant_id', …)
it('chooseTenant to a tenant on another host, deactivated, template or missing is refused and changes nothing', …)
// TenantChooser.test.tsx
it('renders one card per tenant with name and role', …)
it('stays scrollable with twelve tenants', …)   // contenitore con overflow e altezza limitata, nessuna larghezza fissa
// auth.config.test.ts
it('a session in state choose is redirected to /select-tenant from any page', …)
it('a session in state none can open only /no-tenant', …)
it('a ready session is redirected away from /select-tenant and /no-tenant', …)
```

- [✅] **Step 2: Verifica che falliscano**

- [✅] **Step 3: Implementa** pagine, componente a schede (griglia che va a capo, pagina che scorre), azione, migrazione 0055 (`test-apply`, `schema-write`, `schema-check`).

- [✅] **Step 4: Verifica che passino**

Run: `npx vitest run components/tenancy lib/auth.config.test.ts guards && npm run test:i18n-keys && npm run test:integration -- lib/tenancy`
Expected: PASS.

- [✅] **Step 5: Commit**

```bash
git commit -m "feat(tenancy): tenant chooser, not-configured page and tenant switch action"
```

---

### Task 6: Selettore in cima alla barra laterale (MT4-DEC-5)

**Files:**
- Create: `web-construct/components/TenantSwitcher.tsx`, `components/TenantSwitcher.test.tsx`
- Modify: `web-construct/app/(protected)/layout.tsx`, `components/Layout.tsx`, `components/Sidebar.tsx`

**Interfaces:**
- Consumes: `listAvailableTenants`, `chooseTenant`, `resolveRequestTenant`, chiavi `tenancy.switch.*` (Task 3, 4, 5).
- Produces: `TenantSwitcher({ current, tenants, collapsed }: { current: { id: number; name: string }; tenants: { id: number; name: string }[]; collapsed: boolean })`; il layout protetto passa `tenantSwitcher` a `Layout` → `Sidebar` (nuova prop opzionale, così i test esistenti della barra non cambiano).

- [✅] **Step 1: Scrivi i test che falliscono**

```ts
it('shows the current tenant name and no list with a single tenant', …)
it('opens a scrollable list with several tenants and marks the current one', …)
it('choosing another tenant calls chooseTenant with its id', …)
it('is reachable with the sidebar collapsed (icon button with accessible name)', …)
```

- [✅] **Step 2: Verifica che falliscano**

- [✅] **Step 3: Implementa** il blocco prima delle voci in alto della colonna (`Sidebar.tsx` ~503), con le primitive shadcn e i token del tema; l'elenco usa `max-height` e scorrimento.

- [✅] **Step 4: Verifica che passino**

Run: `npx vitest run components guards`
Expected: PASS (salvo gli 8 fallimenti noti di `Sidebar*`).

- [✅] **Step 5: Commit**

```bash
git commit -m "feat(sidebar): current tenant and tenant switcher at the top"
```

---

### Task 7: Impostazioni del tenant: registrazioni autonome (MT4-DEC-10)

**Files:**
- Create: `web-construct/app/(protected)/(admin)/admin/tenant-settings/page.tsx`, `components/settings/TenantSettings.tsx`, `components/settings/TenantSettings.test.tsx`, `lib/tenancy/tenant-settings-actions.ts`, `lib/tenancy/tenant-settings.integration.test.ts`
- Modify: `web-construct/guards/permission-declared.test.ts`

**Interfaces:**
- Consumes: `tenantSettings`, permesso `manage-tenant-settings` (Task 2); chiavi `tenancy.settings.*` e voce di menu (Task 5).
- Produces: `setSelfRegistration(enabled: boolean): Promise<void>` (`'use server'`, comincia con `await requirePermission('manage-tenant-settings')`, scrive con `withTenant(actor.tenantId)`); pagina protetta da `requirePagePermission('manage-tenant-settings')`.

- [✅] **Step 1: Scrivi i test che falliscono**

```ts
it('the tenant admin turns self registration on and off for their tenant only', …)  // B invariato
it('a user without manage-tenant-settings is refused', …)
it('the switch shows the saved state and the saved message', …)                     // componente
```

- [✅] **Step 2–4:** come nei task precedenti; `npx vitest run components/settings guards && npm run test:integration -- lib/tenancy/tenant-settings.integration.test.ts`.

- [✅] **Step 5: Commit**

```bash
git commit -m "feat(tenancy): tenant settings page with the self-registration switch"
```

---

### Task 8: Pagine prima dell'accesso e link dall'indirizzo del tenant (MT4-DEC-9, 11, 12; DEF-4.3)

**Files:**
- Create: `web-construct/lib/tenancy/tenant-base-url.ts`, `lib/tenancy/tenant-base-url.integration.test.ts`
- Modify: `web-construct/lib/invitation-email.ts`, `lib/auth-invitations.ts` (`PreparedInvitation` con `tenantId`), `app/api/auth/register/route.ts`, `app/api/auth/register/route.test.ts`, `app/api/auth/forgot-password/route.ts`, `app/api/admin/send-invite/route.ts`, `lib/rbac/users-actions.ts`, `lib/theme-server.ts`, `lib/tenancy/membership.ts`

**Interfaces:**
- Consumes: `resolveHostTenant`, `readRequestHost` (Task 1, 3); `join_by_registration` (Task 3).
- Produces:
  - `tenantBaseUrl(tenantId: TenantId): Promise<string>` — `AUTH_URL` (o `NEXTAUTH_URL`) con il nome dell'host sostituito dall'indirizzo principale del tenant, se esiste; altrimenti `AUTH_URL` così com'è; errore `server_configuration` come oggi se manca;
  - `sendInvitationEmail(invitation, tenantId: TenantId)`; `joinTenantByRegistration(userId: string): Promise<MembershipStatus | null>` in `membership.ts` (tenant dell'indirizzo, chiama `join_by_registration`), che sostituisce `joinDefaultTenant` nella registrazione.

- [✅] **Step 1: Scrivi i test che falliscono**

```ts
it('tenantBaseUrl uses the primary host of the tenant and the scheme and port of AUTH_URL', …)  // http://a.localhost:3000
it('tenantBaseUrl falls back to AUTH_URL for tenants without host', …)
it('register from a.localhost joins A when A accepts self registration', …)
it('register from a.localhost does nothing in A when the switch is off, same answer', …)
it('register with Host: evil.example builds no link on evil.example', …)        // Review Focus #3
it('forgot-password with Host: evil.example builds no link on evil.example', …)
it('the root layout theme on a.localhost is the theme of A', …)                 // getRequestAppTheme
it('on a dedicated host the login page hides "Continua con Google" and signIn refuses OIDC', …) // MT4-DEC-14
```

Per il bottone di Google: la pagina `app/login/page.tsx` sa se l'indirizzo è dedicato
(`resolveHostTenant` + registro) e lo passa a `Login`; il callback `signIn` rifiuta i provider OIDC su
un indirizzo dedicato.

- [✅] **Step 2–4:** `npx vitest run app lib && npm run test:integration -- lib/tenancy`; Expected: PASS.

- [✅] **Step 5: Spunta MT4-OK-5 (la parte senza browser) e commit**

```bash
git commit -m "feat(tenancy): pre-login pages and email links follow the tenant of the host"
```

---

### Task 9: Comandi per gli indirizzi (MT4-DEC-13, 17)

**Files:**
- Modify: `devops/db/migration-lib.mjs`, `devops/db/migration-lib.test.mjs`, `devops/db/db.mjs`, `README.md`
- Test: `web-construct/lib/tenancy/tenant-create-command.integration.test.ts`

**Interfaces:**
- Produces: `parseTenantCreateArguments` accetta `--host <host>` (facoltativo, normalizzato come `normalizeHost`); `parseTenantHostArguments(args): { slug: string; host: string; primary: boolean }` per `tenant-host-add --slug <slug> --host <host> [--primary]` e `test-tenant-host-add`; `tenant-create --host` registra l'indirizzo come principale nella stessa transazione.

- [✅] **Step 1: Scrivi i test che falliscono**

```js
test('tenant-create accepts --host and normalizes it', …)
test('tenant-host-add requires --slug and --host and accepts --primary', …)
```
```ts
it('tenant-create --host a.localhost registers it as primary', …)
it('tenant-host-add refuses the default tenant and the template', …)   // host_not_allowed
it('tenant-host-add refuses a host already taken, and changes nothing', …)
```

- [✅] **Step 2–4:** `npm run test:migrations && npm run test:integration -- lib/tenancy/tenant-create-command.integration.test.ts`; Expected: PASS.

- [✅] **Step 5: Commit** (README: comandi ed esempio con `a.localhost`)

```bash
git commit -m "feat(db): tenant-create --host and tenant-host-add"
```

---

### Task 10: Ogni ingresso fra tenant (DEF-4.4, MT4-OK-4, MT4-RISK-4)

**Files:**
- Create: `web-construct/lib/tenancy/cross-tenant-entry-points.integration.test.ts`, `web-construct/guards/entry-point-inventory.ts` (estratto da `permission-declared.test.ts`, che lo riusa)

**Interfaces:**
- Produces: `listEntryPoints(): EntryPoint[]` (`{ kind: 'action' | 'route' | 'page'; file: string; name: string }`), usato dal guardiano dei permessi e dal test fra tenant.

- [✅] **Step 1: Scrivi il test**

- Ogni ingresso dell'inventario ha un caso nel test o una voce nell'elenco delle esenzioni
  (`EXEMPT: Record<string, string>` con il motivo: salute, dizionario, preferenze personali, pagine
  pubbliche); un ingresso nuovo senza caso né esenzione fa fallire il test.
- Per ogni caso: sessione di una persona amministratore di A (mock di `getSession`/`auth` con
  `tenantState: 'ready'` e tenant A), id di righe di B (utente, ruolo, voce di menu, chiave del tenant
  dove serve); atteso 404 o 403 (rotte), errore o nessun effetto (azioni), `notFound`/redirect
  (pagine), e nessuna riga di B letta o cambiata (verifica con `withOwner` sul tenant B).

- [✅] **Step 2: Verifica che fallisca** prima di completare i casi (l'inventario trova ingressi senza caso).

- [✅] **Step 3: Completa i casi**

- [✅] **Step 4: Verifica**

Run: `npm run test:integration -- lib/tenancy/cross-tenant-entry-points.integration.test.ts && npx vitest run guards`
Expected: PASS.

- [✅] **Step 5: Spunta MT4-RISK-4 e commit**

```bash
git commit -m "test(tenancy): every entry point refuses another tenant's data"
```

---

### Task 11: E2E con l'indirizzo principale, `a.localhost` e `b.localhost` (MT4-OK-1, 2, 3, 5)

**Files:**
- Modify: `tests/e2e/test_tenants.py`, `tests/e2e/conftest.py`, `tests/e2e/helpers.py`, `devops/db/db.mjs` (eventuale `test-reset-e2e` dei tenant di prova)

**Interfaces:**
- Consumes: `test-tenant-create --host`, `test-tenant-host-add` (Task 9).

- [ ] **Step 1: Scrivi i test**

Fixture di sessione: tenant "E2E A" su `a.localhost` e "E2E B" su `b.localhost`, tenant "E2E C"
senza indirizzo; `TEST_EMAIL` membro attivo di predefinito e C (amministratore) e di A e B;
`TEST_EMAIL_USER` membro solo di B. Ogni indirizzo ha il suo stato di accesso (i cookie sono per
indirizzo).

- `test_choose_then_last_used`: indirizzo principale, primo accesso → pagina di scelta con due schede;
  scelta di C → home di C; nuovo accesso → direttamente C (MT4-OK-2).
- `test_switch_from_sidebar`: da C, il selettore mostra predefinito e C, non A né B; passaggio al
  predefinito → home e menu del predefinito.
- `test_subdomains_are_separate`: su `a.localhost` `TEST_EMAIL` vede solo A e nessun elenco; su
  `b.localhost` solo B; `TEST_EMAIL_USER` su `a.localhost` vede "Non sei configurato su questo
  indirizzo." (MT4-OK-3).
- `test_token_from_b_on_a`: lo stato di accesso preso su `b.localhost` presentato a `a.localhost`
  non mostra dati di B (Review Focus #1).
- `test_register_on_subdomain`: interruttore di A acceso → registrazione da `a.localhost` con
  `E2E_REGISTER_EMAIL` crea l'appartenenza in A; spento → stessa risposta, nessuna appartenenza
  (MT4-OK-5).
- `test_login_stays_on_subdomain` (Task 1) resta.

- [ ] **Step 2: Verifica**

Run (controllore: `web-construct-e2e` avviato; nessun test di integrazione in corso): `caffeinate -dims uv run pytest`
Expected: PASS, E2E completo (MT4-OK-1: i test di oggi passano invariati salvo la riga del tenant
nella barra).

- [ ] **Step 3: Spunta MT4-OK-1, 2, 3, 5 e commit**

```bash
git commit -m "test(e2e): tenants on the main address and on subdomains"
```

---

### Task 12: Verifica finale, documenti, database di sviluppo

**Files:**
- Modify: specifica, documento delle cose rimandate (DEF-4.1…4.4 `- [✅]` "fatto nel pezzo 4"; DEF-4.5 resta aperta), `README.md`

- [ ] **Step 1: Controlli completi sul database di prova**

Run: `cd sources/microservices/web-construct && npx tsc --noEmit && npm run lint && npm run test && npm run test:migrations && npm run test:i18n-keys && npm run test:env-contract && npm run test:docs-contract`, poi `npm run test:integration`, poi (finiti questi) l'E2E completo, poi `npm run build` registrando il codice di uscita, `schema-check` e `boundary-check` sul database di prova.
Expected: tutto in regola; solo gli 8 fallimenti noti di `Sidebar*`.

- [ ] **Step 2: Spunte e commit**

```bash
git commit -m "docs(multi-tenancy): tick piece-4 criteria and deferred items"
```

- [ ] **Step 3: Dopo il merge, FERMATI e chiedi al proprietario prima di toccare il database di sviluppo**

Mostra le migrazioni da applicare (0053–0055). Solo dopo un sì esplicito:

```bash
set -a && . ./sources/devops/db/operator.env && set +a && node sources/devops/db/db.mjs apply
```
```bash
node sources/devops/db/db.mjs query "select (select count(*) from public.tenant_host) as indirizzi, (select self_registration from public.tenant_settings) as predefinito_accetta"
```
```bash
node sources/devops/db/db.mjs boundary-check
```
Expected: nessun indirizzo dedicato, il predefinito accetta le registrazioni; `boundary-check` in
regola.
