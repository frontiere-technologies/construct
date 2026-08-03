# Code Review — `feature/migliorie-varie`

Date: 2026-07-31
Reviewed HEAD: `2d0b4cd`
Scope: complete repository state at HEAD, including application code, tests, database schema, authentication/RBAC boundaries, deployment configuration, dependencies, and documentation. The branch and `development` currently point to the same commit, so this is a full HEAD audit rather than a branch-only delta review.

## Findings and recommendations summary

The branch builds and its 494 unit tests pass, but it is not ready for production promotion. The review found **1 Critical, 6 High, 5 Medium, and 2 Low** actionable findings. The first priorities are to upgrade the vulnerable Auth.js/Next.js dependency chain, make deactivation and RBAC revocation effective for existing sessions, repair the destructive legacy-role migration order, and isolate all database-mutating tests from application data. Password-token consumption and the production test-login switch also need resolution before release.

Recommended disposition: **block release until CRIT-1 and HIGH-1 through HIGH-6 are fixed and regression-tested**. MED-1 through MED-5 should be scheduled before calling the template production-ready; LOW-1 and LOW-2 are maintainability/performance follow-ups.

## Remediation update — 2026-08-02

All findings below have been implemented. The remediation upgrades the production dependency graph to a clean audit; refreshes live account status and roles on every request; makes password-token use, navigation writes, and legacy-role migration atomic; isolates mutating tests behind `TEST_DATABASE_URL`; adds shared authentication throttles and DNS-pinned embedded checks; adds CI with an ephemeral PostgreSQL/E2E job; updates setup/deployment documentation; and removes query/lint/proxy debt.

Local verification after remediation: 65 unit files / 556 tests passed, ESLint passed with `--max-warnings=0`, the Next.js 16.2.12 production build passed without the middleware deprecation warning, `npm audit --omit=dev` reported zero vulnerabilities, TypeScript and whitespace checks passed, and Python/Node/shell syntax checks passed. Database integration and E2E regression tests are now defined against a disposable PostgreSQL service in `.github/workflows/quality.yml`; they were not run on the developer's configured application database.

## Actionable findings

### Critical

- [x] ID=CRIT-1, Severity=Critical, Complexity=Medium, Priority=P0, Title=Production authentication and framework dependencies have known exploitable advisories, Fix description=Upgrade `next-auth`/`@auth/core`, Next.js, and affected transitives to versions that `npm audit --omit=dev` no longer flags; regenerate and commit the lockfile, review Auth.js beta migration notes, then rerun unit, authentication, build, and dependency-audit gates before deployment.

  Evidence: `sources/microservices/web-construct/package.json:27-28` permits but `sources/microservices/web-construct/package-lock.json:8118-8129` pins Next.js 16.2.9 with PostCSS 8.4.31, while `sources/microservices/web-construct/package-lock.json:8171-8201` pins `next-auth` 5.0.0-beta.31 and `@auth/core` 0.41.2. The current production-only audit reported six vulnerable packages: two Critical (`next-auth`, `@auth/core`), three High (`next`, its PostCSS, and sharp chains), and one Low (DOMPurify). The Auth.js advisories include an existence-based authentication check fail-open and a Unicode-normalization email bypass; the Next.js advisories include middleware/proxy bypass, Server Action denial of service, and SSRF classes. This application directly relies on `authorized({ auth })` for route admission at `sources/microservices/web-construct/lib/auth.config.ts:13-35`, so the authentication fail-open is relevant, not merely an unused transitive.

### High

