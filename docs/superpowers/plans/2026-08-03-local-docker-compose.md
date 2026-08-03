# Local Docker Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a supported one-command Docker Compose workflow that runs the Next.js application locally while keeping PostgreSQL hosted by Supabase.

**Architecture:** A root-level `compose.yaml` builds the existing standalone Next.js Dockerfile and starts one `web` service. Runtime settings come from an ignored `.env.docker.local`; the README explains how to point its limited `DATABASE_URL` at Supabase Supavisor and keeps migration credentials on the host.

**Tech Stack:** Docker Compose Specification, Next.js 16 standalone container, Supabase PostgreSQL/Supavisor, Node.js built-in test runner.

## Global Constraints

- Compose starts exactly one service named `web`; it does not start PostgreSQL or another dependency.
- `DATABASE_URL` uses a dedicated limited login inheriting only `construct_runtime` through Supabase Supavisor transaction mode on port `6543`.
- `MIGRATION_DATABASE_URL` remains operator-side and is never passed to the web container.
- The local origin is `http://localhost:3000`.
- The real `sources/microservices/web-construct/.env.docker.local` file must never be committed.
- Source changes require rebuilding the standalone production image; Compose does not mount source code or provide hot reload.

---

### Task 1: Supported local Docker Compose workflow

**Files:**
- Create: `compose.yaml`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `sources/devops/docs-contract.test.mjs`
- Modify: `docs/superpowers/specs/2026-08-03-local-docker-compose-design.md`

**Interfaces:**
- Consumes: `sources/microservices/web-construct/Dockerfile`, `.env.template`, `/api/health/ready`, and the host-side `sources/devops/db/db.mjs` operator workflow.
- Produces: root command `docker compose up --build -d`, service `web`, image `construct-web:local`, published URL `http://localhost:3000`, and ignored runtime file `sources/microservices/web-construct/.env.docker.local`.

- [ ] **Step 1: Add failing documentation/configuration contracts**

Extend `sources/devops/docs-contract.test.mjs` with a test that reads `compose.yaml`, `.gitignore`, and `README.md`, then asserts:

```js
test('local Docker Compose runs only the web app against external Supabase', () => {
  const compose = read('compose.yaml')
  const gitignore = read('.gitignore')
  const readme = read('README.md')

  assert.match(compose, /^services:\n  web:/m)
  assert.doesNotMatch(compose, /^  (db|postgres|supabase):/m)
  assert.match(compose, /sources\/microservices\/web-construct\/\.env\.docker\.local/)
  assert.match(compose, /3000:3000/)
  assert.match(compose, /api\/health\/ready/)
  assert.doesNotMatch(compose, /MIGRATION_DATABASE_URL/)
  assert.match(gitignore, /sources\/microservices\/web-construct\/\.env\.docker\.local/)
  assert.match(readme, /Local Docker with Supabase/)
  assert.match(readme, /docker compose up --build -d/)
  assert.match(readme, /Supavisor/)
  assert.match(readme, /MIGRATION_DATABASE_URL/)
})
```

- [ ] **Step 2: Run the contract and verify the expected failure**

Run:

```bash
cd sources/microservices/web-construct
npm run test:docs-contract
```

Expected: FAIL because root-level `compose.yaml` does not exist.

- [ ] **Step 3: Add the minimal Compose model and secret exclusion**

Create `compose.yaml`:

```yaml
services:
  web:
    image: construct-web:local
    build:
      context: ./sources/microservices/web-construct
      dockerfile: Dockerfile
    env_file:
      - ./sources/microservices/web-construct/.env.docker.local
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -T 5 -t 1 -O /dev/null http://127.0.0.1:3000/api/health/ready"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 20s
```

Add this exact entry to `.gitignore` under environment variables:

```gitignore
sources/microservices/web-construct/.env.docker.local
```

- [ ] **Step 4: Document configuration, lifecycle, and troubleshooting**

Add `## Local Docker with Supabase` after the native local setup. It must document:

```bash
cp sources/microservices/web-construct/.env.template \
  sources/microservices/web-construct/.env.docker.local
openssl rand -base64 32
docker compose up --build -d
docker compose ps
curl --fail http://localhost:3000/api/health/ready
docker compose logs -f web
docker compose down
docker compose up --build -d
```

State that `.env.docker.local` must set the Supavisor transaction-pooler `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL=http://localhost:3000`, an OIDC provider, and optional mail settings. State that migrations and runtime-role provisioning run from the host with `MIGRATION_DATABASE_URL`, which is not supplied to Compose. Explain that readiness failures usually mean invalid Supabase credentials, unavailable pooler/network, missing schema, or invalid authentication configuration.

- [ ] **Step 5: Run focused verification**

Create a temporary `.env.docker.local` containing non-secret syntactically valid dummy values, then run:

```bash
docker compose config --quiet
cd sources/microservices/web-construct
npm run test:docs-contract
cd ../../..
git check-ignore -v sources/microservices/web-construct/.env.docker.local
git diff --check
```

Expected: Compose exits `0`; documentation tests pass; `git check-ignore` identifies the new `.gitignore` rule; diff check reports no whitespace errors. Remove only the temporary dummy environment file after verification.

- [ ] **Step 6: Mark the originating design checklist complete**

In `docs/superpowers/specs/2026-08-03-local-docker-compose-design.md`, change each implemented and verified `- [ ]` item to `- [✅]`. Do not mark the optional real-Supabase integration check complete unless it was actually performed.

- [ ] **Step 7: Commit the implementation**

```bash
git add compose.yaml .gitignore README.md sources/devops/docs-contract.test.mjs \
  docs/superpowers/specs/2026-08-03-local-docker-compose-design.md \
  docs/superpowers/plans/2026-08-03-local-docker-compose.md
git commit -m "docs: add local Docker Compose workflow"
```
