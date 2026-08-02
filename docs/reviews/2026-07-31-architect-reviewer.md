# Architecture Review — 2026-07-31

## Findings and recommendations summary

Construct is a coherent server-rendered modular monolith with clear UI, service, and database layers. The i18n cache/version design, parameterized Drizzle queries, transactional translation editor, write-side admin guards, database constraints, and broad unit-test suite are strong foundations. The branch is not yet safe to describe as production-ready, however: account deactivation is not enforced by authentication, the legacy RBAC migration destroys the role value before attempting its backfill, and authorization is carried as a long-lived JWT snapshot while the application connects to PostgreSQL with a role that bypasses RLS.

The recommended sequence is to repair identity and migration safety first, then close transaction and trust-boundary gaps, then harden deployment/operations and reduce schema/documentation drift. No scale target was supplied, so scalability findings below are tied only to concrete current query and deployment patterns rather than assumed traffic.

| Severity | Count |
|---|---:|
| Critical | 2 |
| High | 7 |
| Medium | 6 |
| Low | 2 |
| **Total** | **17** |

## Architecture map

```text
Browser
  -> Next.js Proxy/middleware
       -> Auth.js JWT session (userId, roleIds, isAdmin snapshot)
       -> protected Server Components / API routes / Server Actions
            -> domain services (rbac, i18n, profile, theme, mail)
                 -> singleton Drizzle/postgres.js pool (20 connections per pod)
                      -> Supavisor transaction pooler
                           -> Supabase PostgreSQL

i18n read path:
request -> language resolution -> process-local dictionary cache
        -> 15-second database version poll -> dictionary reload on version change
```

The critical trust boundary is therefore the Next.js process: database RLS is enabled but intentionally bypassed by the application's connection identity, while middleware and server code decide who may invoke privileged queries.

## Actionable findings

### Identity, authentication, and authorization

- [✅] ID=ARCH-CRIT-1, Severity=Critical, Complexity=Medium, Priority=P0, Title=Deactivated accounts remain fully usable, Fix description=Make `users.id_user_status` an enforced authentication and session invariant: reject inactive users in every credentials/OIDC login path, re-check status at protected and sensitive server boundaries, and define a session-revocation or bounded-expiry mechanism so deactivation terminates existing access.

Remediation verified 2026-08-02: credentials, test credentials, and existing OIDC identities reject non-active accounts; the JWT callback reloads current status and roles on every request; inactive sessions expose no user ID or authority; and `requireAdmin()` performs an independent live database lookup. Focused authentication/config/guard tests passed (11 tests across three files).

`setUserStatus()` persists `id_user_status` and a timestamp, but no authentication path consumes that status (`sources/microservices/web-construct/lib/rbac/users-actions.ts:70-83`). Credentials login selects only id/email/name/password hash and accepts a valid password regardless of status (`sources/microservices/web-construct/lib/auth.ts:84-108`). OIDC sign-in checks only the email domain (`sources/microservices/web-construct/lib/auth.ts:140-149`), and the JWT callback provisions/loads roles without checking status (`sources/microservices/web-construct/lib/auth.ts:151-187`). Consequently, “Deactivated” is currently an administrative display/filter value, not an access-control state; both existing sessions and fresh logins remain usable.

- [ ] ID=ARCH-CRIT-2, Severity=Critical, Complexity=Medium, Priority=P0, Title=Legacy RBAC migration drops administrator data before backfill, Fix description=Replace the in-place block with an ordered, versioned migration that snapshots legacy role assignments, backfills `user_role`, verifies administrator counts, and only then drops `users.role`; provide a repair query and backup/rollback procedure for environments where the current script has already run.

The authoritative schema drops `users.role` at `sources/devops/db/schema.sql:46-48`. Much later, it grants everyone only the Registered role and conditionally backfills legacy administrators only if the dropped column still exists (`sources/devops/db/schema.sql:324-348`). On an upgrade from the documented legacy model, the condition is necessarily false and administrator assignments are lost. This is a deployment/data-migration defect, not merely a stale comment.