- [x] ID=HIGH-1, Severity=High, Complexity=Medium, Priority=P0, Title=Deactivated accounts can continue authenticating and using existing sessions, Fix description=Make active account status a mandatory authentication invariant: fetch `id_user_status` for credentials and OIDC logins, reject non-active users, and add a centralized request/privileged-action check (or revocation/version mechanism) so status changes invalidate already-issued JWT sessions; add tests for login and post-deactivation access.

  Evidence: the user status is persisted at `sources/microservices/web-construct/lib/db/schema.ts:40-65` and changed by `sources/microservices/web-construct/lib/rbac/users-actions.ts:70-84`, but credentials login selects only id/email/name/password at `sources/microservices/web-construct/lib/auth.ts:84-88` and accepts a valid password at `sources/microservices/web-construct/lib/auth.ts:102-107`. OIDC provisioning at `sources/microservices/web-construct/lib/auth.ts:154-187` likewise never reads status. Middleware and server guards trust session claims (`sources/microservices/web-construct/lib/auth.config.ts:13-35`, `sources/microservices/web-construct/lib/rbac/auth-guard.ts:3-7`). The only status tests found exercise the admin mutation guard, not authentication after deactivation (`sources/microservices/web-construct/lib/rbac/user-guards.test.ts:30-42`).

- [x] ID=HIGH-2, Severity=High, Complexity=Medium, Priority=P0, Title=Role removal does not revoke stale admin JWT authority, Fix description=Stop treating sign-in-time JWT role claims as indefinitely authoritative for privileged operations; either look up current roles/status in `requireAdmin`, introduce a per-user authorization version checked on each request, or actively revoke/rotate sessions when roles change, and test an already-signed-in administrator immediately after demotion.

  Evidence: roles are loaded only inside the `if (account && user)` sign-in branch at `sources/microservices/web-construct/lib/auth.ts:151-187`. Subsequent JWT callbacks return the existing token without refreshing roles, and the session callback copies those values at `sources/microservices/web-construct/lib/auth.ts:190-195`. `requireAdmin` trusts only `session.user.isAdmin` at `sources/microservices/web-construct/lib/rbac/auth-guard.ts:3-7`, while demotion only replaces database rows at `sources/microservices/web-construct/lib/rbac/users-actions.ts:49-68`; no session invalidation follows. Consequently a demoted administrator can continue calling privileged server actions and admin APIs for the remaining lifetime of the existing JWT.

- [x] ID=HIGH-3, Severity=High, Complexity=Low, Priority=P1, Title=Schema migration drops the legacy admin role before attempting its backfill, Fix description=Move the legacy `users.role` backfill ahead of the column drop in one transactional migration, verify the migrated admin count before dropping the source column, and add a migration fixture that starts with legacy `admin`/`user` rows; for environments that already ran this order, restore admin assignments from backup or an authoritative identity source.

  Evidence: `sources/devops/db/schema.sql:46-48` drops `users.role`. The supposed legacy-admin backfill does not run until `sources/devops/db/schema.sql:324-348`, where its `information_schema` guard necessarily sees that the column is already absent. The repository design explicitly required the opposite order (`docs/superpowers/specs/2026-06-28-rbac-module-design.md:52` and `:186`). The result is irreversible loss of legacy admin attribution and potential administrative lockout during upgrade.

- [x] ID=HIGH-4, Severity=High, Complexity=Medium, Priority=P1, Title=E2E and integration tests can mutate the application database without a test-database safety boundary, Fix description=Require a dedicated `TEST_DATABASE_URL`, refuse to start mutating tests unless the target is positively identified as disposable, remove suite-wide updates of real user rows, seed only isolated fixture users/data, and guarantee cleanup even after failures; document the safe test setup before advertising `uv run pytest`.

  Evidence: the autouse E2E fixture executes `update users set id_language = null where id_language is not null` before and after every test session at `sources/tests/e2e/conftest.py:20-35`. It invokes `sources/devops/db/db.mjs`, whose fallback explicitly loads the application connection string from `sources/microservices/web-construct/.env.local` at `sources/devops/db/db.mjs:31-38`. The authorized-domain E2E also creates a new account at `sources/tests/e2e/test_register.py:38-44` without cleanup. Database integration tests are gated by a flag but still use the same application `DATABASE_URL` and can switch the global default language (`sources/microservices/web-construct/lib/i18n/language-actions.integration.test.ts:69-83`). `README.md:236-245` tells developers to run E2E without warning about these mutations or requiring an isolated database. This review intentionally did not run E2E/integration tests for that reason.

