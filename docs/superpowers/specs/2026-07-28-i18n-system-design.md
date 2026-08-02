# Internationalization (i18n) System — Design Spec

**Date:** 2026-07-28
**Branch:** `feature/i18n`
**Source plan:** `docs/superpowers/plans/2026-07-28-i18n-system.md`
**Target:** `sources/microservices/web-construct/` (React 19 + Next.js 16 App Router + Auth.js v5 + Drizzle/Postgres + Tailwind v4)

---

## Summary

Add a database-driven, admin-configurable internationalization system: every UI label resolves through a central `t()` function backed by three Postgres tables (`app_language`, `translation_key`, `translation_value`), admins manage languages and translations from `/admin/languages` and `/admin/translations`, and each user's language preference persists on their profile (`users.id_language`).

This document records the decisions this plan actually made and why, written after all 18 tasks shipped — it describes the system as built, including the places implementation diverged from the plan's first draft (Task 9's optimistic-locking fix, Task 16's two-config Vitest split, Task 17's locale-tolerant login helper). Where a reason is traceable to the plan document or the code's own comments, it is cited as such; where a reason is this document's own inference from the code's structure, it is labeled as inference rather than presented as documented fact.

### Key decisions

- [x] ✅ ID=DEC-1, Title=No new i18n framework — `t()` over a DB dictionary, no `[locale]` route segments, no `next-intl`/`i18next`.
- [x] ✅ ID=DEC-2, Title=`app_language` naming — distinct from the pre-existing `SUPPORTED_LOCALES` content-language concept.
- [x] ✅ ID=DEC-3, Title=Uppercase bridge to `item_translation` — `code.toUpperCase()` at the one call site, not a second mapping table.
- [x] ✅ ID=DEC-4, Title=Trigger-driven dictionary versioning — a DB trigger bumps `app_language.dictionary_version`, not app-level pub/sub or manual cache-busting.
- [x] ✅ ID=DEC-5, Title=Drawer-based translations editor — one key's full row of languages edited in a side drawer, not inline grid cells.
- [x] ✅ ID=DEC-6, Title=Optimistic locking on both key and value — two independent version counters, not one.
- [x] ✅ ID=DEC-7, Title=Pino structured diagnostics instead of an audit table — no durability claim.
- [x] ✅ ID=DEC-8, Title=Rate limiting deliberately out of scope — access control and bounded responses/payloads reduce exposure, but the lack of request-rate controls remains an accepted trade-off.

---

## DEC-1 — No new i18n framework

**Decision:** Every label goes through a hand-written `t()` (server: `getI18n()` in `lib/i18n/server.ts`; client: `useI18n()`/`useT()` in `context/I18nContext.tsx`), backed by a plain `Record<string, string>` dictionary loaded from Postgres. No `next-intl`, no `i18next`, no `[locale]` dynamic route segment.

**Why (documented in the plan, `docs/superpowers/plans/2026-07-28-i18n-system.md:7`):** "`next-intl`/`i18next` would force `[locale]` route segments and rewrite every route and the middleware, which §15.2 [of the original project spec] forbids." Every route in this app (`app/(protected)/...`, `middleware.ts`'s `ADMIN_PATHS`, the E2E suite's URL assertions) is written as a locale-independent path today; adopting a routing-based i18n framework would touch every one of them for a feature whose actual surface is "swap a dictionary of strings," not "serve entirely different route trees per locale."