- [✅] ID=ARCH-HIGH-1, Severity=High, Complexity=Medium, Priority=P0, Title=RBAC revocation is not reflected in active JWT sessions, Fix description=Introduce fresh authorization at sensitive boundaries—either a server-side session store/authorization version checked against the database or a short bounded JWT lifetime with forced invalidation—and derive `isAdmin` from current roles rather than trusting an indefinitely reused claim.

Remediation verified 2026-08-02: the JWT callback refreshes `roleIds`, `isAdmin`, and account status for existing tokens; the session derives authority only from those refreshed values; and privileged mutations use the database-backed `requireAdmin()` guard. Focused tests prove a stale administrator JWT is rejected after demotion or deactivation.

Role IDs and `isAdmin` are populated only when `account && user` is present during sign-in (`sources/microservices/web-construct/lib/auth.ts:151-187`). Later JWT callbacks return the existing claims without querying roles, while middleware and `requireAdmin()` trust those claims (`sources/microservices/web-construct/lib/auth.config.ts:30-34`, `sources/microservices/web-construct/lib/rbac/auth-guard.ts:3-7`). `updateUserRoles()` changes the database but does not invalidate the target's session (`sources/microservices/web-construct/lib/rbac/users-actions.ts:49-67`). A removed administrator therefore retains administrative capabilities until a new sign-in, and ordinary token rotation does not refresh roles in this callback.

- [ ] ID=ARCH-HIGH-2, Severity=High, Complexity=High, Priority=P1, Title=The application database identity bypasses the declared RLS boundary, Fix description=Create a dedicated least-privilege application role, grant only required table/function operations, explicitly revoke Data API access from `anon`/`authenticated` where unused, make exposed views `security_invoker` or inaccessible, and reserve owner/service credentials for migrations and tightly scoped operations.

The runtime opens a direct PostgreSQL connection from `DATABASE_URL` (`sources/microservices/web-construct/lib/db.ts:1-16`), and the template instructs users to connect as `postgres.<project>` (`sources/microservices/web-construct/.env.template:1-3`). The accepted Drizzle design explicitly states that this role is equivalent to the former service role and bypasses RLS (`docs/superpowers/specs/2026-07-18-drizzle-migration-design.md:82-89`). Meanwhile, the schema enables RLS on tables but defines no policies, no explicit grants/revokes, and creates `role_list_view` without `security_invoker` (`sources/devops/db/schema.sql:35-76`, `sources/devops/db/schema.sql:350-363`). This makes application-code authorization the only effective data boundary and leaves Data API exposure dependent on project defaults. Supabase's current transition to explicit table grants reinforces the need for deterministic grants in source: [Tables not exposed to Data and GraphQL API automatically](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

- [ ] ID=ARCH-HIGH-3, Severity=High, Complexity=Low, Priority=P1, Title=Privileged admin reads still rely on middleware alone, Fix description=Add one authenticated admin Server Component layout for all admin/RBAC routes and enforce the same guard inside privileged read services or route loaders; keep middleware as an early redirect rather than the sole read-authorization boundary.

Theme/language/translation pages re-check admin status server-side, but the user-management, functionality, and role pages immediately execute privileged reads without calling `requireAdmin()` (`sources/microservices/web-construct/app/(protected)/user-management/page.tsx:7-12`, `sources/microservices/web-construct/app/(protected)/functionalities/page.tsx:4-6`, `sources/microservices/web-construct/app/(protected)/roles-permissions/[roleId]/page.tsx:4-12`). Their services use the RLS-bypassing connection and contain no authorization guard (`sources/microservices/web-construct/lib/rbac/users-service.ts:64-109`, `sources/microservices/web-construct/lib/rbac/navigation-service.ts:10-29`). Today the middleware path list protects them (`sources/microservices/web-construct/lib/auth.config.ts:30-34`), but a matcher/path regression would expose privileged reads.

### Transaction and consistency boundaries

