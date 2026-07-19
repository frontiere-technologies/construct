# Supabase SDK → Drizzle ORM Migration — Design Spec

**Date:** 2026-07-18
**Branch:** `feature/fixes`
**Target:** `sources/microservices/web-construct/`
**Source requirement:** conversational request — replace `@supabase/supabase-js` with Drizzle ORM as the Postgres client, without changing where the database lives.

---

## Summary

The app currently talks to its Postgres database (hosted on Supabase cloud) exclusively through `@supabase/supabase-js`, a PostgREST-based REST client (`lib/supabase-server.ts` → `createAdminClient()`, service-role key, bypasses RLS). This spec replaces that client with **Drizzle ORM** over the `postgres.js` driver, connecting directly to the Postgres protocol on the same Supabase cloud project via the Supavisor connection pooler. The database itself does not move, does not change environment, and its schema-management process (`sources/devops/db/schema.sql`, applied via `supabase db push` / `psql`) is unchanged.

### Key decisions (confirmed with user)

- [x] DEC-1 — **Full scope**: migrate every call site using `@supabase/supabase-js` (see file list in §4), not a subset.
- [x] DEC-2 — **Connection**: Supavisor pooler, transaction mode, port `6543` — not a direct `5432` connection — since the app runs as long-running Node pods on Kubernetes that can scale horizontally, and direct-connection slots on Supabase are limited.
- [x] DEC-3 — **RPC functions** (`replace_user_roles`, `apply_role_permission_deltas`, `replace_item_tags`) stay as Postgres functions in `schema.sql`, invoked via `db.execute(sql\`select ...\`)`. They are not reimplemented as Drizzle `db.transaction()` blocks.
- [x] DEC-4 — **Schema source of truth**: `schema.sql` remains authoritative for DDL, seeds, and migrations, applied exactly as today. A hand-maintained `lib/db/schema.ts` (bootstrapped once via `drizzle-kit introspect`) exists purely for type-safe querying — `drizzle-kit` is not adopted as a migration engine.
- [x] DEC-5 — **No database change**: same Supabase cloud project/environment used today for local dev and E2E. Only the client library in the app changes.
- [x] DEC-6 — **Env vars**: `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are replaced by a single `DATABASE_URL` (pooler connection string) in `.env.template`, `sources/devops/k8s/*/secret.env.example`, and the corresponding K8s ConfigMap/Secret manifests.
- [x] DEC-7 — **Sequencing**: single branch, migrated module-by-module in increasing order of risk (§4), verified incrementally. `@supabase/supabase-js` is removed from `package.json` only after the last module is migrated.

---

## 1. Dependencies & connection setup

**New dependencies**
- `drizzle-orm` + `postgres` (the `postgres.js` driver — Drizzle's recommended driver, compatible with Supavisor).
- `drizzle-kit` (devDependency) — used once for `introspect`/`pull` to bootstrap `lib/db/schema.ts`, and again by hand whenever `schema.sql` changes. Not used at runtime, not used for migrations.
- `@supabase/supabase-js` removed at the end of the migration (DEC-7).

**`lib/db.ts`** (replaces `lib/supabase-server.ts`)
- Instantiates, once at module load, `postgres(process.env.DATABASE_URL, { prepare: false })` wrapped as `drizzle(client, { schema })`.
- `prepare: false` is **required**: Supavisor transaction-mode pooling does not support prepared statements across the pooled connection; omitting this causes intermittent, hard-to-diagnose query failures.
- Since the app is a long-running Node process per pod (not serverless/edge), this client is a **module-level singleton**, created once and reused for the pod's lifetime — not re-created per request, unlike the previous cheap per-call `createAdminClient()`.

**`lib/db/schema.ts`**
- Hand-written Drizzle `pgTable` definitions for all 14 tables in `schema.sql` (`users`, `password_set_tokens`, `allowed_domains`, `role_type`, `navigation_item_type`, `functionality_type`, `user_status`, `role`, `role_history`, `user_role`, `navigation_item`, `navigation_item_tag`, `role_item`, `user_info`), bootstrapped via `drizzle-kit introspect` and refined by hand for naming/TS types.
- `role_list_view` is modeled as a Drizzle `pgView` (read-only) rather than raw SQL, since `roles-service.ts` applies the same dynamic filter/sort/paginate pattern to it as to real tables (see §2).

**Env vars**
- `DATABASE_URL` (format `postgresql://<user>:<password>@<pooler-host>:6543/postgres`) replaces `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env.template`, `sources/devops/k8s/*/secret.env.example`, and K8s manifests.

## 2. Query pattern translation

Four recurring patterns identified across `navigation-service.ts`, `roles-service.ts`, `users-service.ts`, `roles-actions.ts`:

1. **Dynamic filters** (`applyFilters`, `applyUserFilters`) — today these mutate a chained PostgREST query builder (`.ilike/.eq/.gte/.lte/.in/.or`). They're rewritten to build an **array of Drizzle conditions** (`eq`, `ilike`, `gte`, `lte`, `inArray`, `or` from `drizzle-orm`) combined with `and(...conditions)` and passed to a single `.where(...)`. Public function signatures (query object in, conditions applied) stay the same so callers don't change.
2. **Paginated count** (`{ count: 'exact' }` + `.range()`) — PostgREST returns data + total count in one call; Drizzle has no equivalent. `listUsers`/`listRoles` become **two parallel queries** (`Promise.all`): one with `.limit(size).offset(from)`, one with `count(*)` — the same shape `countUsers`/`countRoles` already use standalone today.
3. **`role_list_view`** — modeled as a Drizzle `pgView` (§1), queried with the same typed builder as real tables, avoiding raw SQL string handling for dynamic filter/sort/paginate logic.
4. **RPC calls** — `supabase.rpc('replace_user_roles', {...})` becomes `db.execute(sql\`select public.replace_user_roles(${userId}, ${sql.array(roleIds, 'bigint')})\`)`, parameterized via Drizzle's `sql` tag (never string concatenation).
5. **Embedded resource selects** — PostgREST's implicit-join syntax (e.g. `roles-actions.ts`'s `role_type:role_type(description)`) becomes an explicit `.leftJoin(roleType, eq(role.idRoleType, roleType.idRoleType))` or a Drizzle relational query.