**Inference beyond the documented reason:** the app has a small, fixed page count (about 30 routes, confirmed by the `next build` route table) and a few hundred short strings (323 keys / 646 values after Task 18's schema re-apply) — well within what a hand-rolled dictionary handles cheaply. A framework's ICU message format, plural rules, and namespace-splitting machinery would be unused weight for this catalogue size; the plan's own progressive-loading note makes the same size argument for why namespace-scoped API loading exists but isn't used by the render path.

## DEC-2 — `app_language` naming

**Decision:** The new language table is `app_language`, not simply `language`.

**Why (documented — `docs/superpowers/plans/2026-07-28-i18n-system.md:22,38`):** the codebase already has a *content*-translation concept: `SUPPORTED_LOCALES = ['EN','IT','DE','FR','ES','NL','PT','SK','RO']` and `DEFAULT_LOCALE` in `lib/rbac/types.ts`, used to key `navigation_item.item_translation` (a jsonb blob of per-locale name/description for menu items) and `navigation_item_tag.tag_lan`. That system predates this plan, covers a fixed superset of nine locales for admin-authored *content*, and is explicitly kept out of this plan's scope (`docs/superpowers/plans/2026-07-28-i18n-system.md:5236`: "does **not** wire that component to `app_language`... it edits `navigation_item.item_translation`... a separate concern").

A table named plain `language` sitting next to a pre-existing `SUPPORTED_LOCALES`/`item_translation` pair would invite exactly the confusion the plan calls out: two independent notions of "what languages exist" with no naming signal to tell them apart. `app_language` names this table for what it actually drives — the **application's UI chrome**, as opposed to admin-authored navigation content — and reads unambiguously next to `item_translation` in any query, log line, or migration diff.

## DEC-3 — Uppercase bridge to `item_translation`

**Decision:** `app/(protected)/layout.tsx` computes the sidebar's content locale as:

```ts
const upper = language.code.toUpperCase()
const locale: Locale = (SUPPORTED_LOCALES as readonly string[]).includes(upper) ? (upper as Locale) : DEFAULT_LOCALE
```

— a runtime-checked cast, not a blind `as Locale`.

**Why (documented — code comment at the call site, `app/(protected)/layout.tsx:11-13`):** "`navigation_item.item_translation` is keyed by the uppercase code that `SUPPORTED_LOCALES` already uses; a language with no content translations (a newly added one) falls back to `DEFAULT_LOCALE` inside the adapter." Two independent tables can drift: an admin can add a new UI language (say `de`) via `/admin/languages` at any time, with no obligation to also add `DE` content translations to every `navigation_item`. `SUPPORTED_LOCALES.includes(upper)` is the guard that catches that gap — `code.toUpperCase()` alone would silently produce a `Locale`-typed value (`'DE'`) that the sidebar adapter has no translation for, and an unchecked `as Locale` cast would hide that mismatch from TypeScript entirely. The `.includes()` check plus fallback means a brand-new UI language degrades to English navigation labels instead of `undefined` or a runtime crash in `mapNavigationToSidebar`.

A second mapping table (UI language code → content locale) was deliberately not introduced: the two code spaces already agree except for case, so a one-line transform at the single call site that needs the bridge is simpler than a table that would need its own seed, its own admin UI, and its own drift-detection.

## DEC-4 — Trigger-driven dictionary versioning

**Decision:** `app_language.dictionary_version` is a counter bumped by two Postgres triggers (`sources/devops/db/schema.sql:526-558`):

- `translation_value_bump_version` (row-level, `AFTER INSERT OR UPDATE OR DELETE` on `translation_value`) bumps only the affected language's row.
- `translation_key_bump_versions` (statement-level, same events on `translation_key`) bumps **every** language's row — a key's shape (its existence, namespace, or description) is not per-language, so any change to it can affect what every dictionary contains or how it's grouped.

`lib/i18n/dictionary-service.ts#getVersions()` polls this table on a 15-second TTL; a cache entry is stale exactly when its held version no longer matches the polled one, at which point the next `getDictionary()` call reloads from the DB and re-populates the cache.

**Why:** the alternative to a DB trigger is either (a) an in-app pub/sub — every server instance/pod would need to know about every other one, requiring new infrastructure this app has none of — or (b) requiring every write path to remember to call a cache-bust function. The trigger makes staleness detection **structural**: it is impossible to write a translation change through any path (a direct `psql` session, the `apply_translation_seed` seed function, a future write path nobody has thought of yet) without the version bumping, because the bump lives in the database, not in application code that could be forgotten. `invalidateDictionary()` (called by the admin actions after their own write) is purely a same-pod latency optimization — a "make my own change visible to myself without waiting" — not the correctness mechanism; correctness comes from the trigger plus the version poll.

**Known over-invalidation nuance:** the statement-level key trigger bumps *every* language's version on *any* key mutation, including ones that don't touch translated text at all — renaming a key's `namespace` for organizational purposes, or updating only its `description` (an admin-facing hint, never rendered to end users), still invalidates every cached dictionary for every language. This trades a small amount of unnecessary cache-reload work (a full dictionary reload is one indexed query over a few hundred rows) for one trigger function instead of column-level change detection inside the trigger body. Given how infrequently keys are edited (compared to how often `t()` runs), this is a deliberate simplicity-over-precision choice, not an oversight.

## DEC-5 — Drawer-based translations editor

**Decision:** `/admin/translations` renders one AG Grid row per key with a value column per active language, but editing opens a side drawer (`TranslationEditorDrawer.tsx`) rather than making the grid cells directly editable in place.

**Why (documented — code comment, `components/i18n/translations/TranslationEditorDrawer.tsx` design note referenced in the plan at `docs/superpowers/plans/2026-07-28-i18n-system.md:4120`):** "is already at its width budget, and §4.4 explicitly allows a drawer once it is." The grid already carries Chiave/Descrizione/Namespace/Modulo/Stato/Ultima modifica plus one column per active language — adding every language as an inline-editable multi-line text cell does not fit a data-grid row's height or width, especially as more languages are added (the grid must scale to an arbitrary number of active languages, not just the two seeded ones). A drawer gives every language's value its own full-height textarea, room for the conflict-resolution UI (DEC-6), and the key's metadata fields (namespace, module, description) in one coherent form, without constraining any of that to a grid cell's dimensions.

## DEC-6 — Optimistic locking on both key and value

**Decision:** `translation_key.version` and `translation_value.version` are two independent counters. `SaveTranslationsInput` (`lib/i18n/types.ts:110-118`) carries both a `keyVersion` (guarding namespace/module/description edits) and a per-language `version` inside each `values[]` entry (guarding that language's text). A save can succeed for some languages and conflict on others in the same request.

**Why:** a key's metadata and a language's translated text are edited independently in the UI (the drawer lets an admin change the English value without touching the description) and are edited by potentially different admins concurrently (one admin translating into French while another fixes the key's namespace). A single version field covering both would force every edit — text-only or metadata-only — to contend on the same counter, producing false-positive conflicts: two admins editing different languages of the same key would collide on a shared version even though their writes don't actually overlap. Two counters let `saveTranslations()` accept a metadata-unchanged, value-changed save from one admin and a value-in-a-different-language save from another without either being rejected as stale.

**Tied to Task 9's fix:** the first implementation compared versions in JavaScript after a plain `SELECT` (no row lock under READ COMMITTED) and then issued the `UPDATE`/`DELETE` keyed only by primary key — a genuine lost-update bug, since two concurrent requests could both pass the JS check before either write landed. The final implementation in `lib/i18n/translation-actions.ts` moves the version into the `UPDATE ... WHERE id = ... AND version = ...` predicate itself for **both** counters independently, so the database — not application-level JavaScript — is what actually enforces "you may only write if your version is still current." The real two-transaction interleavings are versioned in `lib/i18n/translation-actions.integration.test.ts`: one transaction's write blocks on the other's row lock, then re-evaluates its own `WHERE version = ...` against the committed row and correctly affects zero rows for both key and per-value versions.

## DEC-7 — Pino diagnostics instead of an audit table

**Decision:** Every admin i18n mutation (language create/update/activate/deactivate/delete/set-default, translation key create/delete, translation value save) emits a structured, best-effort diagnostic Pino event via `lib/i18n/audit.ts#auditI18n()`, tagged `module: 'i18n-audit'`, `audit: 'i18n'`. There is no new `i18n_audit_log` table and no completeness or compliance guarantee.

**Why:** This template has no durable audit subsystem for any administrative surface. Building one only for i18n would create misleading partial coverage. The diagnostic events retain useful actor/event/entity context, while the production operator owns stdout collection, access controls, alerting, retention, and periodic redaction tests. Because recording failures are swallowed after a mutation commits, these events must never be used as proof that every mutation was captured.

## DEC-8 — Rate limiting deliberately out of scope

**Decision:** No rate limiting is added to any i18n endpoint: the public bounded reads (`GET /api/i18n/dictionary`, `GET /api/i18n/languages`), the authenticated-user preference endpoint (`GET`/`PUT /api/i18n/preferences/language`), the admin-only grids (`POST /api/i18n/languages-grid`, `POST /api/i18n/translations-grid`), or the admin server actions.

**Why (documented in the plan's non-goals):** the two public endpoints expose only active-language metadata and dictionary text already intended for UI delivery; dictionary language codes are negotiated against active languages, namespaces are validated, and the response size is bounded by the finite catalogue. The preference route requires an authenticated user and accepts only an active language code through `setPreferredLanguage()`. Grid routes require an admin session and cap page size at 200; admin translation writes are additionally bounded by `MAX_BULK_VALUES` and `MAX_VALUE_LENGTH` (`lib/i18n/types.ts`). Adding rate limiting would introduce a token-bucket/Redis-style subsystem that the repository does not otherwise have. The absence of rate limiting remains an explicit accepted abuse-resilience trade-off, not a consequence of every endpoint being admin-only.

## Residual limitations

The final hardcoded-label scan still reports matches in 15 TSX files, but manual inspection classifies all of them as non-copy false positives: TypeScript generic syntax, JSX ternaries, technical format examples such as `it-IT` and `common.actions.save`, the `Construct` product name, a phone-number example, and the password mask. No untranslated user-facing prose was found by the prescribed scan.

The remaining intentional trade-offs are architectural rather than incomplete implementation: the render path loads the complete per-language dictionary instead of splitting it by namespace; translation-key metadata edits coarsely invalidate every language cache; and navigation-item content translations remain a separate uppercase-locale system bridged with a checked fallback. These limits are documented in DEC-3, DEC-4, and the plan's progressive-loading note.

---

## Cross-references

- Plan: `docs/superpowers/plans/2026-07-28-i18n-system.md`
- Task breakdown and implementation notes: `docs/superpowers/plans/2026-07-28-i18n-system.md`
- Task 9's optimistic-locking implementation (DEC-6 detail): `sources/microservices/web-construct/lib/i18n/translation-actions.ts`
- Task 16's DB-level race tests (DEC-6 detail): `sources/microservices/web-construct/lib/i18n/translation-actions.integration.test.ts`
- Task 17's locale-tolerant login helper: `sources/tests/e2e/helpers.py#do_test_login`
- Deliberate non-goals not covered above (rich-text translations, `navigation_item` content translation scope, search debounce, CSRF): `docs/superpowers/plans/2026-07-28-i18n-system.md`, "Deliberate non-goals" section
- Progressive-loading note (dictionary loaded whole vs. namespace-scoped): `docs/superpowers/plans/2026-07-28-i18n-system.md`, "Progressive-loading note" section
