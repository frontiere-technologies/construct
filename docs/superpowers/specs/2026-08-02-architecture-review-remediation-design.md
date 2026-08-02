# Architecture Review Remediation Design

## Findings and recommendations summary

This remediation closes the findings in `docs/reviews/2026-07-31-architect-reviewer.md` against the repository's current state without repeating the fixes already made for the code and UI/UX reviews. Construct remains a production-ready, extensible application foundation: authentication, RBAC, database-driven navigation, i18n, and deployment primitives are production-grade, while applications derived from it supply their own domain pages, backend services, privileges, capacity targets, domains, and environment-specific infrastructure values.

The browser never connects to Supabase or PostgreSQL directly. Next.js is the application trust boundary and uses a least-privilege PostgreSQL runtime identity. Database migrations use a separate administrative identity. Versioned migrations, server-side admin read guards, atomic administrator invariants, recoverable invitations, a shared language catalog, production deployment examples, and measured indexes complete the remaining architecture work.

## Scope and accepted constraints

- [ ] ID=DESIGN-1, Title=Server-only data access, Requirement=Browser code communicates only with Next.js; no Supabase Data API or direct database access is supported.
- [ ] ID=DESIGN-2, Title=Production-ready foundation, Requirement=The shared application skeleton is production-ready while derived applications provide domain-specific services, pages, privileges, capacity targets, and environment values.
- [ ] ID=DESIGN-3, Title=Preserve current behavior, Requirement=Existing public URLs, Auth.js providers, RBAC semantics, navigation data, translations, and prior code/UI review fixes remain compatible.
- [ ] ID=DESIGN-4, Title=Evidence-based closure, Requirement=Each architecture-review checkbox is completed only after its current implementation or remediation has been verified.
- [ ] ID=DESIGN-5, Title=Disposable database only, Requirement=Database-mutating verification runs only with `TEST_DATABASE_URL`, `TEST_DATABASE_DISPOSABLE=1`, and a target distinct from `DATABASE_URL`.

## Current finding disposition

The following findings are already substantially covered by the uncommitted code-review remediation and need verification plus review-ledger updates, not parallel implementations:

- [ ] ID=EXISTING-1, Finding=ARCH-CRIT-1, Verification=Inactive credentials and OIDC sign-ins are rejected and active sessions refresh account status on every request.
- [ ] ID=EXISTING-2, Finding=ARCH-HIGH-1, Verification=JWT/session role claims refresh from PostgreSQL and privileged actions independently call `requireAdmin()`.
- [ ] ID=EXISTING-3, Finding=ARCH-HIGH-4, Verification=Password-token claiming and password mutation are atomic and concurrent claims have an integration test.
- [ ] ID=EXISTING-4, Finding=ARCH-HIGH-5, Verification=Navigation writes use transactions and a transaction-scoped advisory lock with rollback tests.
- [ ] ID=EXISTING-5, Finding=ARCH-HIGH-7, Verification=Embedded preflight resolves every address, rejects non-public ranges, pins the validated address, rejects redirects, and is covered by the egress policy.
- [ ] ID=EXISTING-6, Finding=ARCH-MED-3, Verification=All public credential and recovery entry points use shared per-IP and per-account database-backed rate limits.
- [ ] ID=EXISTING-7, Finding=ARCH-LOW-1, Verification=README architecture, setup, authentication, RBAC, testing, and deployment guidance describe the current system.

ARCH-CRIT-2 is partially covered: the corrected schema now backfills and verifies legacy administrators before dropping `users.role`. The migration-history, repair, backup, and rollback requirements remain in this remediation.

## 1. Database trust boundary

### Runtime and migration identities

