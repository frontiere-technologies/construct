# E2E Hydration Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CI E2E interactions wait for React hydration, keep all mutations on the disposable database, and expose server diagnostics on failure.

**Architecture:** A small client component owns a document readiness attribute and is mounted by the existing root provider. Playwright's shared navigation helper waits on that public boundary. Database cleanup and workflow diagnostics remain test/infrastructure concerns.

**Tech Stack:** Next.js 16, React 19, Vitest, Testing Library, Python Playwright, GitHub Actions, PostgreSQL.

## Global Constraints

- `DATABASE_URL` and `TEST_DATABASE_URL` must remain different.
- E2E database mutations must pass through disposable-test commands.
- Synchronization must use an observable condition, not a fixed delay.
- The production application must fail closed when test authentication is enabled under `NODE_ENV=production`.

---

### Task 1: Hydration readiness boundary

**Files:**
- Create: `sources/microservices/web-construct/components/AppHydrationMarker.tsx`
- Create: `sources/microservices/web-construct/components/AppHydrationMarker.test.tsx`
- Modify: `sources/microservices/web-construct/app/providers.tsx`
- Modify: `sources/tests/e2e/helpers.py`

**Interfaces:**
- Produces: `<html data-app-hydrated="true">` after the root client tree hydrates.
- Consumes: Playwright `page.wait_for_function` after navigation.

- [✅] **Step 1: Write a component test asserting that mount adds and unmount removes the readiness attribute.**
- [✅] **Step 2: Run the focused Vitest test and confirm it fails because the readiness attribute is absent.**
- [✅] **Step 3: Implement the minimal effect component, mount it in `Providers`, and wait for its attribute in `nav`.**
- [✅] **Step 4: Run the focused test and existing unit suite.**

### Task 2: Disposable cleanup and failure diagnostics

**Files:**
- Modify: `sources/tests/e2e/test_i18n.py`
- Modify: `.github/workflows/quality.yml`

**Interfaces:**
- Consumes: `db.mjs test-query`, which enforces `TEST_DATABASE_URL` and `TEST_DATABASE_DISPOSABLE=1`.
- Produces: Next.js log output in the failed GitHub Actions step.

- [✅] **Step 1: Replace the cleanup's runtime query with `test-query`.**
- [✅] **Step 2: Wrap pytest so `/tmp/construct-next.log` is printed before returning a failure.**
- [✅] **Step 3: Run migration/docs contract tests and inspect the workflow diff.**
- [✅] **Step 4: Use `localhost` consistently for the Next.js readiness probe, Auth.js, and Playwright after the diagnostic run proves that Next.js blocks client resources requested through `127.0.0.1`.**

### Task 3: Verification

**Files:**
- Verify all files changed by Tasks 1 and 2.

- [✅] **Step 1: Run the complete unit suite.**
- [✅] **Step 2: Run lint with zero warnings.**
- [✅] **Step 3: Run the production build.**
- [✅] **Step 4: Run `git diff --check` and review the final diff.**
