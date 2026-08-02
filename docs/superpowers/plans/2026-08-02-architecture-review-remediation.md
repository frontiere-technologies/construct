# Architecture Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every current finding in `docs/reviews/2026-07-31-architect-reviewer.md` while preserving the code-review and UI/UX remediation already present in the working tree.

**Architecture:** Keep Next.js as the only end-user data boundary, separate the PostgreSQL migration and runtime identities, and make ordered SQL migrations authoritative. Add one server-side admin layout, database-enforced administrator invariants, retryable invitation delivery, dynamic navigation locales, a reusable production Kubernetes baseline, and evidence-backed review closure.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Auth.js v5, Drizzle ORM, postgres.js, PostgreSQL 17/Supabase, Vitest, Node test runner, Kubernetes/Kustomize, GitHub Actions.

## Findings and recommendations summary

Seven architecture findings already have implementation coverage from the preceding code-review work and require fresh verification. The remaining findings are grouped below by shared boundary rather than review order. Every originating review checkbox must be updated to `- [✅]` immediately after its own fix and focused verification succeed; a later full-suite run does not retroactively justify an unchecked item.

## Global Constraints

- Browser code communicates only with Next.js; no Supabase Data API or direct database access is supported.
- `DATABASE_URL` is the limited runtime connection; `MIGRATION_DATABASE_URL` is required only by migration and role-provisioning commands.
- Database-mutating tests require `TEST_DATABASE_URL`, `TEST_DATABASE_DISPOSABLE=1`, and a target distinct from `DATABASE_URL`.
- Preserve all current public URLs and the existing Auth.js, navigation, RBAC, i18n, code-review, and UI/UX behavior.
- Use `apply_patch` for edits; preserve unrelated dirty-worktree changes.
- Implement behavior changes test-first and observe the expected failure before production edits.
- Do not mark a review finding complete until its focused verification has passed.

## File and responsibility map

- `sources/devops/db/migration-lib.mjs` — pure discovery, checksum, snapshot, and migration-state helpers.
- `sources/devops/db/migration-lib.test.mjs` — Node unit tests for migration ordering, checksums, and snapshot rendering.
- `sources/devops/db/migrations/0001_baseline.sql` — frozen idempotent baseline copied from the current corrected schema.
- `sources/devops/db/migrations/0002_runtime_boundary.sql` — runtime role, grants, indexes, and secure view/function definitions.
- `sources/devops/db/migrations/0003_admin_invariant.sql` — guarded administrator role/status mutations.
- `sources/devops/db/migrations/0004_invitation_lifecycle.sql` — invitation delivery state and token-consumption rules.
- `sources/devops/db/schema.sql` — generated concatenation of ordered migrations; never hand-edited after conversion.
- `sources/devops/db/db.mjs` — migration runner, schema check, application queries, test commands, and runtime-login provisioning.
- `sources/microservices/web-construct/lib/db/schema.ts` — Drizzle declarations for new invitation columns and indexes.
- `sources/microservices/web-construct/lib/schema-contract.integration.test.ts` — deployed catalog, index, privilege, and Drizzle-contract checks.
- `sources/microservices/web-construct/app/(protected)/(admin)/layout.tsx` — authoritative read-side admin guard.
- `sources/microservices/web-construct/lib/rbac/users-actions.ts` — calls guarded database mutations after `requireAdmin()`.
- `sources/microservices/web-construct/lib/auth-invitations.ts` — transaction-safe invitation preparation and delivery-state transitions.
- `sources/microservices/web-construct/lib/auth-invitations.integration.test.ts` — invitation retry, failure, and supersession tests.
- `sources/microservices/web-construct/app/api/auth/register/route.ts` — uniform public registration orchestration.
- `sources/microservices/web-construct/app/api/admin/send-invite/route.ts` — admin-authenticated reuse of invitation lifecycle.
- `sources/microservices/web-construct/lib/rbac/navigation-locales.ts` — normalized dynamic menu-locale descriptors and fallback rules.
- `sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx` — consumes configured navigation locales and configured default.
- `sources/microservices/web-construct/components/rbac/functionalities/TranslationsAccordion.tsx` — renders configured locales instead of a constant.
- `sources/microservices/web-construct/lib/health.ts` — bounded database readiness check.
- `sources/microservices/web-construct/app/api/health/live/route.ts` — process liveness.
- `sources/microservices/web-construct/app/api/health/ready/route.ts` — database readiness.
- `sources/devops/k8s/base/` and `sources/devops/k8s/overlays/` — reusable manifests plus dev and production examples.
- `docs/runbooks/production-deployment.md` — deploy, migration, backup, rollback, restore, and rotation procedure.
- `docs/reviews/2026-07-31-architect-reviewer.md` — finding ledger and remediation evidence.

