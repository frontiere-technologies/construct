# Construct

Construct is a production-ready application template built with Next.js 16 and React 19. Authentication, live authorization checks, database-driven navigation, user profiles, internationalization, and theming are included.

Read [CLAUDE.md](./CLAUDE.md) for repository-specific engineering rules.

## Included features

| Feature | Description |
|---|---|
| Authentication | Auth.js v5 with Google, Microsoft Entra ID, Keycloak, and local email/password |
| Authorization | Multi-role RBAC through `role`, `user_role`, and `role_item`; deactivation and demotion take effect on the next request |
| Navigation | Database-driven category/functionality tree with tags, translations, permissions, and transactional reordering |
| Administration | User status/role management, navigation builder, permissions, languages, translations, and theme configuration |
| Internationalization | Database-backed UI dictionaries with language fallback and optimistic-lock editing |
| Testing | Vitest unit tests, disposable-database integration tests, and Python/Playwright E2E tests |
| Deployment | Standalone Next.js container, reusable Kustomize base, dev overlay, and hardened production example |

## Technology

- Next.js 16 App Router, React 19, and TypeScript
- Tailwind CSS v4 and Lucide icons
- Auth.js v5, bcrypt, and Zod
- PostgreSQL hosted by Supabase, accessed directly with Drizzle and `postgres.js` (Supabase Auth is not used)
- Pino logging, Nodemailer/Resend email, Vitest, pytest, and Playwright

## Repository layout

```text
construct/
├── sources/microservices/web-construct/
│   ├── app/                     # App Router pages, server actions, and API routes
│   ├── components/              # Shared client/server UI
│   ├── context/                 # UI and i18n contexts
│   ├── lib/                     # Auth, database, RBAC, i18n, and service code
│   ├── types/                   # Shared TypeScript declarations
│   └── proxy.ts                 # Authentication and admin-route admission
├── sources/devops/db/migrations/ # Ordered immutable SQL migrations
├── sources/devops/db/schema.sql  # Generated migration snapshot; never hand-edit
├── sources/devops/k8s/base/      # Reusable Kubernetes resources
├── sources/devops/k8s/overlays/  # Development and production-example overlays
└── sources/tests/e2e/           # Python/Playwright E2E suite
```

## Authentication and authorization

1. `proxy.ts` redirects unauthenticated or deactivated requests to `/login`.
2. Auth.js validates an OIDC identity or an internal bcrypt password.
3. OIDC identities are upserted into `users`; every first-time user receives Registered user role `0`.
4. The JWT callback reloads the user's current `id_user_status` and role IDs from PostgreSQL on each request.
5. The session exposes `id`, `roleIds`, `isAdmin`, `accountActive`, and the authentication provider.
6. Privileged server actions reload status and roles again through `requireAdmin()`.

This means deactivating an account or removing Administrator role `1` revokes authority without waiting for the JWT to expire.

To assign Administrator role safely:

```sql
insert into user_role (user_id, id_role)
select id, 1 from users where email = 'user@example.com'
on conflict (user_id, id_role) do nothing;
```

Use Admin → Users for normal role and status management. PostgreSQL serializes role/status changes and rejects any mutation that would remove the final active administrator; the UI also blocks self-demotion and self-deactivation early.

## Navigation

`navigation_item` stores categories and functionalities, `navigation_item_tag` stores localized tags, and `role_item` stores role grants. Mutating operations are wrapped in database transactions and serialized with a transaction-scoped advisory lock, so item fields, tags, parent changes, and sibling order commit or roll back together.

Use Admin → Menu Builder and Admin → Roles & Permissions rather than editing navigation rows manually.

`user_role(id_role, user_id)` and `navigation_item(id_item_parent, order_position)` support reverse role lookup and sibling scans. Keep the current request-local full navigation read until production measurements show it is material—for example, sustained sidebar query p95 above the derived application's database budget or a navigation catalogue large enough to dominate request time. At that point add cache/invalidation from observed traces, not from row count alone.

## Internationalization

UI copy is stored in three tables:

| Table | Purpose |
|---|---|
| `app_language` | Language code, BCP-47 locale, active/default state, and dictionary version |
| `translation_key` | Stable dot-separated key plus namespace/module metadata |
| `translation_value` | One optimistic-locked value per key and language |