- [x] ID=HIGH-5, Severity=High, Complexity=Medium, Priority=P1, Title=Password reset writes the password before it atomically claims the one-time token, Fix description=Implement a single database transaction/RPC that locks or conditionally claims one valid unexpired token, updates the password only for the successful claimant, marks the token used, and invalidates sibling reset tokens; any failure must roll back both password and token changes and return an error.

  Evidence: `sources/microservices/web-construct/app/api/auth/set-password/route.ts:24-38` reads validity without a lock, `:42-48` updates the password first, and only `:50-62` attempts the `used_at is null` claim. Two concurrent requests can both pass the read and write different password hashes before one token claim loses. Worse, `:63-67` explicitly returns success when marking the token used fails, leaving a known reset link reusable after the password has changed. The existing optimistic predicate protects only the token row; it does not make the preceding password write atomic.

- [x] ID=HIGH-6, Severity=High, Complexity=Low, Priority=P1, Title=Test credentials can impersonate any existing user when one environment flag is enabled in production, Fix description=Hard-disable the test provider whenever `NODE_ENV === 'production'`, fail startup if a production deployment sets test-auth flags, remove the server test switch from production secret templates, and add a production-configuration test proving the provider is absent even if the flag is accidentally set.

  Evidence: the provider is enabled solely by `AUTH_TEST_CREDENTIALS === 'true'` at `sources/microservices/web-construct/lib/auth.ts:112-130`; it accepts only an email, upserts/loads that row, and then receives the target user's current roles in the JWT at `sources/microservices/web-construct/lib/auth.ts:183-186`. The client-side `NEXT_PUBLIC_AUTH_TEST_MODE` at `sources/microservices/web-construct/components/Login.tsx:19` only hides the UI and does not disable the endpoint. `sources/devops/k8s/dev/secret.env.example:13` exposes the server switch without a production fail-closed guard. If mis-set, an unauthenticated caller can submit an administrator email and obtain that administrator's authority without a password.

### Medium

- [x] ID=MED-1, Severity=Medium, Complexity=Medium, Priority=P1, Title=Credential and recovery endpoints lack abuse controls and one login path leaks account state, Fix description=Add shared per-IP and per-account throttling/backoff for credentials login, registration, forgot-password, set-password, and change-password; return a uniform credentials failure for unknown, passwordless, deactivated, and wrong-password accounts, while recording the diagnostic reason only in redacted server logs.

  Evidence: no limiter or attempt counter is present in `sources/microservices/web-construct/lib/auth.ts:76-108` or in the public handlers at `sources/microservices/web-construct/app/api/auth/register/route.ts:10-110`, `forgot-password/route.ts:10-75`, and `set-password/route.ts:11-69`. An existing passwordless account throws the distinct `PasswordNotSet` code at `sources/microservices/web-construct/lib/auth.ts:96-100`, and the login page deliberately maps it to a different user-visible message at `sources/microservices/web-construct/components/Login.tsx:10-16`, enabling targeted account-state enumeration. Unlimited forgot-password requests can also generate many still-valid tokens and outbound emails.

- [x] ID=MED-2, Severity=Medium, Complexity=Medium, Priority=P2, Title=Navigation create, update, and reorder operations can commit partially, Fix description=Wrap each logical navigation mutation in a Drizzle transaction or one validated database function, including item fields, tag replacement, reparenting, and sibling renumbering; add injected-failure and concurrent-reorder tests that prove rollback and unique deterministic order.

  Evidence: creation commits the item before tag replacement at `sources/microservices/web-construct/lib/rbac/navigation-actions.ts:40-64`; a tag failure leaves an item even though the action reports failure. Reparenting updates each sibling in a loop at `:93-116` without a transaction, so a mid-loop error leaves partial parent/order changes. Update can reparent at `:124-132`, then fail the field write or tag write at `:135-153`, producing a mixed old/new state. The normal-path tree tests do not exercise database rollback behavior.