- [ ] ID=ARCH-HIGH-4, Severity=High, Complexity=Medium, Priority=P0, Title=Password reset writes the password before atomically claiming the token, Fix description=Claim the unused, unexpired token with one conditional `UPDATE ... RETURNING` inside a transaction, update the user's password in that same transaction, and roll back both on failure; treat a failed claim as a conflict rather than success.

The set-password route reads and validates a token, hashes the password, updates the user, and only afterward attempts to mark the token used (`sources/microservices/web-construct/app/api/auth/set-password/route.ts:24-58`). A concurrent request with the same token can pass the initial check and write a different password; the request that loses token claiming is still reported as success (`sources/microservices/web-construct/app/api/auth/set-password/route.ts:60-69`). The stated retry goal can be retained with a transaction: a password-update failure rolls back the token claim.

- [ ] ID=ARCH-HIGH-5, Severity=High, Complexity=Medium, Priority=P1, Title=Navigation edits can commit partial trees and duplicate ordering, Fix description=Wrap create/update/reparent/tag replacement in a single database transaction or RPC, lock the source/destination sibling sets during reordering, and enforce an ordering invariant such as a deferrable uniqueness constraint or a collision-tolerant rank strategy.

Creation computes `max(order)+1`, inserts the item, then replaces tags separately (`sources/microservices/web-construct/lib/rbac/navigation-actions.ts:27-65`). Reparenting updates every destination sibling one statement at a time (`sources/microservices/web-construct/lib/rbac/navigation-actions.ts:93-117`), and update then performs the main row update and tag replacement after the move (`sources/microservices/web-construct/lib/rbac/navigation-actions.ts:119-153`). Failures leave partial state, while concurrent creates/moves can select the same position because the schema has neither a sibling lock nor a uniqueness constraint (`sources/devops/db/schema.sql:197-217`).

- [ ] ID=ARCH-HIGH-6, Severity=High, Complexity=Medium, Priority=P1, Title=The last-active-administrator invariant has a TOCTOU race, Fix description=Move the invariant check and the role/status mutation into one database transaction/function that locks the relevant users and administrator assignments, rechecks the count under the lock, and rejects the mutation atomically.

The code counts other active administrators before invoking a separate role-replacement RPC or status update (`sources/microservices/web-construct/lib/rbac/users-actions.ts:23-47`, `sources/microservices/web-construct/lib/rbac/users-actions.ts:49-83`). Two administrators can concurrently remove or deactivate each other: each observes the other as the remaining active admin, both checks pass, and both mutations commit. The existing pure guard tests cannot cover this database race.

### Network and external integration boundaries

- [✅] ID=ARCH-HIGH-7, Severity=High, Complexity=Medium, Priority=P1, Title=Embedded-page preflight has an acknowledged DNS-rebinding SSRF path, Fix description=Resolve and validate every destination address against private, loopback, link-local, metadata, and reserved ranges immediately before connection, pin the validated address or enforce egress policy, continue rejecting redirects, and consider removing the server-side preflight if browser-only embedding is sufficient.

Remediation verified 2026-08-02: the checker resolves all DNS answers, rejects non-public IPv4/IPv6 ranges, pins a validated address through the request lookup callback, rejects redirects, and is backed by a pod egress policy excluding private and reserved IPv4 networks. All 31 focused embedded-check tests passed.

`checkEmbeddable()` performs a server-side HEAD and sometimes GET to an admin-configured URL (`sources/microservices/web-construct/lib/rbac/embedded-check.ts:123-169`). It blocks literal private addresses but explicitly does not resolve DNS and records DNS rebinding as an accepted residual risk (`sources/microservices/web-construct/lib/rbac/embedded-check.ts:68-71`). Any authorized embedded item is fetched when opened (`sources/microservices/web-construct/app/(protected)/embedded/[itemId]/page.tsx:14-25`), so a hostname resolving to an internal service can cross the application/network boundary.

### Data/schema evolution and operations

- [ ] ID=ARCH-MED-1, Severity=Medium, Complexity=High, Priority=P1, Title=Schema evolution has no versioned migration or drift gate, Fix description=Adopt ordered immutable migration files with a migration history table, pre/post-deploy verification and rollback/restore steps; generate or introspect the Drizzle model from the deployed schema and fail CI when `schema.sql`, migrations, and `lib/db/schema.ts` drift.