---

### Task 1: Re-verify prior review fixes and establish the architecture baseline

**Files:**

- Modify: `docs/reviews/2026-07-31-architect-reviewer.md`
- Test: existing authentication, navigation, embedded-check, rate-limit, build, and README checks

**Interfaces:**

- Consumes: current uncommitted code-review remediation.
- Produces: an evidence matrix identifying findings that need no duplicate implementation.

- [ ] **Step 1: Run the focused existing tests**

Run from `sources/microservices/web-construct`:

```bash
npm test -- lib/auth-policy.test.ts lib/auth.config.test.ts lib/rbac/auth-guard.test.ts lib/auth-rate-limit.test.ts lib/rbac/embedded-check.test.ts
```

Expected: PASS. Record file/test counts from fresh output.

- [ ] **Step 2: Run focused integration tests only when the disposable database gate is available**

```bash
I18N_INTEGRATION_DB=1 npm run test:integration -- lib/auth-security.integration.test.ts lib/rbac/navigation-actions.integration.test.ts
```

Expected: PASS with `TEST_DATABASE_URL` and `TEST_DATABASE_DISPOSABLE=1`; otherwise record the tests as defined but not executed.

- [ ] **Step 3: Verify source boundaries without modifying them**

Confirm with `rg` that `auth.ts` refreshes status/roles, `requireAdmin()` performs a fresh lookup, password reset uses `consume_password_set_token`, navigation writes use `db.transaction` plus `pg_advisory_xact_lock`, embedded checks pin validated DNS answers, all public credential routes invoke `enforceAuthRateLimit`, and README uses the current architecture.

- [ ] **Step 4: Update already-proven review items individually**

Change only findings with successful evidence to `- [✅]`, adding a dated remediation paragraph under each. Candidates are ARCH-CRIT-1, ARCH-HIGH-1, ARCH-HIGH-4, ARCH-HIGH-5, ARCH-HIGH-7, ARCH-MED-3, and ARCH-LOW-1.

- [ ] **Step 5: Commit the verified ledger update**

```bash
git add docs/reviews/2026-07-31-architect-reviewer.md
git commit -m "docs: verify existing architecture remediations"
```

---

### Task 2: Introduce immutable, checksummed migrations

**Files:**

- Create: `sources/devops/db/migration-lib.mjs`
- Create: `sources/devops/db/migration-lib.test.mjs`
- Create: `sources/devops/db/migrations/0001_baseline.sql`
- Modify: `sources/devops/db/db.mjs`
- Generate: `sources/devops/db/schema.sql`
- Modify: `sources/microservices/web-construct/package.json`
- Modify: `.github/workflows/quality.yml`

**Interfaces:**

- Produces: `discoverMigrations(dir)`, `migrationChecksum(sql)`, `renderSchemaSnapshot(migrations)`, `applyPendingMigrations(sql, migrations)`.
- Produces commands: `db.mjs apply`, `db.mjs test-apply`, `db.mjs schema-check`, and `npm run test:migrations`.

- [ ] **Step 1: Write failing migration-library tests**

Cover numeric filename ordering, rejection of duplicate versions, SHA-256 checksum stability, exact snapshot rendering, and rejection of changed completed migrations. The public shape is:

```js
const migrations = discoverMigrations('/tmp/example')
// [{ version: '0001', name: 'baseline', filename: '0001_baseline.sql', sql, checksum }]
assert.equal(renderSchemaSnapshot(migrations), expectedSnapshot)
```

- [ ] **Step 2: Run the tests and observe RED**

```bash
node --test sources/devops/db/migration-lib.test.mjs
```

Expected: FAIL because `migration-lib.mjs` does not exist.