- [ ] ID=DB-1, Title=Runtime group role, Requirement=Create a `construct_runtime` NOLOGIN group role without ownership, DDL, role-management, superuser, replication, or `BYPASSRLS` privileges.
- [ ] ID=DB-2, Title=Runtime login provisioning, Requirement=Provide an explicit provisioning command that creates or updates a named LOGIN role from operator-supplied credentials and grants only membership in `construct_runtime`.
- [ ] ID=DB-3, Title=Separated URLs, Requirement=The application uses `DATABASE_URL` for the limited runtime login; migration tooling requires `MIGRATION_DATABASE_URL` for schema and role administration.
- [ ] ID=DB-4, Title=Deterministic grants, Requirement=Grant `construct_runtime` only the table DML, sequence usage, view selection, and function execution required by current application queries.
- [ ] ID=DB-5, Title=Closed Data API, Requirement=Explicitly revoke Construct tables, views, sequences, and application functions from `PUBLIC`, `anon`, and `authenticated`; future migration-owned objects receive matching default privileges.
- [ ] ID=DB-6, Title=Invoker views and functions, Requirement=`role_list_view` uses `security_invoker`; application functions use `security invoker`, a fixed empty `search_path`, explicit qualification, and no default PUBLIC execution.

RLS stays enabled as defense in depth. Construct does not introduce per-user RLS policies because PostgreSQL sees a server runtime identity rather than an end-user identity. Auth.js, server-side guards, and domain services remain responsible for end-user authorization.

## 2. Versioned schema evolution

### Sources of truth

- [ ] ID=MIG-1, Title=Ordered migrations, Requirement=Add immutable, ordered SQL files under `sources/devops/db/migrations/` as the authoritative DDL and seed history.
- [ ] ID=MIG-2, Title=Generated snapshot, Requirement=Keep `sources/devops/db/schema.sql` as a generated concatenated snapshot for fresh-install inspection and reject manual drift in CI.
- [ ] ID=MIG-3, Title=Migration history, Requirement=`db.mjs apply` records migration name, checksum, start/completion state, and applied timestamp in a dedicated history table.
- [ ] ID=MIG-4, Title=Transactional application, Requirement=Apply each migration in its own transaction and stop on the first failure without recording it as completed.
- [ ] ID=MIG-5, Title=Checksum protection, Requirement=Refuse to continue when the checksum of an already completed migration differs from its recorded checksum.
- [ ] ID=MIG-6, Title=Drizzle drift gate, Requirement=Add a repository check that compares the SQL catalog expected by migrations with `lib/db/schema.ts` for application-visible tables, columns, indexes, and views.

The existing idempotent schema becomes the initial baseline migration. Existing deployments may safely execute it once under the new runner; new changes are appended as later migrations. This avoids guessing whether an untracked deployment exactly matches an historical commit while preventing future history rewrites.

### Legacy RBAC recovery

- [ ] ID=MIG-7, Title=Safe role upgrade, Requirement=Snapshot legacy administrator assignments, backfill `user_role`, verify migrated counts, and only then drop `users.role` in one transaction.
- [ ] ID=MIG-8, Title=Repair runbook, Requirement=Document backup, preflight count, restore-from-backup/authoritative-source query, post-migration verification, and rollback conditions for deployments that previously lost legacy role data.

## 3. Authorization boundaries and concurrency

### Admin reads

- [ ] ID=AUTHZ-1, Title=Shared admin route group, Requirement=Move all current administrative pages into one URL-transparent App Router route group with a Server Component layout that calls `requireAdmin()` before rendering children.
- [ ] ID=AUTHZ-2, Title=Defense in depth, Requirement=Keep proxy admission as an early redirect and keep write-side `requireAdmin()` checks; neither layer replaces the other.

The route group includes Users, Functionalities and creation, Roles & Permissions and detail, Theme, Languages, and Translations. Moving folders inside a parenthesized route group does not change their URLs.

### Last active administrator

- [ ] ID=AUTHZ-3, Title=Atomic role mutation, Requirement=Replace a user's roles through a database function that acquires the shared administrator-invariant lock, validates the resulting active-administrator count, and mutates roles atomically.
- [ ] ID=AUTHZ-4, Title=Atomic status mutation, Requirement=Change account status through a database function that acquires the same lock, validates the resulting active-administrator count, and updates status atomically.
- [ ] ID=AUTHZ-5, Title=Concurrency tests, Requirement=Use two database connections to prove concurrent demotion/deactivation cannot leave zero active administrators.

Application guard helpers remain for validation messages, but the database function is authoritative. Both mutation functions use the same transaction-scoped advisory-lock key so different mutation types cannot race each other.

## 4. Recoverable registration and invitations

