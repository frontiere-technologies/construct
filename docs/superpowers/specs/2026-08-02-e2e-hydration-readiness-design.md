# E2E Hydration Readiness Design

## Context

GitHub Actions run `30767530554` renders the public Next.js pages successfully, but every test that depends on a React event handler fails. Native links continue to work, while the test-login disclosure does not open and the registration/reset forms do not enter their submitted state. Database migrations, fixtures, and integration tests complete before these failures. The diagnostic rerun `30768502322` exposes the root cause in the Next.js log: the dev server identifies itself as `localhost`, while Playwright uses `127.0.0.1`, so Next.js blocks the cross-origin development resources and the client never hydrates.

The PostgreSQL message about `application_not_for_tests` is separate: the i18n cleanup invokes the runtime `query` command even though E2E mutations must use the disposable `test-query` command. Making `DATABASE_URL` equal to `TEST_DATABASE_URL` is not acceptable because the E2E safety gate deliberately rejects that configuration.

## Design

The workflow will use `http://localhost:3000` consistently for the application readiness probe, Auth.js URL, and Playwright base URL. PostgreSQL continues to use `127.0.0.1`; changing the browser origin does not weaken database isolation. The root client provider will also expose a document-level readiness attribute from a React effect. Because effects run only after hydration, this is a stable application-owned boundary: Playwright can distinguish “HTML arrived” from “React event handlers are attached”. The common navigation helper will wait for this boundary after page navigation, so future asset-loading failures stop at their real boundary instead of appearing as unrelated locator failures.

The i18n safety-net cleanup will use `test-query`, preserving the disposable-database guard. The workflow will print the captured Next.js server log whenever pytest fails, so a future server-side or hydration failure is visible in the check output instead of being hidden in `/tmp`.

## Verification

The readiness marker receives a focused component test that fails when the effect or cleanup is absent. Existing authentication and public-form E2E flows remain the behavioral coverage for interaction after hydration. Static checks, unit tests, and a production build verify that the marker does not alter normal rendering.