- [x] ID=MED-3, Severity=Medium, Complexity=Medium, Priority=P2, Title=Embedded-page validation remains vulnerable to DNS-based SSRF, Fix description=Resolve hostnames before connecting, reject every private, loopback, link-local, multicast, and otherwise reserved result for IPv4 and IPv6, pin the validated address through the request, revalidate every redirect, and enforce an outbound network policy/allow-list for the web pod.

  Evidence: `sources/microservices/web-construct/lib/rbac/embedded-check.ts:68-71` explicitly states that DNS is not resolved and accepts DNS rebinding as residual risk. The actual server-side HEAD/GET follows at `:123-168`; only literal host forms are blocked. Any authorized viewer of a configured embedded item triggers this server request at `sources/microservices/web-construct/app/(protected)/embedded/[itemId]/page.tsx:14-25`. An application administrator who can configure a hostname can therefore make the server contact an internal address through DNS and infer at least response/header behavior across the server's network boundary.

- [x] ID=MED-4, Severity=Medium, Complexity=Low, Priority=P2, Title=No CI workflow enforces tests, build, lint, or dependency security, Fix description=Add a pull-request workflow that installs from the lockfile and runs lint with zero-warning policy, unit tests, the production build, `git diff --check`, and a dependency advisory gate; run database/E2E tests only against an ephemeral isolated database and browser service.

  Evidence: `.github/workflows` contains only `.gitkeep`; no automated quality gate exists. This matters because the current local checks already surface dependency vulnerabilities, lint warnings, a deprecated Next.js middleware convention, and whitespace failures that can otherwise merge unnoticed.

- [x] ID=MED-5, Severity=Medium, Complexity=Low, Priority=P2, Title=README and environment template describe an obsolete architecture and cannot configure the documented app, Fix description=Rewrite setup/auth/RBAC/menu sections from the current schema and runtime, document `DATABASE_URL` instead of removed public Supabase client keys, replace the invalid `users.role` promotion command with `user_role`, list all required Auth.js/OIDC/test variables in `.env.template`, and document safe schema/test commands.

  Evidence: `README.md:3` and `:48` call the app Next.js 15 while `:28` and the lockfile use 16; `README.md:14`, `:64`, and `:74-105` still describe the removed single-role and `menu_items` models, including an `UPDATE users SET role` command against a column the schema drops. `README.md:199-223` instructs users to configure obsolete `NEXT_PUBLIC_SUPABASE_*`/service-role variables, while the application uses `DATABASE_URL`. Conversely, the copied `sources/microservices/web-construct/.env.template:1-28` omits `AUTH_SECRET`, every OIDC provider variable, and both test-auth flags that the README says to configure.

### Low

- [x] ID=LOW-1, Severity=Low, Complexity=Low, Priority=P3, Title=Role-filtered user listing materializes every matching user ID in application memory, Fix description=Replace the preliminary all-ID query and large `IN (...)` list with an `EXISTS`/join/subquery in both page and count queries, preserving deduplication in SQL and adding a scale-oriented query test.

  Evidence: `sources/microservices/web-construct/lib/rbac/users-service.ts:20-28` loads every matching `user_role.user_id`, deduplicates in JavaScript, and `:43-61` feeds the full array back into an `inArray` predicate. This adds an extra round trip and grows application memory, SQL parameter volume, and latency with the total matching population rather than the requested page size.

- [x] ID=LOW-2, Severity=Low, Complexity=Low, Priority=P3, Title=Static-quality checks pass with warnings and deprecated framework structure, Fix description=Replace or intentionally justify the two raw image uses, remove unused imports, migrate `middleware.ts` to the supported Next.js proxy convention, and make CI fail on new warnings so the baseline remains clean.

  Evidence: `npm run lint` completed with four warnings: raw `<img>` at `sources/microservices/web-construct/components/IconRenderer.tsx:41` and `sources/microservices/web-construct/components/Login.tsx:72`, unused `eq` at `sources/microservices/web-construct/lib/profile-actions.ts:3`, and unused `UserNavigationTreeDto` at `sources/microservices/web-construct/lib/rbac/permission-tree.test.ts:3`. `npm run build` succeeded but warned that the `middleware` file convention is deprecated. `git diff --check origin/main...HEAD` also reported trailing whitespace in several added documentation/skill files and a missing final newline in `CLAUDE.md`.

## Strengths