The project deliberately keeps one mutable 1,145-line `schema.sql` as DDL, migration, and seed source while hand-maintaining a second Drizzle schema (`docs/superpowers/specs/2026-07-18-drizzle-migration-design.md:16-21`, `docs/superpowers/specs/2026-07-18-drizzle-migration-design.md:28-40`). `db.mjs apply` submits the entire file and records no migration version (`sources/devops/db/db.mjs:41-61`), while package scripts have no schema-diff check (`sources/microservices/web-construct/package.json:5-14`). The destructive legacy-role ordering defect in ARCH-CRIT-2 demonstrates the operational consequence.

- [ ] ID=ARCH-MED-2, Severity=Medium, Complexity=Medium, Priority=P1, Title=Registration can strand an account after email delivery failure, Fix description=Model invitations as a retryable state machine/outbox: atomically create the user and invitation, queue delivery, expose resend/recovery for an existing passwordless account, and invalidate superseded tokens after successful delivery/use.

Registration creates the user and token before sending mail (`sources/microservices/web-construct/app/api/auth/register/route.ts:41-69`, `sources/microservices/web-construct/app/api/auth/register/route.ts:83-108`). If delivery fails, the user remains; a repeated registration exits at the duplicate check (`sources/microservices/web-construct/app/api/auth/register/route.ts:34-39`), while forgot-password issues a token only when a password already exists (`sources/microservices/web-construct/app/api/auth/forgot-password/route.ts:18-26`). Recovery therefore requires an administrator to discover the state and use the separate invite endpoint.

- [ ] ID=ARCH-MED-3, Severity=Medium, Complexity=Medium, Priority=P1, Title=Public credential endpoints have no repository-visible abuse control, Fix description=Define and implement rate limits for register, forgot-password, set-password, and Auth.js credential attempts at the ingress or application boundary, with per-IP and per-account dimensions, bounded email sends, observability, and a documented production dependency if enforcement remains external.

The public routes perform database writes, email delivery, or bcrypt work without throttling (`sources/microservices/web-construct/app/api/auth/register/route.ts:10-110`, `sources/microservices/web-construct/app/api/auth/forgot-password/route.ts:10-75`, `sources/microservices/web-construct/app/api/auth/set-password/route.ts:11-69`, `sources/microservices/web-construct/lib/auth.ts:67-109`). The supplied ingress has only a request-body-size annotation and no rate control (`sources/devops/k8s/dev/ingress.yaml:1-20`). This review does not prescribe a traffic threshold; it identifies the absent control on cost-amplifying public operations.

- [ ] ID=ARCH-MED-4, Severity=Medium, Complexity=High, Priority=P2, Title=Deployment assets are development-only despite a production-ready claim, Fix description=Either label the repository as a development template or add production overlays/runbooks covering immutable image tags, TLS, rollout/rollback, security context, disruption/replica policy, secrets rotation, network egress, and dedicated liveness/readiness endpoints; align cookie security with the actual scheme in each environment.

The README calls the template production-ready and claims self-contained manifests per environment (`README.md:1-3`, `README.md:24-40`), but only `sources/devops/k8s/dev/` exists and the README tells operators to create staging/prod themselves (`README.md:275-290`). The deployment runs one local mutable image and probes `/`, which normally validates only a redirect rather than dependencies (`sources/devops/k8s/dev/deployment.yaml:6-47`). The dev ConfigMap combines `NODE_ENV=production` with `AUTH_URL=http://construct.local` (`sources/devops/k8s/dev/configmap.yaml:6-12`), while language cookies are forced `secure` whenever `NODE_ENV` is production (`sources/microservices/web-construct/lib/i18n/user-language-actions.ts:39-47`), so the documented HTTP Kubernetes dev path cannot reliably persist them.