- [ ] ID=INVITE-1, Title=Atomic creation, Requirement=Create a new credentials user and its invitation token in one database transaction.
- [ ] ID=INVITE-2, Title=Retryable passwordless account, Requirement=A registration request for an existing credentials account without a password creates a new invitation attempt instead of returning without recovery.
- [ ] ID=INVITE-3, Title=Delivery state, Requirement=Record invitation purpose, delivery state, attempt timestamps, successful delivery timestamp, and a bounded non-sensitive failure classification.
- [ ] ID=INVITE-4, Title=Safe supersession, Requirement=Only after successful delivery mark older unused invitation tokens for the same user as superseded; a failed delivery does not invalidate a previously delivered usable token.
- [ ] ID=INVITE-5, Title=Uniform response and limits, Requirement=Preserve the non-enumerating public response and existing per-IP/per-account throttling for new and retry requests.

Email remains synchronous in the base template, avoiding a mandatory queue worker. The persisted state makes failures observable and retryable through registration or the existing administrative invitation flow. Applications needing guaranteed asynchronous delivery may replace the sender with an outbox worker without changing the token lifecycle.

## 5. One language catalog

- [ ] ID=LANG-1, Title=Dynamic navigation locales, Requirement=Use configured `app_language` rows to drive navigation name, description, and tag authoring instead of the fixed `SUPPORTED_LOCALES` array.
- [ ] ID=LANG-2, Title=Compatible storage, Requirement=Keep existing `navigation_item.item_translation` JSON and `navigation_item_tag` rows; dynamic uppercase language codes remain valid keys.
- [ ] ID=LANG-3, Title=Fallback, Requirement=When navigation content is missing in the active UI language, use the configured default language and finally the existing English/default-name fallback.
- [ ] ID=LANG-4, Title=No content loss, Requirement=Inactive configured languages remain editable or preserved so deactivation never deletes authored navigation content.

## 6. Audit semantics

- [ ] ID=AUDIT-1, Title=Diagnostic contract, Requirement=Describe i18n Pino events as best-effort structured mutation diagnostics rather than a durable audit trail.
- [ ] ID=AUDIT-2, Title=Operational routing, Requirement=Document that production operators must route stdout logs to their chosen durable log platform when retention is required.
- [ ] ID=AUDIT-3, Title=No false compliance claim, Requirement=Do not claim append-only, guaranteed-delivery, regulatory, or complete audit semantics without a future shared audit subsystem.

A durable application audit subsystem is intentionally not introduced for i18n alone. Derived applications can add one shared mechanism for their own regulatory and retention requirements.

## 7. Query indexes and scaling boundary

- [ ] ID=PERF-1, Title=Reverse role lookup, Requirement=Add `user_role(id_role, user_id)` in SQL and Drizzle for role-to-user filtering and active-administrator checks.
- [ ] ID=PERF-2, Title=Navigation siblings, Requirement=Add `navigation_item(id_item_parent, order_position)` in SQL and Drizzle for sibling enumeration and ordered tree reads.
- [ ] ID=PERF-3, Title=Plan verification, Requirement=Run `ANALYZE` and `EXPLAIN` against representative disposable-database rows and record whether PostgreSQL selects the indexes; do not claim a performance gain from tiny-table plans that rationally choose sequential scans.

The current full navigation read remains appropriate for a configurable application menu. A separate cache is introduced only after measurement shows request cost above an application-defined threshold.

## 8. Production deployment baseline

- [ ] ID=OPS-1, Title=Kustomize layout, Requirement=Provide a reusable base plus `dev` and `production-example` overlays without treating the example's domain, registry, replicas, or resource sizes as universal production values.
- [ ] ID=OPS-2, Title=Immutable rollout, Requirement=The production example requires an immutable image tag or digest and uses a rolling-update strategy.
- [ ] ID=OPS-3, Title=Health endpoints, Requirement=Add distinct liveness and readiness endpoints; liveness checks the process and readiness performs a bounded database query.
- [ ] ID=OPS-4, Title=Pod hardening, Requirement=Run non-root, disallow privilege escalation, drop Linux capabilities, apply seccomp RuntimeDefault, and use a read-only root filesystem where the Next.js runtime permits it.
- [ ] ID=OPS-5, Title=Availability example, Requirement=Use at least two replicas and a PodDisruptionBudget in `production-example`, explicitly leaving capacity tuning to the derived application.
- [ ] ID=OPS-6, Title=TLS and cookies, Requirement=The production example terminates TLS and uses a matching HTTPS `AUTH_URL`; the HTTP dev overlay derives cookie security from the configured external scheme rather than `NODE_ENV` alone.
- [ ] ID=OPS-7, Title=Secret separation, Requirement=Runtime pods receive only the limited `DATABASE_URL`; migration credentials are supplied only to the migration job/operator workflow.
- [ ] ID=OPS-8, Title=Operations runbook, Requirement=Document build/push, database backup, migration, preflight, deploy, post-deploy checks, rollback, restore decision points, and credential rotation.