Language resolution order is session switch, user profile, persistent cookie, browser `Accept-Language`, then the database default. A missing value falls back to the default language; development renders `[missing: key]` and production renders the bare key.

Use `/admin/languages` to manage languages and `/admin/translations` to manage keys and values. `app_language` also drives the navigation authoring locale list and configured fallback. Seed-time additions belong in a new ordered migration, never directly in generated `sources/devops/db/schema.sql`.

The structured `i18n-audit` Pino records are best-effort diagnostics, not a durable or compliance-grade audit system. A production deployment must route stdout/stderr to its log platform and define retention, access controls, monitoring, and redaction tests; a logging failure does not roll back a completed mutation.

## Local setup

Requirements: Node.js 22+, npm, a PostgreSQL/Supabase database, and at least one OIDC provider (or local-only test credentials).

```bash
git clone <repo-url> construct
cd construct
npm run install:all
cp sources/microservices/web-construct/.env.template sources/microservices/web-construct/.env.local
```

Configure at minimum:

```env
DATABASE_URL=postgresql://postgres.project:password@pooler-host:6543/postgres
AUTH_SECRET=<output of: openssl rand -base64 32>
AUTH_URL=http://localhost:3000

# Configure one or more providers:
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_MICROSOFT_ENTRA_ID_ID=
AUTH_MICROSOFT_ENTRA_ID_SECRET=
AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=
AUTH_KEYCLOAK_ID=
AUTH_KEYCLOAK_SECRET=
AUTH_KEYCLOAK_ISSUER=
```

`DATABASE_URL` must use a dedicated limited login inheriting only `construct_runtime`. Browser code never connects to Supabase/PostgREST; all data access crosses the Next.js server boundary. Keep the owner-level migration URL outside the web directory/process; use `sources/devops/db/operator.env.example` only as an operator-side template:

```bash
export MIGRATION_DATABASE_URL='postgresql://...operator-only...'
export CONSTRUCT_RUNTIME_DB_USER='construct_app'
export CONSTRUCT_RUNTIME_DB_PASSWORD='<at-least-24-random-characters>'
node sources/devops/db/db.mjs apply
node sources/devops/db/db.mjs provision-runtime-role
```

Then put the new limited login in `DATABASE_URL` and start the app:

```bash
cd sources/microservices/web-construct
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Local Docker with Supabase

Docker Compose runs only the production-style standalone Next.js container. The database remains hosted by Supabase: the container connects directly to the Supavisor transaction pooler, and no local PostgreSQL service is started.

Requirements: Docker with the Compose plugin, an initialized Supabase database, and a dedicated limited database login inheriting only `construct_runtime`. Apply migrations and provision that runtime role from the host first, as described in [Local setup](#local-setup). Keep `MIGRATION_DATABASE_URL` on the host; it is intentionally not passed to the web container.

From the repository root, create the ignored container environment file:

```bash
cp sources/microservices/web-construct/.env.template \
  sources/microservices/web-construct/.env.docker.local
openssl rand -base64 32
```

Edit `.env.docker.local` and configure at minimum:

```env
# Supabase → Project Settings → Database → Transaction pooler (port 6543).
# Use the limited runtime login, not the owner or migration login.
DATABASE_URL=postgresql://construct_app.project:password@pooler-host:6543/postgres
AUTH_SECRET=<output of: openssl rand -base64 32>
AUTH_URL=http://localhost:3000

# Configure one or more OIDC providers:
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_MICROSOFT_ENTRA_ID_ID=
AUTH_MICROSOFT_ENTRA_ID_SECRET=
AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=
AUTH_KEYCLOAK_ID=
AUTH_KEYCLOAK_SECRET=
AUTH_KEYCLOAK_ISSUER=
```

Configure the selected OIDC provider to allow callbacks from the `http://localhost:3000` application origin. Add the mail settings from `.env.template` when invitation, registration, or password-reset email delivery is required. Do not put `MIGRATION_DATABASE_URL` in `.env.docker.local`.

Build and start the container in the background:

```bash
docker compose up --build -d
```

Check the container and its database-aware readiness endpoint:

