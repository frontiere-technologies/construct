# Multi-tenancy, pezzo 5a: piattaforma — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** l'amministratore di piattaforma gestisce i tenant da una console sull'indirizzo
principale, entra in un tenant solo con il permesso del suo amministratore, e ogni modifica finisce
in un registro con due viste separate (piattaforma e tenant).

**Architecture:** l'amministratore di piattaforma è un attributo dell'account letto nell'istruzione
unica dell'autorizzazione. Le scritture della piattaforma (tenant, indirizzi, creazione dal modello)
passano da un'identità del database dedicata, usata solo dal modulo `lib/platform`, perché il ruolo
dell'app non può scriverle e le funzioni `security definer` sono vietate. Il registro è fatto di due
tabelle (di tenant e di piattaforma), scritte con un helper nella stessa transazione della
modifica; l'assistenza è un nuovo stato del tenant nel token, rivalidato a ogni richiesta.

**Tech Stack:** Next.js 16.4 (App Router, `proxy.ts`), Auth.js 5 beta, Drizzle ORM con postgres.js
(`prepare: false`), PostgreSQL 15+ (sviluppo su Supabase), ag-grid, shadcn/ui, Vitest, pytest +
Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-26-multi-tenancy-piece-5a-platform-design.md`](../specs/2026-10-26-multi-tenancy-piece-5a-platform-design.md)
(MT5-DEC-1…25, §2 database, §3 applicazione, §4 test, MT5-OK-1…5, MT5-RISK-1…4). Contesto: le
specifiche e i piani dei pezzi [2](2026-10-20-multi-tenancy-piece-2-memberships.md) e
[4](2026-10-21-multi-tenancy-piece-4-current-tenant.md), da cui questo piano riprende forma e
convenzioni.

**Mappa del codice:** `.superpowers/sdd/piece-5a/code-map.md` (ignorata da git): autorizzazione,
token, scritture dei tenant, email, tutte le porte che modificano dati, ruolo 2, modelli di pagine
di amministrazione, inventario degli ingressi, modello. Chi esegue un task la legge prima.

## Global Constraints

- **Isolamento invariato:** `withTenant`/`withGlobal` restano le porte dell'app; nessuna funzione `security definer`; funzioni nuove `security invoker set search_path = ''`; una funzione che cambia `app.tenant_id` lo rimette com'era; solo `lib/tenancy` costruisce un `TenantId`.
- **Identità di piattaforma (MT5-RISK-1):** la usa solo `lib/platform/**`; ogni porta della piattaforma verifica l'amministratore di piattaforma **prima** di aprire una transazione con quell'identità; un controllo automatico rifiuta ogni import da fuori `lib/platform`.
- **La piattaforma non vede dentro i tenant (MT5-OK-2):** senza un permesso di assistenza valido, nessuna porta della piattaforma legge dati di tenant (menu, ruoli, persone, registro del tenant), salvo il modello e lo stato del permesso. Contare persone e amministratori per l'elenco è ammesso (numeri, non dati).
- **Registro (MT5-DEC-15):** ogni voce si scrive nella stessa transazione della modifica; il ruolo dell'app ha solo `insert` e `select` (dove previsto) sulle tabelle del registro, mai `update` né `delete`; i dettagli non contengono mai password, token, link d'invito (MT5-RISK-4).
- **Assistenza (MT5-DEC-10, 19):** solo dall'indirizzo principale, solo con permesso valido (salvo il modello), mai in un tenant sospeso o archiviato; si esce alla richiesta successiva a scadenza, revoca, sospensione o perdita dell'attributo.
- **Console solo sull'indirizzo principale (MT5-DEC-3):** su un indirizzo dedicato le pagine e le rotte della piattaforma rispondono come se non esistessero (404).
- **Navigazione dopo un'azione:** le azioni della piattaforma e dell'assistenza non finiscono con `redirect()` (Next rende la destinazione con `Host` interno, vedi pezzo 4): ritornano lo stato e il client carica la pagina.
- **Migrazioni:** dalla 0057, una per task che cambia lo schema; mai modificare una migrazione già applicata al database di prova; dopo ogni migrazione `schema-write` e `schema-check`; `lib/db/schema.ts` nello stesso task; il contratto di schema e `boundary-check` restano in regola.
- **Comandi del database di prova** (dalla radice): `set -a && . ./sources/devops/db/operator.env && set +a && TEST_DATABASE_DISPOSABLE=1 node sources/devops/db/db.mjs test-apply`; `cd sources/microservices/web-construct && npm run test:integration -- <file>`.
- **Database:** nessuna produzione; il database di sviluppo è alla 0056 e si tocca **solo nel Task 12, dopo il merge e un sì esplicito del proprietario**; test di integrazione ed E2E solo sul database di prova e **mai insieme**; E2E con `web-construct-e2e` avviato dal controllore; Mac alla corrente e `caffeinate -dims` per le serie lunghe.
- **Viaggi:** i tetti di `lib/db/round-trip-budget.integration.test.ts` non salgono per lo stato `ready`.
- **Testi** in italiano e inglese, seminati con `apply_translation_seed`; permessi dichiarati in `guards/permission-declared.test.ts`; ingressi nuovi nell'inventario del pezzo 4 (casi o esenzioni motivate).
- **CI:** prima di dichiarare un task finito girano anche `npm run test:raw-colors`, `test:tokens`, `test:collection`, `test:i18n-keys`, `test:env-contract`, `test:docs-contract`, `test:migrations` e `npm audit --omit=dev`.
- **Lingua e commit:** commenti, testi e uscita dei comandi in italiano; commit in inglese `type(scope): …` chiusi da `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Checkbox:** MT5-OK e MT5-RISK si spuntano `- [✅]` nella specifica quando verificati; i passi di questo piano qui; le righe MT-5.1…5.6 e MT-2.7 nella tabella `docs/input-specs/multi-tenancy/multi-tenancy-roadmap.md` nel Task 12.
- **Base dei test unitari:** gli 8 fallimenti noti di `components/Sidebar*.test.tsx` (Node 26) non contano.

## Review Focus

1. **L'identità di piattaforma usata da una porta che non ha verificato l'attributo** (o importata
   fuori da `lib/platform`). → guardia di import e test "ogni porta della piattaforma rifiuta chi non
   è amministratore di piattaforma" nel Task 3 e nel Task 11.
2. **Un'assistenza che sopravvive al permesso** (scadenza mentre si lavora, revoca, sospensione). →
   test con l'orologio spostato nel Task 9.
3. **Una porta che modifica dati senza voce nel registro**, o una voce scritta anche quando la
   modifica fallisce. → test di copertura nel Task 5.
4. **Il registro di un tenant letto da un altro tenant o dalla piattaforma.** → test delle due
   viste nel Task 10.
5. **Un link d'invito, un token o una password finiti nei dettagli del registro.** → test nel Task 5
   e nel Task 8.

---

## Mappa dei file

| File | Responsabilità | Task |
|---|---|---|
| `devops/db/migrations/0057_platform_admin_and_audit.sql` | attributo, registri, permesso di assistenza, permesso di lettura del registro, copia, ingresso automatico | 1 |
| `devops/db/migrations/0058_remove_role_2.sql` | via il ruolo 2 | 2 |
| `devops/db/db.mjs`, `migration-lib.mjs` | identità di piattaforma, `platform-admin-add`, registro dai comandi | 3, 6 |
| `web-construct/lib/platform/db.ts` | `withPlatform` | 3 |
| `web-construct/guards/platform-boundary.test.ts` | import riservato | 3 |
| `web-construct/lib/rbac/auth-roles.ts`, `actor.ts`, `auth-guard.ts`, `access-declarations.ts`, `lib/auth.config.ts`, `types/next-auth.d.ts` | attributo nell'autorizzazione e nella sessione, porte della piattaforma, instradamento | 4 |
| `web-construct/lib/audit/*` | registro: tipi, scrittura, lettura | 5, 10 |
| `web-construct/app/platform/**`, `app/api/platform/**`, `components/platform/**`, `lib/platform/*-service.ts`, `lib/platform/*-actions.ts` | console | 7, 8, 10 |
| `web-construct/lib/tenancy/support-*.ts`, `components/tenancy/SupportBanner.tsx`, `components/settings/TenantSettings.tsx` | permesso e stato di assistenza | 9 |
| `web-construct/app/(protected)/(admin)/admin/audit/page.tsx` | registro del tenant | 10 |
| `tests/e2e/test_platform.py` | E2E | 11 |

---

### Task 1: Database: attributo, registri, permesso di assistenza (§2.1, §2.3, §2.4, MT5-DEC-1, 10, 14, 15, 23)

**Files:**
- Create: `devops/db/migrations/0057_platform_admin_and_audit.sql`, `web-construct/lib/audit/audit-schema.integration.test.ts`
- Modify: `web-construct/lib/db/schema.ts`, `devops/db/schema.sql`, `web-construct/lib/rbac/permission-catalog.ts`, `web-construct/lib/tenancy/tenant-template.integration.test.ts`, `web-construct/lib/schema-contract.integration.test.ts`, `devops/db/db.mjs` (`boundaryCheck`)

**Interfaces:**
- Produces (SQL):
  - `users.is_platform_admin boolean not null default false`;
  - `tenant_settings.support_until timestamptz`, `support_granted_by uuid references users(id) on delete set null`, `support_granted_at timestamptz`;
  - tabella di tenant `public.tenant_audit_event (id bigint generated always as identity, id_tenant … default app_private.current_tenant_id(), occurred_at timestamptz not null default now(), actor_user_id uuid, actor_email text, actor_kind text not null check (actor_kind in ('person','platform','command')), operation text not null, object_type text, object_id text, details jsonb not null default '{}')`, PK `(id_tenant, id)`, indice `(id_tenant, occurred_at desc)`, `protect_tenant_table`; al ruolo dell'app solo `select, insert`;
  - tabella globale `public.platform_audit_event` con le stesse colonne più `id_tenant bigint references tenant(id)` facoltativo; al ruolo dell'app solo `insert` (per lingue e traduzioni, MT5-DEC-24); lettura e scrittura complete per `construct_owner`; classificata nel registro delle tabelle in modo coerente (estendi `declare_global_table` o il registro con una classe "solo inserimento" e aggiorna contratto e `boundary-check`);
  - permesso `read-tenant-audit` concesso a `TENANT_ADMIN` in ogni tenant e nel modello;
  - `copy_tenant` (`create or replace`, corpo in 0053): `tenant_audit_event` fra le tabelle saltate apposta;
  - `ensure_default_membership` (`create or replace`, corpo in 0054): ritorna `null` per un amministratore di piattaforma (MT5-DEC-23).
- Produces (Drizzle): `users.isPlatformAdmin`, `tenantSettings.supportUntil|supportGrantedBy|supportGrantedAt`, `tenantAuditEvent`, `platformAuditEvent`; `'read-tenant-audit'` in `PERMISSION_CODES`.

- [✅] **Step 1: Test che falliscono**

```ts
it('the runtime role can insert and select tenant_audit_event but never update or delete it', …) // 42501
it('the runtime role can insert platform_audit_event but cannot read, update or delete it', …)
it('tenant_audit_event rows of B are invisible from A', …)
it('a tenant created from the template has no audit rows and the template audit stays untouched', …)
it('ensure_default_membership creates nothing for a platform admin', …)
it('TENANT_ADMIN holds read-tenant-audit in default, template and a fresh copy', …)
```

- [✅] **Step 2: Verifica che falliscano** — `npm run test:integration -- lib/audit/audit-schema.integration.test.ts`; Expected: FAIL (relazioni mancanti).
- [✅] **Step 3: Migrazione 0057, Drizzle, catalogo, contratto e `boundary-check`**
- [✅] **Step 4: Applica e verifica** — `test-apply`, `schema-write`, `schema-check`; `npm run test:integration -- lib/audit lib/tenancy lib/schema-contract.integration.test.ts`; `boundary-check` sul database di prova; Expected: PASS.
- [✅] **Step 5: Commit** — `feat(platform): platform admin attribute, audit tables and support consent`

---

### Task 2: Via il ruolo 2 (MT5-DEC-18)

**Files:**
- Create: `devops/db/migrations/0058_remove_role_2.sql`, `web-construct/lib/rbac/role-2-removal.integration.test.ts`
- Modify: `devops/db/schema.sql`, `web-construct/lib/tenancy/tenant-template.integration.test.ts` (impronta dei ruoli)

**Interfaces:**
- Produces: nessun ruolo senza `system_key` con descrizione `'Tenant Super Administrator'` in nessun tenant né nel modello; chi aveva solo quel ruolo conserva `REGISTERED`.

- [✅] **Step 1: Test** — `it('no tenant nor the template has the Tenant Super Administrator role', …)`; `it('a person who had only role 2 still has the base role', …)` (fixture: crea il caso in un tenant di prova prima di applicare la 0058 con `test-apply --to 0057`).
- [✅] **Step 2–4:** migrazione che scorre i tenant impostando e rimettendo `app.tenant_id`; `test-apply`, `schema-write`, `schema-check`; integrazione su `lib/rbac lib/tenancy`.
- [✅] **Step 5: Commit** — `feat(rbac): remove the unused Tenant Super Administrator role`

---

### Task 3: Identità di piattaforma (§2.2, MT5-RISK-1)

**Files:**
- Create: `web-construct/lib/platform/db.ts`, `lib/platform/db.integration.test.ts`, `web-construct/guards/platform-boundary.test.ts`
- Modify: `devops/db/db.mjs` (`provision-platform-role`, `boundaryCheck`), `devops/db/operator.env.example`, `web-construct/.env.template`, `devops/env-contract.test.mjs` (se serve), `README.md`

**Interfaces:**
- Produces:
  - ruolo di login `construct_platform` (nome da `CONSTRUCT_PLATFORM_DB_USER`, password da `CONSTRUCT_PLATFORM_DB_PASSWORD` in `operator.env`), membro di `construct_owner` con `NOINHERIT`, senza BYPASSRLS; creato da `db.mjs provision-platform-role` (modello `provision-runtime-role`) e da `test-provision-platform-role`;
  - variabile dell'app `PLATFORM_DATABASE_URL` (documentata in `.env.template`; nel database di prova `TEST_PLATFORM_DATABASE_URL` per i test);
  - `withPlatform<T>(fn: (tx: PlatformTx) => Promise<T>, tenantId?: TenantId): Promise<T>` in `lib/platform/db.ts`: transazione con `set local role construct_owner` e, se dato, `set_config('app.tenant_id', …, true)`; `PlatformTx`;
  - guardia: nessun file fuori da `lib/platform/**` importa `lib/platform/db` (e i test d'integrazione dedicati);
  - `boundary-check`: l'identità di piattaforma esiste solo se configurata, è membro di `construct_owner` con NOINHERIT, non ha BYPASSRLS né superuser, e il ruolo dell'app non ne è membro.

- [✅] **Step 1: Test** — `withPlatform` scrive `tenant` e `tenant_host`; senza `set local role` non potrebbe (verifica 42501 con una connessione dell'app); la guardia fallisce con un import finto fuori da `lib/platform`.
- [✅] **Step 2–4:** come sopra; `npm run test:integration -- lib/platform`, `npx vitest run guards`, `npm run test:env-contract`, `boundary-check` sul database di prova.
- [✅] **Step 5: Commit** — `feat(platform): dedicated database identity reachable only from lib/platform`

---

### Task 4: Amministratore di piattaforma nell'autorizzazione e nell'instradamento (§3.1, MT5-DEC-1, 3)

**Files:**
- Modify: `web-construct/lib/rbac/auth-roles.ts`, `lib/rbac/actor.ts`, `lib/rbac/auth-guard.ts`, `lib/rbac/access-declarations.ts`, `lib/auth.ts` (callback `session`), `lib/auth.config.ts`, `types/next-auth.d.ts`, `guards/entry-point-inventory.ts`, `lib/db/round-trip-budget.integration.test.ts`
- Test: `lib/rbac/platform-guard.integration.test.ts`, `lib/auth.config.test.ts`

**Interfaces:**
- Consumes: `users.isPlatformAdmin` (Task 1); `isDedicatedHost`, `readRequestHost` (pezzo 4).
- Produces:
  - `AuthorizationSnapshot.isPlatformAdmin: boolean` letto nella stessa istruzione (nessun viaggio in più);
  - sessione: `session.user.isPlatformAdmin: boolean`;
  - `type PlatformActor = { userId: string; email: string }`; `requirePlatformAdmin(): Promise<PlatformActor>` (azioni e rotte; errore come `requirePermission`) e `requirePlatformAdminPage(): Promise<PlatformActor>` (pagine; `notFound()` se non ammesso), in `lib/rbac/auth-guard.ts`: rileggono l'attributo dal database (non dal token), funzionano in ogni stato del tenant, rifiutano su un indirizzo dedicato; dichiarati in `DECLARATION_MODULES`;
  - instradamento: `/platform` e sottopagine ammesse a un amministratore di piattaforma in ogni stato del tenant sull'indirizzo principale; in stato `none` un amministratore di piattaforma ha come casa `/platform` invece di `/no-tenant`.

- [✅] **Step 1: Test**

```ts
it('requirePlatformAdmin refuses a tenant admin who is not platform admin', …)
it('requirePlatformAdmin works in state none, choose and ready on the main address', …)
it('requirePlatformAdmin refuses on a dedicated host', …)
it('a platform admin in state none is routed to /platform, others to /no-tenant', …)
it('the ready path keeps its round-trip caps', …)
```

- [✅] **Step 2–4:** focalizzati, poi `npx vitest run lib guards` e `npm run test:integration -- lib/rbac lib/db/round-trip-budget.integration.test.ts`.
- [✅] **Step 5: Commit** — `feat(rbac): platform admin attribute in authorization, guards and routing`

---

### Task 5: Registro scritto con ogni modifica (§2.4, MT5-DEC-14, 15, 20; MT5-OK-1; MT5-RISK-3, 4)

**Files:**
- Create: `web-construct/lib/audit/audit-types.ts`, `lib/audit/tenant-audit.ts`, `lib/audit/platform-audit.ts`, `lib/audit/audit-coverage.integration.test.ts`
- Modify: tutte le azioni che modificano dati di tenant (elenco nella mappa del codice, §5): `lib/rbac/roles-actions.ts`, `navigation-actions.ts`, `users-actions.ts`, `lib/theme-actions.ts`, `lib/tenancy/tenant-settings-actions.ts`, `app/api/admin/send-invite/route.ts`, `app/api/auth/register/route.ts` (ingresso con registrazione), più `lib/i18n/language-actions.ts`, `lib/i18n/translation-actions.ts` (registro della piattaforma, togliendo `auditI18n` di `lib/i18n/audit.ts`)

**Interfaces:**
- Produces:
  - `type AuditActorKind = 'person' | 'platform' | 'command'`; `type AuditActor = { userId: string | null; email: string | null; kind: AuditActorKind }`;
  - `type AuditOperation` = unione di codici stabili: `'role.create' | 'role.rename' | 'role.permissions' | 'role.functionalities' | 'role.delete' | 'menu.create' | 'menu.update' | 'menu.move' | 'menu.delete' | 'member.add' | 'member.roles' | 'member.status' | 'member.invite' | 'member.join' | 'theme.save' | 'settings.self_registration' | 'support.grant' | 'support.revoke' | 'support.enter' | 'support.exit' | 'tenant.create' | 'tenant.status' | 'tenant.host.add' | 'tenant.host.remove' | 'tenant.host.primary' | 'tenant.admin.add' | 'tenant.invite.resend' | 'platform.admin.add' | 'platform.admin.remove' | 'language.create' | 'language.update' | 'language.active' | 'language.default' | 'language.delete' | 'translation.key.create' | 'translation.key.delete' | 'translation.save'` (estendibile solo qui);
  - `recordTenantAudit(tx: TenantTx | PlatformTx, actor: AuditActor, event: { operation: AuditOperation; objectType: string; objectId: string | number | null; details?: Record<string, unknown> }): Promise<void>`;
  - `recordPlatformAudit(tx, actor, event & { tenantId?: TenantId | null }): Promise<void>`;
  - `auditActorOf(actor: Actor | PlatformActor): AuditActor` (veste `platform` quando l'attore è in assistenza, Task 9);
  - `sanitizeAuditDetails(details): Record<string, unknown>`: toglie chiavi che contengono `password`, `token`, `link`, `secret` (MT5-RISK-4).

- [✅] **Step 1: Test di copertura** — riusa l'inventario del pezzo 4 (`guards/entry-point-inventory.ts`): ogni porta che modifica dati ha un caso (successo → voce con l'operazione attesa; fallimento → nessuna voce) o un'esenzione motivata (preferenze personali, password, accesso, letture). Il test fallisce se compare una porta nuova senza caso né esenzione.

```ts
it('createRole writes role.create in the tenant audit of the actor tenant', …)
it('a refused updateUserRoles writes no audit row', …)
it('details never contain password, token or link keys', …)
it('language and translation writes go to the platform audit, not to a tenant audit', …)
```

- [✅] **Step 2: Verifica che falliscano** — il test di copertura elenca le porte scoperte.
- [✅] **Step 3: Helper e una chiamata per porta, dentro la stessa transazione della modifica.**
- [✅] **Step 4:** `npm run test:integration -- lib/audit lib/rbac lib/i18n lib/tenancy`, `npx vitest run lib guards`; Expected: PASS.
- [✅] **Step 5: Spunta MT5-OK-1, MT5-RISK-3, MT5-RISK-4 e commit** — `feat(audit): every tenant change writes its audit row in the same transaction`

---

### Task 6: Comandi della piattaforma e registro dai comandi (MT5-DEC-2, 22, 23)

**Files:**
- Modify: `devops/db/db.mjs`, `devops/db/migration-lib.mjs`, `migration-lib.test.mjs`, `web-construct/lib/tenancy/tenant-create-command.integration.test.ts`, `README.md`
- Create: `web-construct/lib/platform/platform-admin-command.integration.test.ts`

**Interfaces:**
- Produces: `platform-admin-add --email <email>` e `platform-admin-remove --email <email>` (più `test-*`): crea l'account se manca (link per la password verso `AUTH_URL`, stampato), imposta l'attributo, rifiuta di togliere l'ultimo; `tenant-create`, `tenant-host-add` e i nuovi comandi scrivono `platform_audit_event` con `actor_kind = 'command'`, `actor_email` = utente del sistema operativo se disponibile.

- [✅] **Step 1–4:** test del parser (`parsePlatformAdminArguments`), test d'integrazione dei comandi (attributo, account nuovo con link, ultimo non rimovibile, voce nel registro della piattaforma con veste `command`); `npm run test:migrations`, integrazione.
- [✅] **Step 5: Commit** — `feat(db): platform-admin commands and command audit rows`

---

### Task 7: Console: struttura, elenco dei tenant, amministratori di piattaforma (MT5-DEC-3, 4, 2)

**Files:**
- Create: `devops/db/migrations/0059_platform_translations.sql` (tutte le chiavi dell'interfaccia del pezzo 5a), `web-construct/app/platform/layout.tsx`, `app/platform/page.tsx` (elenco), `app/platform/admins/page.tsx`, `app/api/platform/tenants-grid/route.ts`, `components/platform/TenantsTableClient.tsx`, `components/platform/PlatformAdmins.tsx`, `lib/platform/tenant-service.ts`, `lib/platform/platform-admin-actions.ts`, i test
- Modify: `web-construct/app/(protected)/layout.tsx` (voce "Piattaforma" per gli amministratori di piattaforma sull'indirizzo principale), `guards/entry-point-inventory.ts` (pagine fuori da `(protected)`), `lib/tenancy/cross-tenant-entry-points.integration.test.ts` (casi o esenzioni)

**Interfaces:**
- Produces:
  - `listTenantsForPlatform(query): Promise<{ rows: PlatformTenantRow[]; total: number }>` con `PlatformTenantRow = { id: number; slug: string; name: string; status: 'active'|'suspended'|'archived'; isTemplate: boolean; primaryHost: string | null; activeMembers: number; adminEmails: string[]; createdAt: string }` (solo numeri e email degli amministratori, nessun altro dato del tenant); archiviati esclusi salvo filtro;
  - `addPlatformAdmin(email: string): Promise<{ ok: true; invited: boolean }>`, `removePlatformAdmin(userId: string): Promise<{ ok: true }>` (`'use server'`, `requirePlatformAdmin`, rifiuto dell'ultimo, registro della piattaforma, email d'invito verso l'indirizzo principale per un account nuovo);
  - la console ha un suo layout con la sezione "Piattaforma" (Tenant, Amministratori, Registro, Lingue, Traduzioni) e, se la persona è membro di un tenant sull'indirizzo, un collegamento per tornarci.

- [✅] **Step 1–4:** test unitari dei componenti, d'integrazione del servizio (nessun dato di tenant oltre ai conteggi e alle email degli amministratori; il modello in cima), della rotta (403 a chi non è piattaforma, 404 su indirizzo dedicato), delle azioni; `test:i18n-keys`.
- [✅] **Step 5: Commit** — `feat(platform): console shell, tenant list and platform admins`

---

### Task 8: Console: nuovo tenant, scheda, stati (MT5-DEC-5, 6, 7, 8, 9, 25)

**Files:**
- Create: `web-construct/app/platform/tenants/[tenantId]/page.tsx`, `components/platform/NewTenantDialog.tsx`, `components/platform/TenantDetail.tsx`, `lib/platform/tenant-actions.ts`, i test; se serve una funzione SQL per iscrivere il primo amministratore senza segnare l'invito come consegnato, una migrazione con il numero libero successivo
- Modify: `web-construct/lib/tenancy/token-tenant.ts` e `components/tenancy/TenantNotConfigured.tsx` (messaggio del tenant sospeso), le porte d'invito e registrazione (blocco in tenant sospeso o archiviato)

**Interfaces:**
- Produces (`'use server'`, tutte con `requirePlatformAdmin`, conferma lato interfaccia, voce nel registro della piattaforma **e** del tenant, MT5-DEC-20):
  - `createTenant(input: { name: string; slug: string; host?: string; adminEmail: string }): Promise<{ ok: true; tenantId: number; invited: boolean }>` — una sola transazione `withPlatform` (copia dal modello, indirizzo principale, membro e ruoli `REGISTERED`+`TENANT_ADMIN` dell'amministratore); dopo il commit, se l'account non ha password, `prepareInvitation` + `sendInvitationEmail(invitation, tenantId)`;
  - `setTenantStatus(tenantId: number, status: 'active'|'suspended'|'archived', reason?: string)` (motivo obbligatorio per `archived`; ripristino da `archived` solo con conferma esplicita);
  - `addTenantHost(tenantId, host, primary)`, `removeTenantHost(tenantId, host)`, `setPrimaryHost(tenantId, host)` (regole del pezzo 4: normalizzazione, niente predefinito né modello, indirizzo libero);
  - `addTenantAdmin(tenantId, email)`, `resendTenantInvite(tenantId, userId)` — rifiutate in un tenant sospeso o archiviato (MT5-DEC-25);
  - token: stato `none` con `tenantNoneReason: 'suspended' | null`; `/no-tenant` mostra "Questo spazio è sospeso. Contatta il tuo amministratore." quando l'unico tenant della persona sull'indirizzo è sospeso o archiviato.

- [ ] **Step 1: Test**

```ts
it('createTenant copies the template, sets the primary host, makes the admin, and emails a link to the tenant host', …)
it('createTenant for an account with a password sends no email and returns invited: false', …)
it('createTenant with a taken host or slug creates nothing', …)
it('suspending moves members out at the next request and shows the suspended message to single-tenant people', …)
it('archive requires a reason and hides the tenant from the default list', …)
it('add admin and resend invite are refused in a suspended tenant', …)
it('each console action writes one row in the platform audit and one in the tenant audit', …)
it('the platform audit row of createTenant contains no link or token', …)
```

- [ ] **Step 2–4:** come sopra.
- [ ] **Step 5: Spunta MT5-OK-3 (parte senza browser) e commit** — `feat(platform): create tenants with an emailed invitation and manage their lifecycle`

---

### Task 9: Permesso e stato di assistenza (MT5-DEC-10, 11, 12, 19; MT5-RISK-2)

**Files:**
- Create: `web-construct/lib/tenancy/support-consent.ts`, `lib/tenancy/support-consent-actions.ts`, `lib/platform/support-actions.ts`, `components/tenancy/SupportBanner.tsx`, i test; chiavi nuove solo se 0059 non le ha (migrazione con numero libero)
- Modify: `web-construct/components/settings/TenantSettings.tsx`, `app/(protected)/(admin)/admin/tenant-settings/page.tsx`, `lib/tenancy/token-tenant.ts`, `lib/tenancy/tenant-selection.ts`, `lib/auth.ts`, `lib/rbac/actor.ts`, `types/next-auth.d.ts`, `app/(protected)/layout.tsx`, `components/platform/TenantDetail.tsx`

**Interfaces:**
- Produces:
  - `grantSupportConsent(duration: '1h' | '1d' | '1w'): Promise<{ ok: true; until: string }>` e `revokeSupportConsent(): Promise<{ ok: true }>` (`'use server'`, `requirePermission('manage-tenant-settings')`, rifiutate in stato di assistenza; registro del tenant `support.grant` / `support.revoke`);
  - `readSupportConsent(tx): Promise<{ until: string | null; grantedBy: string | null }>`;
  - `startSupport(tenantId: number, reason: string): Promise<{ state: TenantState }>` e `endSupport(): Promise<{ state: TenantState }>` (`'use server'`, `requirePlatformAdmin`): verificano permesso valido (o modello), tenant attivo, indirizzo principale; scrivono `support.enter` / `support.exit` nei due registri; aggiornano il token; il client carica `/` (o `/platform` all'uscita);
  - token: `TenantState` aggiunge `'support'`; campi `supportUntil: string | null`, `supportReason`; rivalidazione a ogni richiesta in stato `support`: permesso ancora valido (o modello), tenant attivo, attributo ancora presente, indirizzo principale — altrimenti esce verso la console;
  - attore in assistenza: permessi di `TENANT_ADMIN` del tenant meno la gestione del permesso di assistenza; `auditActorOf` dà veste `platform`;
  - `SupportBanner`: fascia sempre visibile "Stai lavorando come piattaforma in {{tenant}}, fino alle {{time}}" con "Esci".

- [ ] **Step 1: Test**

```ts
it('without consent startSupport is refused and nothing is written', …)
it('with consent the platform admin is ready-like in that tenant only, until the expiry', …)
it('expiry, revocation, suspension or losing the attribute end support at the next request', …) // orologio spostato
it('support in a dedicated-host tenant works from the main address and is refused from the dedicated host', …)
it('the template is reachable without consent', …)
it('changes during support are written in the tenant audit with actor_kind platform', …)
it('during support the consent actions are refused', …)
```

- [ ] **Step 2–4:** come sopra.
- [ ] **Step 5: Spunta MT5-RISK-2 e commit** — `feat(platform): support access only with the tenant's time-limited consent`

---

### Task 10: Registri, lingue e traduzioni nella console (MT5-DEC-16, 17, 21, 24; MT5-OK-4)

**Files:**
- Create: `web-construct/app/(protected)/(admin)/admin/audit/page.tsx`, `app/api/audit/tenant-grid/route.ts`, `app/platform/audit/page.tsx`, `app/api/platform/audit-grid/route.ts`, `components/audit/AuditTableClient.tsx`, `lib/audit/audit-read-service.ts`, `app/platform/languages/page.tsx`, `app/platform/translations/**`, i test; migrazione con il numero libero successivo per la voce di menu "Registro" del tenant (predefinito, modello, ogni tenant), concessa a `TENANT_ADMIN`
- Modify: `web-construct/lib/rbac/actor.ts` (via la regola "solo dal tenant predefinito"), `lib/i18n/language-actions.ts`, `lib/i18n/translation-actions.ts` (scritture con `requirePlatformAdmin`), le pagine di lingue e traduzioni del tenant (sola lettura), `lib/i18n/global-catalog-tenant.integration.test.ts`, `lib/tenancy/cross-tenant-entry-points.integration.test.ts` (motivi delle esenzioni)

**Interfaces:**
- Produces:
  - `listTenantAudit(tenantId: TenantId, query): Promise<{ rows: AuditRow[]; total: number }>` (registro del tenant; filtri periodo, persona, operazione) letto dalla porta con `requirePermission('read-tenant-audit')`;
  - `listPlatformAudit(query)` (registro della piattaforma, con `withPlatform`, `requirePlatformAdmin`) e, nella scheda del modello, `listTemplateAudit(query)`;
  - `AuditRow = { id: string; occurredAt: string; actorEmail: string | null; actorKind: AuditActorKind; operation: AuditOperation; objectType: string | null; objectId: string | null; details: Record<string, unknown>; tenantId?: number | null }`.

- [ ] **Step 1: Test**

```ts
it('the admin of A sees A audit rows including platform support rows, never B rows', …)
it('the platform audit page never returns tenant audit rows except the template', …)
it('a tenant admin can read languages and translations but every write is refused', …)
it('a platform admin without any tenant writes languages and translations from the console', …)
```

- [ ] **Step 2–4:** come sopra.
- [ ] **Step 5: Spunta MT5-OK-4 e commit** — `feat(audit): tenant and platform audit views; global catalogs owned by the platform`

---

### Task 11: Test fra tenant e E2E (MT5-OK-2, 3, 5)

**Files:**
- Modify: `web-construct/lib/tenancy/cross-tenant-entry-points.integration.test.ts`, `tests/e2e/helpers.py`, `tests/e2e/conftest.py`
- Create: `web-construct/lib/platform/platform-entry-points.integration.test.ts`, `tests/e2e/test_platform.py`

**Interfaces:**
- Consumes: `test-platform-admin-add` (Task 6), `test-provision-platform-role` (Task 3); la CI deve provvedere l'identità di piattaforma come il ruolo dell'app (aggiorna `.github/workflows/quality.yml` se serve).

- [ ] **Step 1: Test**
  - ogni porta della piattaforma rifiuta chi non è amministratore di piattaforma e risponde 404 su un indirizzo dedicato (Review Focus #1);
  - senza permesso la piattaforma non legge né scrive dati di un tenant (MT5-OK-2);
  - E2E `test_platform.py`: un amministratore di piattaforma senza tenant arriva sulla console; crea un tenant (l'email d'invito è registrata, non controllata nella casella); lo sospende e un membro vede il messaggio; lo riattiva; l'amministratore del tenant concede l'assistenza, la piattaforma entra con la fascia, modifica un ruolo, esce; l'amministratore del tenant vede la voce nel registro; l'E2E di oggi invariato (MT5-OK-5). Fixture di sessione che pulisce tenant e attributi lasciati da esecuzioni interrotte.
- [ ] **Step 2: Verifica** — `npm run test:integration` (completo), poi `caffeinate -dims uv run pytest` (completo); Expected: PASS.
- [ ] **Step 3: Spunta MT5-OK-2, 3, 5 e commit** — `test(platform): entry points, two audit views and console E2E`

---

### Task 12: Verifica finale, documenti, database di sviluppo

**Files:**
- Modify: specifica, `docs/input-specs/multi-tenancy/2026-10-13-multi-tenancy-deferred.md` (DEF-5.1, 5.3, 5.5, 5.6, 2.7 `- [✅]` "fatto nel pezzo 5a"), `docs/input-specs/multi-tenancy/multi-tenancy-roadmap.md` (MT-5.1…5.6, MT-2.7 `[✅]`), `README.md`

- [ ] **Step 1: Controlli completi sul database di prova** — `npx tsc --noEmit && npm run lint && npm run test` e tutti gli script di contratto e `npm audit --omit=dev`; poi `npm run test:integration`; poi l'E2E completo; poi `npm run build` registrando il codice di uscita; `schema-check` e `boundary-check` sul database di prova. Expected: tutto in regola salvo gli 8 fallimenti noti di `Sidebar*`.
- [ ] **Step 2: Spunte e commit** — `docs(multi-tenancy): tick piece-5a criteria, deferred items and roadmap`
- [ ] **Step 3: Dopo il merge, FERMATI e chiedi al proprietario** prima di toccare il database di sviluppo. Con un sì esplicito: `provision-platform-role` (con le credenziali in `operator.env` e `PLATFORM_DATABASE_URL` nell'app), `apply` delle migrazioni 0057 e successive, `platform-admin-add --email` per il proprietario, `boundary-check`; poi riavvio dell'app e prova della console.