- [ ] **Step 3: Implement the pure migration helpers**

Use `node:fs`, `node:path`, and `node:crypto`. Accept only filenames matching `^(\d{4})_([a-z0-9_]+)\.sql$`; hash the exact UTF-8 bytes; render a deterministic header plus files in version order.

- [ ] **Step 4: Make the helper tests GREEN**

```bash
node --test sources/devops/db/migration-lib.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Freeze the corrected current schema as `0001_baseline.sql` and generate `schema.sql`**

Copy the current bytes mechanically, then generate rather than manually rewrite the snapshot. The generated file begins with:

```sql
-- GENERATED FILE. Edit sources/devops/db/migrations/*.sql instead.
-- Migration: 0001_baseline.sql
```

- [ ] **Step 6: Add migration history and transactional execution**

`applyPendingMigrations` creates an internal table inaccessible to the runtime role:

```sql
create table if not exists public.construct_schema_migration (
  version text primary key,
  name text not null,
  checksum char(64) not null,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
)
```

For each migration: reject checksum drift; insert or refresh its `started_at` row with `completed_at = null`; then run the migration SQL plus the `completed_at` update in one `postgres.begin()` transaction. A failure leaves an incomplete history row that is retryable only with the same checksum and is never mistaken for success.

- [ ] **Step 7: Separate migration credentials**

`apply` requires `MIGRATION_DATABASE_URL`; `test-apply` continues using the disposable test URL. `query` remains runtime-oriented and `test-query` remains disposable-test-oriented. A missing migration URL must fail with:

```text
MIGRATION_DATABASE_URL is required for schema migrations
```

- [ ] **Step 8: Add snapshot and CI commands**

Add scripts:

```json
"test:migrations": "node --test ../../devops/db/migration-lib.test.mjs",
"schema:check": "node ../../devops/db/db.mjs schema-check"
```

Run both in the application CI job before build and use the migration runner in the database job.

- [ ] **Step 9: Verify runner behavior on a disposable PostgreSQL database**

Run `test-apply` twice, verify one completed history row, mutate a temporary copy of a completed migration in the unit fixture, and confirm checksum rejection.

- [ ] **Step 10: Commit**

```bash
git add sources/devops/db sources/microservices/web-construct/package.json .github/workflows/quality.yml
git commit -m "feat(db): add checksummed versioned migrations"
```

---

### Task 3: Enforce the least-privilege PostgreSQL runtime boundary and indexes

**Files:**

- Create: `sources/devops/db/migrations/0002_runtime_boundary.sql`
- Modify: `sources/devops/db/db.mjs`
- Modify: `sources/microservices/web-construct/lib/db/schema.ts`
- Create: `sources/microservices/web-construct/lib/schema-contract.integration.test.ts`
- Modify: `sources/microservices/web-construct/.env.template`
- Modify: `sources/devops/k8s/dev/secret.env.example`

**Interfaces:**

- Produces: NOLOGIN role `construct_runtime` and operator command `provision-runtime-role`.
- Consumes environment: `MIGRATION_DATABASE_URL`, `CONSTRUCT_RUNTIME_DB_USER`, `CONSTRUCT_RUNTIME_DB_PASSWORD`.

- [ ] **Step 1: Write failing catalog/privilege integration assertions**

Query `pg_roles`, `information_schema.role_table_grants`, `information_schema.routine_privileges`, `pg_views`, and `pg_indexes`. Assert:

```ts
expect(runtimeRole.rolsuper).toBe(false)
expect(runtimeRole.rolbypassrls).toBe(false)
expect(dataApiGrants).toHaveLength(0)
expect(roleListView.options).toContain('security_invoker=true')
expect(indexNames).toEqual(expect.arrayContaining([
  'user_role_id_role_user_id_idx',
  'navigation_item_parent_order_idx',
]))
```

- [ ] **Step 2: Run the integration test and observe RED**

Expected failures: missing runtime role, invoker view option, and indexes.

- [ ] **Step 3: Add exact SQL hardening**

The migration must create/alter `construct_runtime` as NOLOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS, revoke Construct object access from `PUBLIC`, `anon`, and `authenticated` when those roles exist, recreate `role_list_view` with `security_invoker=true`, revoke default function execution, grant the runtime role only required DML/USAGE/SELECT/EXECUTE, and set matching default privileges for the migration owner.

Add:

```sql
create index if not exists user_role_id_role_user_id_idx
  on public.user_role (id_role, user_id);
create index if not exists navigation_item_parent_order_idx
  on public.navigation_item (id_item_parent, order_position);
```

- [ ] **Step 4: Mirror both indexes in Drizzle**

Use `index(...).on(...)` in the `userRole` and `navigationItem` table callbacks.

- [ ] **Step 5: Implement safe runtime-login provisioning**

Validate the username against `^[a-z_][a-z0-9_]{0,62}$`, require the password from the environment rather than argv, quote identifiers through a dedicated helper, create/update the LOGIN role, revoke direct object privileges, and grant only `construct_runtime` membership.

- [ ] **Step 6: Regenerate and check `schema.sql`**

```bash
node sources/devops/db/db.mjs schema-write
node sources/devops/db/db.mjs schema-check
```

- [ ] **Step 7: Run privilege, catalog, and EXPLAIN verification**

Apply to the disposable database, `SET ROLE construct_runtime`, prove allowed application queries succeed and DDL/migration-table/Data-API-role access fails. Populate representative rows, run `ANALYZE`, and capture `EXPLAIN` without forcing `enable_seqscan=off`; report honestly if tiny tables select a sequential scan.

- [ ] **Step 8: Update and complete ARCH-HIGH-2 and ARCH-LOW-2**

Add remediation evidence and mark each review checkbox `- [✅]` only after Step 7 passes.

- [ ] **Step 9: Commit**

```bash
git add sources/devops/db sources/microservices/web-construct/lib/db/schema.ts sources/microservices/web-construct/lib/schema-contract.integration.test.ts sources/microservices/web-construct/.env.template sources/devops/k8s/dev/secret.env.example docs/reviews/2026-07-31-architect-reviewer.md
git commit -m "feat(db): enforce least-privilege runtime access"
```

---

### Task 4: Add the authoritative admin read layout

**Files:**

- Create: `sources/microservices/web-construct/app/(protected)/(admin)/layout.tsx`
- Create: `sources/microservices/web-construct/app/(protected)/(admin)/layout.test.tsx`
- Move: current `admin/`, `functionalities/`, `roles-permissions/`, and `user-management/` under `(protected)/(admin)/`
- Modify: `docs/reviews/2026-07-31-architect-reviewer.md`

**Interfaces:**

- Consumes: `requireAdmin(): Promise<{ userId: string; roleIds: number[] }>`.
- Produces: URL-transparent protected layout for every privileged page.

- [ ] **Step 1: Write the failing layout test**

Mock only `requireAdmin`; call the async layout and assert it invokes the fresh database-backed guard before returning children. Add a filesystem contract that enumerates the expected administrative page paths beneath `(admin)`.

- [ ] **Step 2: Run and observe RED**

```bash
npm test -- 'app/(protected)/(admin)/layout.test.tsx'
```

Expected: FAIL because the layout/group is absent.

- [ ] **Step 3: Add the minimal layout and move routes**

```tsx
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return children
}
```

Move files without changing their route-relative contents or URLs.

- [ ] **Step 4: Run focused tests and build**

Run the layout test, auth guard/config tests, and `npm run build`. Confirm generated routes retain `/admin/*`, `/functionalities/*`, `/roles-permissions/*`, and `/user-management`.

- [ ] **Step 5: Complete ARCH-HIGH-3 and commit**

```bash
git add sources/microservices/web-construct/app/'(protected)' docs/reviews/2026-07-31-architect-reviewer.md
git commit -m "fix(authz): guard all administrative reads"
```

---

### Task 5: Make the last-active-administrator invariant atomic

**Files:**

- Create: `sources/devops/db/migrations/0003_admin_invariant.sql`
- Modify: `sources/microservices/web-construct/lib/rbac/users-actions.ts`
- Create: `sources/microservices/web-construct/lib/rbac/users-actions.integration.test.ts`
- Modify: `sources/microservices/web-construct/lib/schema-contract.integration.test.ts`
- Modify: `docs/reviews/2026-07-31-architect-reviewer.md`

**Interfaces:**

- Produces SQL functions `replace_user_roles_guarded(uuid, bigint[])` and `set_user_status_guarded(uuid, bigint)`.
- Both raise SQLSTATE `P0001` with stable message `last_active_administrator` on invariant conflict.

- [ ] **Step 1: Write failing integration tests**

Cover normal role replacement, normal activation/deactivation, rejection when a mutation would leave zero active admins, and two concurrent connections demoting/deactivating different admins. Assert exactly one competing mutation succeeds and at least one active admin remains.

- [ ] **Step 2: Run and observe RED**

Expected: missing guarded functions and the existing TOCTOU race reproduces under coordinated transactions.

- [ ] **Step 3: Add the database functions**

Both functions execute:

```sql
perform pg_advisory_xact_lock(49374202);
-- perform the requested mutation
if not exists (
  select 1 from public.users u
  join public.user_role ur on ur.user_id = u.id
  where u.id_user_status = 2 and ur.id_role = 1
) then
  raise exception using errcode = 'P0001', message = 'last_active_administrator';
end if;
```

Role replacement always inserts Registered role `0`. Validate target/status/role IDs before mutation and grant execution only to `construct_runtime`.

- [ ] **Step 4: Replace application-side check-then-write calls**

Keep `requireAdmin()` and self-edit validation, but call the guarded SQL functions for the authoritative mutation. Map only `last_active_administrator` to the existing user-facing guard error; wrap other failures generically.

- [ ] **Step 5: Run focused unit and integration tests**

Run `user-guards.test.ts`, `auth-guard.test.ts`, and the new integration test twice to expose flakiness.

- [ ] **Step 6: Regenerate schema, complete ARCH-HIGH-6, and commit**

```bash
git add sources/devops/db sources/microservices/web-construct/lib/rbac sources/microservices/web-construct/lib/schema-contract.integration.test.ts docs/reviews/2026-07-31-architect-reviewer.md
git commit -m "fix(rbac): enforce last administrator atomically"
```

---

### Task 6: Make registration and invitation delivery recoverable

**Files:**

- Create: `sources/devops/db/migrations/0004_invitation_lifecycle.sql`
- Modify: `sources/microservices/web-construct/lib/db/schema.ts`
- Create: `sources/microservices/web-construct/lib/auth-invitations.ts`
- Create: `sources/microservices/web-construct/lib/auth-invitations.integration.test.ts`
- Modify: `sources/microservices/web-construct/app/api/auth/register/route.ts`
- Modify: `sources/microservices/web-construct/app/api/admin/send-invite/route.ts`
- Modify: `sources/microservices/web-construct/app/api/auth/set-password/route.ts`
- Modify: `sources/microservices/web-construct/lib/auth-security.integration.test.ts`
- Modify: `docs/reviews/2026-07-31-architect-reviewer.md`

**Interfaces:**

- Produces `prepareInvitation(email: string, requestedBy?: string): Promise<PreparedInvitation | null>`.
- Produces `recordInvitationDelivery(tokenId: string, result: { ok: true } | { ok: false; code: string }): Promise<void>`.
- `PreparedInvitation` contains `{ tokenId, rawToken, userId, email, expiresAt }`; raw tokens never enter logs.

- [ ] **Step 1: Write failing invitation-state integration tests**

Prove user+token rollback together, repeated registration of a passwordless account yields a retry, failed delivery preserves an older delivered token, successful delivery supersedes older unused invite tokens, password-bearing duplicates remain a uniform no-op, and consumed/superseded tokens cannot set a password.

- [ ] **Step 2: Run and observe RED**

Expected: missing delivery columns/service and duplicate passwordless registration still exits early.

- [ ] **Step 3: Add invitation lifecycle columns and constraints**

Add `purpose`, `delivery_status`, `delivery_attempted_at`, `delivered_at`, `delivery_error_code`, and `superseded_at` to `password_set_tokens`, with bounded CHECK constraints. Backfill existing rows to purpose `reset` and delivery state `sent` so valid historical reset links remain compatible.

- [ ] **Step 4: Implement the transaction-safe service**

`prepareInvitation` inserts-or-selects the normalized credentials user and invitation token in one transaction. It returns null for accounts with a password. `recordInvitationDelivery(ok)` marks the new token sent and supersedes only older unused invitation tokens in one transaction; failure records a bounded code and leaves prior tokens unchanged.

- [ ] **Step 5: Rewire public and admin routes**

Registration keeps its uniform response and rate limit. The admin route replaces stale `session.user.isAdmin` trust with `requireAdmin()` and uses the same service. Both call `sendEmail` between preparation and delivery recording.

- [ ] **Step 6: Harden token consumption**

`consume_password_set_token` rejects `superseded_at is not null` and invite tokens not successfully delivered. It retains the current row lock, atomic password update, and sibling invalidation.

- [ ] **Step 7: Run focused tests**

Run the invitation integration tests, auth-security integration tests, route tests, and rate-limit tests.

- [ ] **Step 8: Regenerate schema, complete ARCH-MED-2, and commit**

```bash
git add sources/devops/db sources/microservices/web-construct/lib sources/microservices/web-construct/app/api docs/reviews/2026-07-31-architect-reviewer.md
git commit -m "fix(auth): make invitation delivery recoverable"
```

---

### Task 7: Make `app_language` authoritative for navigation content

**Files:**

- Create: `sources/microservices/web-construct/lib/rbac/navigation-locales.ts`
- Create: `sources/microservices/web-construct/lib/rbac/navigation-locales.test.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/types.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/sidebar-adapter.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/nav-tree-builder.ts`
- Modify: `sources/microservices/web-construct/lib/rbac/navigation-service.ts`
- Modify: `sources/microservices/web-construct/app/(protected)/layout.tsx`
- Modify: create/edit functionality pages under `(protected)/(admin)/functionalities/`
- Modify: `sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/functionalities/TranslationsAccordion.tsx`
- Modify: relevant sidebar, navigation-tree, and functionality component tests
- Modify: `docs/reviews/2026-07-31-architect-reviewer.md`

**Interfaces:**

- Produces `NavigationLocale = { code: string; label: string; isDefault: boolean; isActive: boolean }`.
- Produces `toNavigationLocales(LanguageDto[]): NavigationLocale[]` and `navigationFallbackChain(activeCode, defaultCode): string[]`.

- [ ] **Step 1: Write failing pure and component tests**

Assert lowercase BCP-47 codes normalize to uppercase JSON/tag keys, configured languages preserve inactive content, the configured default replaces hardcoded Italian/English assumptions, a newly added language renders in the accordion, and missing active content follows active → configured default → `EN` → row name.

- [ ] **Step 2: Run and observe RED**

Expected: `SUPPORTED_LOCALES` fixes the editor to nine values and fallback accepts only its union.

- [ ] **Step 3: Implement dynamic locale helpers**

Normalize and deduplicate database rows. Keep `DEFAULT_LOCALE = 'EN'` only as the final legacy fallback; replace the closed `Locale` union with normalized string keys.

- [ ] **Step 4: Pass locale descriptors from Server Components**

The protected layout loads active/default language information and passes both active and fallback codes to menu mapping. Functionality create/edit pages call `listLanguages()` and pass all configured language descriptors to `FunctionalityForm`.

- [ ] **Step 5: Remove hardcoded Italian primary-field behavior**

`FunctionalityForm` reads and validates the configured default language key rather than `IT`, and passes `locales` to `TranslationsAccordion`. Existing Italian seed behavior remains unchanged because Italian is currently the configured default.

- [ ] **Step 6: Run focused tests and build**

Run navigation locale, sidebar adapter, nav tree, functionality form/accordion tests, then the production build.

- [ ] **Step 7: Complete ARCH-MED-6 and commit**

```bash
git add sources/microservices/web-construct docs/reviews/2026-07-31-architect-reviewer.md
git commit -m "feat(i18n): unify navigation language catalog"
```

---

### Task 8: Add the reusable production deployment baseline

**Files:**

- Create: `sources/microservices/web-construct/lib/health.ts`
- Create: `sources/microservices/web-construct/lib/health.test.ts`
- Create: `sources/microservices/web-construct/app/api/health/live/route.ts`
- Create: `sources/microservices/web-construct/app/api/health/ready/route.ts`
- Create: route tests beside the health routes
- Modify: `sources/microservices/web-construct/lib/i18n/user-language-actions.ts`
- Create/modify: cookie-security unit test
- Create: `sources/devops/k8s/base/*`
- Create: `sources/devops/k8s/overlays/dev/*`
- Create: `sources/devops/k8s/overlays/production-example/*`
- Modify: `sources/devops/k8s/dev/apply.sh` or replace it with the dev-overlay apply entrypoint
- Create: `sources/devops/k8s/validate.sh`
- Create: `docs/runbooks/production-deployment.md`
- Modify: `.github/workflows/quality.yml`
- Modify: `README.md`
- Modify: `docs/reviews/2026-07-31-architect-reviewer.md`

**Interfaces:**

- Produces `checkDatabaseReadiness(database, timeoutMs): Promise<boolean>`.
- Produces `shouldUseSecureCookies(externalUrl: string | undefined, nodeEnv: string | undefined): boolean`.
- Produces Kustomize overlays renderable with `kubectl kustomize`.

- [ ] **Step 1: Write failing health and cookie-policy tests**

Liveness returns 200 without touching the database. Readiness returns 200 after `select 1`, returns 503 on query error/timeout, and never exposes error details. Cookie security is true for HTTPS, false for HTTP, and fails safe for missing production URL.

- [ ] **Step 2: Run and observe RED**

Expected: health routes/helpers are missing and cookie security depends only on `NODE_ENV`.

- [ ] **Step 3: Implement health and cookie behavior**

Use a bounded `Promise.race` around `db.execute(sql\`select 1\`)`. Return JSON `{ status: 'ok' }` or `{ status: 'unavailable' }`; log the internal readiness error server-side.

- [ ] **Step 4: Build the Kustomize base**

Base resources include Deployment, Service, ConfigMap, and egress NetworkPolicy. Probes target `/api/health/live` and `/api/health/ready`. Pod/container security settings are non-root, RuntimeDefault, no privilege escalation, dropped capabilities, and read-only root filesystem with explicit writable `emptyDir` mounts for `/tmp` and the Next.js image/cache path.

- [ ] **Step 5: Add overlays**

Dev keeps one replica, HTTP `construct.local`, local image, and current developer ergonomics. `production-example` uses at least two replicas, rolling update, PDB, TLS ingress, HTTPS `AUTH_URL`, immutable placeholder image digest/tag, limited runtime database secret reference, and no migration URL in the web pod.

- [ ] **Step 6: Write manifest validation before accepting the manifests**

`validate.sh` renders both overlays and asserts required probe paths, security fields, production replicas/PDB/TLS, immutable-image placeholder, and absence of `MIGRATION_DATABASE_URL` from the runtime deployment. Add `azure/setup-kubectl` with an exact version in CI, then run the validator.

- [ ] **Step 7: Write the operations runbook**

Use unchecked action checkboxes and cover image publication, database backup, role provisioning, migration job, preflight, rollout, health verification, rollback, restore decision, secret rotation, log routing, and derived-application placeholders.

- [ ] **Step 8: Run focused tests and manifest checks**

```bash
npm test -- lib/health.test.ts
bash sources/devops/k8s/validate.sh
bash -n sources/devops/k8s/overlays/dev/apply.sh
```

- [ ] **Step 9: Complete ARCH-MED-4 and commit**

```bash
git add sources/microservices/web-construct sources/devops/k8s docs/runbooks README.md .github/workflows/quality.yml docs/reviews/2026-07-31-architect-reviewer.md
git commit -m "feat(deploy): add production-ready Kubernetes baseline"
```

---

### Task 9: Correct audit semantics and finish migration recovery documentation

**Files:**

- Modify: `sources/microservices/web-construct/lib/i18n/audit.ts`
- Modify: `docs/superpowers/specs/2026-07-28-i18n-system-design.md`
- Modify: `README.md`
- Create: `docs/runbooks/legacy-rbac-recovery.md`
- Modify: `docs/reviews/2026-07-31-architect-reviewer.md`

**Interfaces:**

- Preserves: existing `auditI18n(event, details)` call signature and structured fields.
- Produces: explicit best-effort diagnostic-log contract and executable recovery queries.

- [ ] **Step 1: Write a documentation contract check**

Add a small Node test or repository check that rejects the phrases `durable audit trail` and `append-only audit` when describing `auditI18n`, and asserts the runbooks name the required backup/restore and log-retention responsibilities.

- [ ] **Step 2: Run and observe RED**

Expected: the current implementation comment calls the events an audit trail and no recovery runbook exists.

- [ ] **Step 3: Correct the diagnostic contract**

Keep the stable structured event marker but describe it as best-effort diagnostics. Document stdout routing, redaction, retention ownership, and the absence of completeness/compliance guarantees.

- [ ] **Step 4: Add the legacy RBAC recovery runbook**

Include exact preflight counts, `pg_dump` backup command shape, restore-from-backup/authoritative-source insert into `user_role`, administrator-count verification, and stop/rollback criteria. Never include real connection strings or credentials.

- [ ] **Step 5: Verify and close ARCH-CRIT-2, ARCH-MED-1, and ARCH-MED-5**

Run migration tests/schema check plus the documentation contract. Mark each finding `- [✅]` with distinct evidence.

- [ ] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/lib/i18n/audit.ts docs README.md
git commit -m "docs: define audit and migration recovery contracts"
```

---

### Task 10: Full verification and review closure

**Files:**

- Modify: `docs/reviews/2026-07-31-architect-reviewer.md`
- Modify: `docs/superpowers/specs/2026-08-02-architecture-review-remediation-design.md`
- Modify: this plan as tasks complete

**Interfaces:**

- Consumes: all preceding task outputs.
- Produces: a review with 17 verified `- [✅]` findings and an honest limitations section.

- [ ] **Step 1: Run all static/unit gates freshly**

```bash
cd sources/microservices/web-construct
npm run test:migrations
npm run schema:check
npm test
npm run lint -- --max-warnings=0
npm run build
npm audit --omit=dev --audit-level=low
cd ../../..
git diff --check
```

- [ ] **Step 2: Run disposable-database integration gates**

```bash
node sources/devops/db/db.mjs test-apply
cd sources/microservices/web-construct
npm run test:integration
```

Run only with the required disposable variables. Verify migrations twice, privilege boundaries, concurrency, invitations, navigation, auth, schema contract, and query plans.

- [ ] **Step 3: Validate deployment artifacts**

```bash
bash sources/devops/k8s/validate.sh
bash -n sources/devops/k8s/overlays/dev/apply.sh
```

- [ ] **Step 4: Audit every review checkbox against evidence**

For each of the 17 findings, point to a focused test, command, source invariant, or explicit accepted contract. Leave any item unchecked if its required external verification was unavailable.

- [ ] **Step 5: Update design and plan checkboxes**

Mark only completed requirements `- [✅]`; keep limitations and environment-dependent checks visible.

- [ ] **Step 6: Request code review**

Invoke `superpowers:requesting-code-review`, inspect the complete diff including the preceding dirty review work, and resolve actionable regressions through fresh red-green cycles.

- [ ] **Step 7: Re-run the full affected gate after review fixes**

Do not reuse pre-review output. Record final test counts, build result, audit result, migration count, rendered overlays, and any skipped external checks.

- [ ] **Step 8: Commit final ledgers**

```bash
git add docs/reviews/2026-07-31-architect-reviewer.md docs/superpowers/specs/2026-08-02-architecture-review-remediation-design.md docs/superpowers/plans/2026-08-02-architecture-review-remediation.md
git commit -m "docs: complete architecture remediation ledger"
```

## Plan self-review

- [✅] ID=PLAN-CHECK-1, Title=Spec coverage, Requirement=Every design requirement and all 17 architecture findings map to at least one task above.
- [✅] ID=PLAN-CHECK-2, Title=Placeholder scan, Requirement=The plan contains no placeholder or deferred implementation language and every interface is defined.
- [✅] ID=PLAN-CHECK-3, Title=Type consistency, Requirement=Migration commands, environment names, SQL function names, invitation types, locale types, and health interfaces match across tasks.
- [✅] ID=PLAN-CHECK-4, Title=Dirty worktree safety, Requirement=Every commit stages explicit paths and preserves prior user/reviewer changes.