## Error handling

- Migration checksum mismatch, missing administrative migration credentials, or unsafe runtime-role configuration fails closed with a precise operator error.
- Admin mutation functions return stable conflict results for the last-active-administrator invariant; unexpected database failures remain server errors and do not leak SQL details to clients.
- Registration continues returning a uniform public response. Delivery failures are logged with a user ID and bounded classification, never a raw token, password, email address, or provider response body.
- Readiness uses a short timeout and returns unavailable when PostgreSQL cannot be reached; liveness does not depend on PostgreSQL and therefore does not cause restart loops during a database outage.
- Missing navigation translations degrade through the defined fallback chain and never block rendering.

## Testing and verification

- [ ] ID=TEST-1, Title=Test-first behavior changes, Requirement=Every application behavior change starts with a failing Vitest or disposable-database integration test and follows red-green-refactor.
- [ ] ID=TEST-2, Title=Database integration, Requirement=Cover migration ordering/checksums, grants, view/function access, legacy RBAC backfill, concurrent last-admin mutations, invitation retry/supersession, and index definitions.
- [ ] ID=TEST-3, Title=Route protection, Requirement=Verify every administrative route is under the guarded layout and that non-admin rendering is rejected independently of proxy matching.
- [ ] ID=TEST-4, Title=Locale behavior, Requirement=Verify a newly configured language appears in navigation authoring without a code change and falls back correctly when content is absent.
- [ ] ID=TEST-5, Title=Deployment validation, Requirement=Build every Kustomize overlay and statically assert probes, security context, replicas, PDB, TLS, immutable image configuration, and secret separation.
- [ ] ID=TEST-6, Title=Full quality gate, Requirement=Run unit tests, eligible disposable-database integration tests, ESLint with zero warnings, production build, production dependency audit, migration/schema drift checks, manifest checks, and `git diff --check`.

Database or Kubernetes checks that require unavailable external state must be reported explicitly as not executed. They cannot be presented as passing based solely on static inspection.

## Architecture-review closure mapping

| Finding | Design coverage |
|---|---|
| ARCH-CRIT-1 | EXISTING-1, EXISTING-2 |
| ARCH-CRIT-2 | MIG-1–MIG-8 |
| ARCH-HIGH-1 | EXISTING-2 |
| ARCH-HIGH-2 | DB-1–DB-6 |
| ARCH-HIGH-3 | AUTHZ-1–AUTHZ-2 |
| ARCH-HIGH-4 | EXISTING-3 |
| ARCH-HIGH-5 | EXISTING-4 |
| ARCH-HIGH-6 | AUTHZ-3–AUTHZ-5 |
| ARCH-HIGH-7 | EXISTING-5 |
| ARCH-MED-1 | MIG-1–MIG-6 |
| ARCH-MED-2 | INVITE-1–INVITE-5 |
| ARCH-MED-3 | EXISTING-6 |
| ARCH-MED-4 | OPS-1–OPS-8 |
| ARCH-MED-5 | AUDIT-1–AUDIT-3 |
| ARCH-MED-6 | LANG-1–LANG-4 |
| ARCH-LOW-1 | EXISTING-7 |
| ARCH-LOW-2 | PERF-1–PERF-3 |

## Non-goals

- Direct browser access through Supabase Data API.
- Per-user PostgreSQL sessions or Supabase Auth migration.
- A durable regulatory audit subsystem limited to i18n.
- A mandatory asynchronous email worker.
- Universal production SLOs, replica counts, resource sizes, domains, registries, or cloud-provider integrations for every derived application.
- Caching the complete navigation tree before measurements justify it.