```bash
docker compose ps
curl --fail http://localhost:3000/api/health/ready
```

Then open [http://localhost:3000](http://localhost:3000). If the service does not become healthy, inspect its logs:

```bash
docker compose logs -f web
```

Readiness failures normally indicate an invalid Supabase connection string, unreachable Supavisor endpoint, missing database migrations, or incomplete authentication configuration.

Stop and remove the local container and network with:

```bash
docker compose down
```

The Compose workflow runs the production standalone build and does not mount the source tree. Rebuild after source changes:

```bash
docker compose up --build -d
```

### Local test credentials

The test provider is available only outside production and only when both flags are true:

```env
AUTH_TEST_CREDENTIALS=true
NEXT_PUBLIC_AUTH_TEST_MODE=true
```

Production startup fails closed if either flag is enabled. Container and Kubernetes production templates do not expose these switches.

## Verification

Unit and static checks do not mutate a database:

```bash
cd sources/microservices/web-construct
npm test
npm run test:migrations
npm run test:docs-contract
npm run schema:check
npm run lint -- --max-warnings=0
npm run build
npm audit --omit=dev
```

### Database integration and E2E tests

Mutating tests require a separate disposable database. Commands refuse to run unless `TEST_DATABASE_URL` exists, differs from `DATABASE_URL`, and `TEST_DATABASE_DISPOSABLE=1` explicitly confirms the target can be destroyed or changed. Never use a shared development, staging, or production database.

```bash
export TEST_DATABASE_URL='postgresql://...dedicated-test-database...'
export TEST_DATABASE_DISPOSABLE=1
node sources/devops/db/db.mjs test-apply

cd sources/microservices/web-construct
npm run test:integration

# Start the app against the same disposable database for E2E:
DATABASE_URL="$TEST_DATABASE_URL" \
  AUTH_TEST_CREDENTIALS=true \
  NEXT_PUBLIC_AUTH_TEST_MODE=true \
  npm run dev
```

In another terminal:

```bash
cp sources/tests/e2e/.env.test.example sources/tests/e2e/.env.test
# Fill TEST_EMAIL, TEST_EMAIL_USER, TEST_DATABASE_URL, and TEST_DATABASE_DISPOSABLE=1.
uv sync --locked
uv run playwright install chromium
uv run pytest sources/tests/e2e
```

The E2E fixture resets only its named users and removes the exact registration account created by that run, including after failures.

## Adding application pages

1. Add `app/(protected)/your-page/page.tsx`; the route is automatically protected by `proxy.ts`.
2. Add its navigation item in Admin → Menu Builder.
3. Grant access in Admin → Roles & Permissions.

New server mutations must perform explicit authorization and validate their input. Use `lib/db.ts` for database access and keep multi-statement logical mutations in one transaction or validated PostgreSQL function.

## Deployment

The image is built from `sources/microservices/web-construct/Dockerfile` and runs as a non-root user. The Kubernetes base includes dedicated liveness/readiness endpoints, a read-only root filesystem, dropped capabilities, restricted egress, rolling updates, and separate runtime/migration secrets.

For local Kubernetes development:

```bash
cd sources/devops/k8s/dev
cp secret.env.example secret.env
# Fill DATABASE_URL, AUTH_SECRET, provider secrets, and mail credentials.
bash apply.sh
```

Validate both overlays before deployment:

```bash
bash sources/devops/k8s/validate.sh
kubectl kustomize sources/devops/k8s/overlays/production-example
```

The production example uses two replicas, TLS, a PodDisruptionBudget, and an immutable image-digest placeholder. Replace every example value for the derived application and follow [the production deployment runbook](docs/runbooks/production-deployment.md), including backup, checksummed migrations, role provisioning, rollout/rollback, restore approval, rotation, and log retention. The web pod receives only the limited `DATABASE_URL`; `MIGRATION_DATABASE_URL` belongs only to the operator or one-shot migration Job.

The pod network policy permits DNS and required public HTTP/HTTPS, SMTP, and database pooler ports while excluding private, loopback, link-local, multicast, and reserved IPv4 destinations. Embedded-page checks additionally validate every DNS answer and pin the validated address through the outbound request.