- [ ] ID=ARCH-MED-5, Severity=Medium, Complexity=Medium, Priority=P2, Title=i18n audit events are best-effort logs rather than a durable audit trail, Fix description=Define the audit guarantee explicitly and route events to a durable append-only sink with retention, access controls, correlation IDs, delivery monitoring, and redaction tests; if only diagnostic logs are intended, stop describing them as an audit trail.

Every i18n mutation emits a Pino event, but the implementation explicitly swallows recording failures and has no audit table (`sources/microservices/web-construct/lib/i18n/audit.ts:6-27`). The Kubernetes assets configure only log level and no collection/retention path (`sources/devops/k8s/dev/configmap.yaml:6-12`, `sources/devops/k8s/dev/deployment.yaml:16-47`). This is a useful structured diagnostic signal, but durability and completeness are currently external assumptions.

- [ ] ID=ARCH-MED-6, Severity=Medium, Complexity=High, Priority=P2, Title=Two independent locale catalogs create an evolution boundary, Fix description=Choose one authoritative language catalog for both UI chrome and navigation content, or generate the navigation locale capabilities from `app_language`; normalize navigation translations/tags into relational rows if runtime language extensibility is a product requirement.

UI languages are dynamic database rows, but navigation content uses a fixed nine-value TypeScript list (`sources/microservices/web-construct/lib/rbac/types.ts:3-5`) and the editor renders exactly that list (`sources/microservices/web-construct/components/rbac/functionalities/TranslationsAccordion.tsx:5-25`). The protected layout bridges them by uppercasing and otherwise falling back to English (`sources/microservices/web-construct/app/(protected)/layout.tsx:11-17`). The separation is documented and functional, but adding a UI language does not add corresponding navigation authoring capability, so the “no code change” language promise is partial.

### Scalability and maintainability

- [✅] ID=ARCH-LOW-1, Severity=Low, Complexity=Low, Priority=P2, Title=Primary architecture documentation describes removed components and credentials, Fix description=Regenerate the README architecture/auth/deployment sections from the current Next.js 16, Auth.js N:N RBAC, Drizzle `DATABASE_URL`, navigation-item, i18n, and Kubernetes design; add a lightweight documentation check to release review.

Remediation verified 2026-08-02: README now consistently documents Next.js 16, Auth.js, N:N `user_role` RBAC, Drizzle/PostgreSQL `DATABASE_URL`, `navigation_item`, database-backed i18n, disposable test-database gates, and the current Kubernetes development assets. Searches found none of the obsolete Next.js 15, `users.role`, `menu_items`, or browser Supabase-client setup instructions in the active README.

The README simultaneously says Next.js 15 and 16, describes the removed `users.role`, `menu_items`, and `lib/supabase-server.ts`, and instructs users to configure obsolete Supabase client variables (`README.md:1-3`, `README.md:44-88`, `README.md:191-218`, `README.md:294-302`). These are architecture-contract errors that can cause incorrect deployments and extensions.

- [ ] ID=ARCH-LOW-2, Severity=Low, Complexity=Low, Priority=P3, Title=Frequent reverse lookups and sidebar reads lack a measured scaling path, Fix description=Add indexes for observed reverse-FK access such as `user_role(id_role, user_id)` and `navigation_item(id_item_parent, order_position)`, verify them with `EXPLAIN`, and establish a cache/invalidation threshold before replacing the current full navigation scan.

Admin-role/user filtering queries `user_role` by `id_role`, but its primary key begins with `user_id` (`sources/devops/db/schema.sql:177-182`, `sources/microservices/web-construct/lib/rbac/users-actions.ts:23-29`, `sources/microservices/web-construct/lib/rbac/users-service.ts:20-27`). Sidebar construction reads every navigation row and filters in process on every request (`sources/microservices/web-construct/lib/rbac/navigation-service.ts:10-24`), while the schema has no parent/order index (`sources/devops/db/schema.sql:197-219`). Current volumes may make this acceptable; the recommendation is evidence-driven indexing and an explicit threshold, not premature infrastructure.

## Architecture strengths