- Privileged grid API routes consistently perform explicit session/admin checks and validate request bodies with Zod before querying.
- SQL construction uses Drizzle parameterization; the reviewed dynamic filters escape wildcard text and constrain sortable columns through schemas/static maps.
- Password hashing uses bcrypt with a cost of 12 for password creation/change, and the credentials path performs a dummy comparison for unknown users to reduce timing enumeration.
- RLS is enabled on the application tables, secrets are kept out of committed Kubernetes manifests, the runtime container drops root privileges, and structured logging has a useful redaction baseline.
- The embedded-page checker rejects literal loopback/private/link-local IPv4, IPv6, mapped IPv6, and redirects; its 28 focused tests are a good foundation for completing DNS-safe enforcement.
- i18n mutation code has strong optimistic-lock handling and real-database race tests, while dictionary failures degrade to fallback behavior rather than crashing renders.
- Unit coverage is broad across RBAC, grids, i18n, sanitization, URL synchronization, tree rules, and boundary dates. The observed suite is fast and deterministic: 54 files / 494 tests passed.
- The production build and TypeScript phase complete successfully at the reviewed HEAD.

## Checks actually run

- `git status --short --branch`, branch/remotes/log inspection, merge-base and full `origin/main...HEAD` file/stat review.
- Repository-wide source inventory and targeted security/code-smell searches with `rg`.
- Manual review of authentication, authorization guards, server actions, API routes, database schema/RPCs, i18n services/actions, navigation, embedded-content handling, E2E/integration fixtures, Docker/Kubernetes files, and setup documentation.
- `npm test` — **passed**: 54 test files, 494 tests.
- `npm run lint` — **completed with 0 errors and 4 warnings**.
- `npm run build` — initial sandbox run failed because Turbopack was not permitted to bind an internal port; the approved non-sandboxed rerun **passed**, including TypeScript and static page generation. It emitted the Next.js middleware deprecation warning.
- `npm audit --omit=dev --json` — **failed the security gate**: 6 vulnerable production packages (2 Critical, 3 High, 1 Low), with fixes reported available.
- `npm ls next next-auth @auth/core postcss sharp dompurify --omit=dev` — confirmed the installed vulnerable versions/chains.
- `git diff --check origin/main...HEAD` — **failed formatting hygiene** on trailing whitespace/newline findings; no production-code patch was made.
- `bash -n sources/devops/k8s/dev/apply.sh` — passed.
- `node --check sources/devops/db/db.mjs` — passed.

## Limitations

- E2E tests were not run because their autouse fixture mutates all users through the application database connection (HIGH-4). Running them would not have been a safe read-only diagnostic against the available environment.
- Database integration tests and `schema.sql` application were not run because they perform real writes and no disposable review database was provided. SQL findings are based on static control-flow/schema review and repository specifications/history.
- No code coverage tool/provider is configured in the project and coverage was not measured; this report does not claim the agent template's `>80%` target. Test counts are execution counts only.
- Cyclomatic complexity, load/performance impact, license compliance, and transitive bundle size were not measured with dedicated tools; no numeric claims are made for them.
- OIDC providers, email delivery, Kubernetes admission, and live browser behavior were not exercised against external services.
- The full branch differs substantially from the old `origin/main`; the review prioritized current runtime/security/data boundaries and sampled UI code rather than asserting manual line-by-line inspection of every generated planning/specification asset.

## Prioritized conclusion

1. **P0:** Resolve CRIT-1, HIGH-1, and HIGH-2 before any deployment; these affect authentication admission and revocation.
2. **P1:** Repair the migration order (HIGH-3), isolate test databases (HIGH-4), make reset-token use atomic (HIGH-5), and fail closed on test credentials (HIGH-6).
3. **P1/P2:** Add abuse controls (MED-1), transactional navigation writes (MED-2), and DNS-safe egress enforcement (MED-3).
4. **P2/P3:** Establish CI (MED-4), make setup documentation truthful and usable (MED-5), then address scalability and warning debt (LOW-1, LOW-2).

Overall assessment: **Not ready to merge/release without fixes.** The branch has solid unit-level engineering and succeeds at build time, but the current dependency, revocation, migration, reset-token, and test-database boundaries are release blockers.