## 3. Error handling

- **No `{data, error}` tuple** — postgres.js throws (`PostgresError`) on any query failure instead of returning an error object. Every existing `if (error) throw new Error('Failed to X: ' + error.message)` becomes `try { ... } catch (err) { throw new Error('Failed to X: ' + (err instanceof Error ? err.message : String(err))) }` around the Drizzle call — same message contract, different trigger.
- **No `.single()`** — where PostgREST's `.single()` today turns "zero rows" into an error automatically (e.g. `getRoleType`'s `"Role not found"`), Drizzle's `.limit(1)` just returns an empty array. Call sites relying on this must add an explicit `if (!row) throw new Error('...')` check.
- **Style** — try/catch wrapping stays inline per call site, matching the existing repeated-`if (error) throw` style. No centralized error-wrapping helper is introduced; that would be a style change beyond this migration's scope.

## 4. Migration order & affected files

Single branch, modules migrated in this order (increasing risk), each followed by rewritten unit tests + relevant E2E run before moving to the next:

1. `lib/theme-actions.ts`
2. `lib/profile-actions.ts` + `app/(protected)/profile/page.tsx` (direct `createAdminClient()` read of the profile row — migrated alongside its action file)
3. RBAC services: `lib/rbac/navigation-service.ts`, `lib/rbac/functionalities-service.ts`, `lib/rbac/users-service.ts`, `lib/rbac/roles-service.ts`
4. RBAC actions: `lib/rbac/navigation-actions.ts`, `lib/rbac/users-actions.ts`, `lib/rbac/roles-actions.ts`, `lib/rbac/auth-roles.ts`
5. `lib/auth.ts` (most delicate — login/upsert-on-first-login logic)
6. API routes: `app/api/auth/register/route.ts`, `app/api/auth/forgot-password/route.ts`, `app/api/auth/set-password/route.ts`, `app/api/auth/change-password/route.ts`, `app/api/admin/send-invite/route.ts`, plus `app/set-password/page.tsx` (direct `createAdminClient()` token lookup — migrated alongside the set-password route)
7. `lib/supabase-server.ts` deleted, replaced by `lib/db.ts` (§1)

`@supabase/supabase-js` is removed from `package.json` only after step 7.

## 5. Testing

- **Unit tests**: rewritten module-by-module in the same order as §4. Tests that mock the PostgREST query chain (e.g. `users-service.test.ts`'s fake `.ilike/.or/.in/.gte` object) are rewritten to assert on the resulting Drizzle condition array instead of captured method calls — same coverage goal, adapted shape.
- **`lib/auth.ts` has no unit tests today** and none are added as part of this migration (out of scope) — its correctness after migration relies on the existing E2E suite (login redirect, OIDC flow, first-login upsert).
- **E2E**: after each module, run the relevant Playwright/pytest suite (`uv run pytest sources/tests/e2e/test_sidebar.py`, etc.) against the same Supabase cloud dev project used today. Before the final merge, full `uv run pytest` + `npm run build` + `npm run lint`.
- **Migration closure check**: `grep -r "@supabase/supabase-js"` over application code (excluding `node_modules`) must return nothing before the dependency is removed from `package.json`.

## 6. Out of scope

- Any change to `schema.sql`, the DB schema itself, or the Supabase cloud project/environment (DEC-5).
- Adopting `drizzle-kit` as a migration engine (DEC-4).
- Reimplementing the 3 Postgres RPC functions in TypeScript (DEC-3).
- New unit test coverage for `lib/auth.ts` beyond what E2E already exercises (§5).
- A centralized DB-error-wrapping helper (§3) — style stays consistent with existing inline pattern.
- Enabling/enforcing RLS at the database level — the app continues to connect with a role equivalent to today's service-role (bypasses RLS); authorization stays app-side (RBAC tables + middleware), unchanged by this migration.