- The modular-monolith shape is appropriate for the current scope: App Router routes delegate to focused RBAC/i18n/services without unnecessary network service boundaries.
- Server-only database access keeps database credentials out of browser bundles, and Drizzle parameterization is used consistently for user-controlled values.
- Translation saves use a real transaction, optimistic predicates, savepoints, and conflict reporting (`sources/microservices/web-construct/lib/i18n/translation-actions.ts:120-345`).
- Database constraints, foreign keys, update triggers, dictionary-version triggers, and atomic helper functions encode several important invariants close to the data (`sources/devops/db/schema.sql:420-643`).
- The process-local dictionary cache has a clear multi-pod freshness bound and synchronous local invalidation (`sources/microservices/web-construct/lib/i18n/dictionary-service.ts:13-37`, `sources/microservices/web-construct/lib/i18n/dictionary-service.ts:93-113`).
- Admin write paths generally call `requireAdmin()` before mutation, and route handlers validate untrusted grid/filter input.
- The test suite is broad and fast: 494 unit/component tests passed in this review.

## Prioritized evolution roadmap

This roadmap groups the existing findings and introduces no additional actions.

| Phase | Finding IDs | Exit condition |
|---|---|---|
| 0 — stop privilege/data loss | ARCH-CRIT-1, ARCH-CRIT-2, ARCH-HIGH-1, ARCH-HIGH-4 | Deactivation and role revocation take effect predictably; legacy RBAC upgrade and concurrent token use have verified failure-safe tests. |
| 1 — restore trustworthy boundaries | ARCH-HIGH-2, ARCH-HIGH-3, ARCH-HIGH-6, ARCH-HIGH-7 | Least-privilege DB identity, server-side admin read gates, atomic last-admin invariant, and SSRF-safe egress are deployed. |
| 2 — make mutations and delivery recoverable | ARCH-HIGH-5, ARCH-MED-2, ARCH-MED-3 | Navigation changes are atomic; onboarding and public auth endpoints have retry/abuse controls. |
| 3 — make operations evolvable | ARCH-MED-1, ARCH-MED-4, ARCH-MED-5 | Versioned migrations, tested production deployment/rollback, and explicit audit durability exist. |
| 4 — reduce ongoing debt | ARCH-MED-6, ARCH-LOW-1, ARCH-LOW-2 | Locale ownership, architecture docs, and measured query/index strategy are aligned. |

## Assumptions and limitations

- Reviewed branch `feature/migliorie-varie` at HEAD `2d0b4cddf07d3771a25f3cd8bbc1460a560fc479`. Its merge base and current tip are identical to local `development`, so there was no branch-only diff; this is a full-HEAD architecture review.
- No traffic, tenant-count, availability, recovery-time, recovery-point, regulatory, or retention targets were supplied. Findings avoid inventing such targets.
- The database was not mutated. Integration tests, E2E tests, Supabase advisors, live grants, query plans, backup/restore, and Kubernetes rollout were not executed because they require external state and this review was explicitly read-only.
- Supabase is used as hosted PostgreSQL through the direct protocol, not Supabase Auth or the Data API in application code. Data API/grant observations concern deployment hardening and deterministic exposure, not a claim that the current application calls PostgREST.
- Existing untracked reviewer output (`docs/reviews/2026-07-31-ui-ux-tester.md`) was not opened or modified.

## Checks performed

- Read repository instructions and architecture sources: `AGENTS.md`, `README.md`, `CLAUDE.md`, the architect-reviewer agent definition, RBAC/i18n/Drizzle/Kubernetes/OIDC designs, schema, deployment manifests, and source boundaries.
- `npm test`: 54 test files passed, 494 tests passed.
- `npm run lint`: completed with 0 errors and 4 warnings (two `<img>` performance warnings and two unused-import warnings).
- `npm run build`: production build completed successfully; Next.js emitted the current deprecation warning for the `middleware` file convention.
- Inspected branch/merge-base/status and repository-wide schema/RLS/function/grant declarations. The recurring fsmonitor IPC warning did not prevent Git reads.
- Checked the current official Supabase breaking-change index relevant to direct database/Data API exposure. No live project call was made.
