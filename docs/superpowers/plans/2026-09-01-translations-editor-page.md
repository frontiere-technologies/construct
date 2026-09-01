# Translations Editor as a Full Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the translations side panel and the "Nuova chiave" dialog with two real routes rendering one shared form, so editing a translation key works like editing a Funzionalità.

**Architecture:** One client component, `TranslationKeyForm`, with a `mode: 'create' | 'edit'` prop, mirroring `FunctionalityForm`. Two server pages under `admin/translations/` load its data. The grid's Modifica action and "Nuova chiave" button become navigations that carry the list's query string in a `from` parameter, so filters and sort survive the round trip. `TranslationEditorDrawer` and `CreateTranslationKeyModal` are deleted.

**Tech Stack:** React 19 + TypeScript, Next.js 16 App Router, Tailwind CSS v4, Drizzle ORM on Postgres, Vitest + jsdom (`react-dom/client` + `act`, no Testing Library — this repo drives the DOM directly), Playwright/pytest for E2E.

Spec: `docs/superpowers/specs/2026-09-01-translations-editor-page-design.md`

## Global Constraints

- **All `npm` commands run from `sources/microservices/web-construct/`.** `uv run pytest` runs from the repository root.
- **Named exports only** under `{components,context,guards,lib,types}/**`: `import-x/no-default-export` is an error there. `app/**` is exempt because Next requires a default export for `page`, `layout`, `route`, `error` and `loading`. The 27-file exception list in `eslint.config.mjs` is documented as "fatta per accorciarsi, non per restare" — never add to it.
- **Every key-shaped string literal** in `app/`, `components/`, `lib/`, `context/` must be seeded by a SQL migration, or `npm run test:i18n-keys` fails hard. This plan adds exactly two keys, in Task 3, which runs before any code references them.
- **A migration is never edited once written.** New behaviour is a new numbered file, and its body is appended verbatim to `sources/devops/db/schema.sql` under a `-- Migration: NNNN_name.sql` header. Rewriting an applied migration breaks its checksum on every database that ran it.
- **Style vocabulary is shadcn tokens only.** No `--theme-*` names, no raw colour literals. `npm run test:raw-colors` and `npm run test:tokens` enforce it.
- **`components/ui/` is reserved for shadcn stock primitives.** New components go in `components/i18n/` or `components/shared/`. Buttons come from `@/components/ui/button`, text fields from `@/components/ui/input`, multi-line from `@/components/ui/textarea`.
- **Tests live beside the code** as `*.test.ts(x)`; `npm run test:collection` guards that every one is collected.
- **Before every commit:** `npm run lint -- --max-warnings=0` and `npm run typecheck`, both clean, plus `npm test`.
- **Do not touch** `createTranslationKey` or `saveTranslations` in `lib/i18n/translation-actions.ts`. They are called differently by this work, never modified: they are covered by optimistic-locking integration tests that this plan must leave passing untouched.

---

### Task 1: A single-key reader in the translation service

`lib/i18n/translation-service.ts` can only list. The edit page needs one key by
id. The row-shaping step is extracted rather than copied, because two details of
it are load-bearing and quiet: value buckets are `Object.create(null)` and
lookups use `Object.hasOwn`, both so that a database-sourced language code like
`constructor` or `__proto__` reads as "no translation" instead of resolving to an
inherited `Object.prototype` member. A copy is where that care goes to die.

**Files:**
- Modify: `sources/microservices/web-construct/lib/i18n/translation-service.ts` (extract from `listTranslations`, lines 107-189; add the new reader)
- Test: `sources/microservices/web-construct/lib/i18n/translation-service.test.ts` (modify — it already holds 14 tests for `applyTranslationFilters` and `translationOrderBy`; append, never overwrite)

**Interfaces:**
- Consumes: `db`, `translationKey`, `translationValue`, `appLanguage` (already imported in the file); `listActiveLanguages` from `./language-service`; `TranslationRowDto`, `TranslationValueDto` from `./types`.
- Produces:
  ```ts
  /** Structural shapes, not Drizzle's inferred row types, so the builder is testable without a database. */
  export interface TranslationKeyRowInput {
    idTranslationKey: number | string
    key: string
    description: string | null
    namespace: string
    module: string | null
    version: number
    updatedAt?: string | null
  }
  export interface TranslationValueRowInput {
    id: number | string
    keyId: number | string
    code: string
    value: string
    version: number
  }
  export function buildTranslationRows(
    keyRows: TranslationKeyRowInput[],
    valueRows: TranslationValueRowInput[],
    languages: { code: string }[],
  ): TranslationRowDto[]

  export async function getTranslationKeyRow(id: number): Promise<TranslationRowDto | null>
  ```

- [✅] **Step 1: Write the failing test**

Append to the existing `sources/microservices/web-construct/lib/i18n/translation-service.test.ts` — it already contains two describe blocks that must survive untouched:

```ts
import { describe, expect, it } from 'vitest'
import { buildTranslationRows } from './translation-service'

const key = {
  idTranslationKey: 7, key: 'auth.login.title', description: 'Login card title',
  namespace: 'auth', module: 'core', version: 3, updatedAt: '2026-09-01T10:00:00Z',
}

describe('buildTranslationRows', () => {
  it('groups each key with its own values and reports the untranslated languages', () => {
    const [row] = buildTranslationRows(
      [key],
      [
        { id: 11, keyId: 7, code: 'it', value: 'Accedi', version: 2 },
        // A value belonging to another key must not leak into this row.
        { id: 12, keyId: 8, code: 'en', value: 'Sign in', version: 1 },
      ],
      [{ code: 'it' }, { code: 'en' }],
    )

    expect(row.id).toBe(7)
    expect(row.key).toBe('auth.login.title')
    expect(row.version).toBe(3)
    expect(row.values.it).toEqual({ id: 11, value: 'Accedi', version: 2 })
    expect(row.values.en).toBeUndefined()
    expect(row.missingCodes).toEqual(['en'])
  })

  it('counts a present-but-empty value as missing', () => {
    const [row] = buildTranslationRows(
      [key],
      [{ id: 11, keyId: 7, code: 'it', value: '', version: 2 }],
      [{ code: 'it' }],
    )
    expect(row.missingCodes).toEqual(['it'])
  })

  // The reason the buckets are Object.create(null) rather than {}. Language
  // codes come from the database, so a code named after an Object.prototype
  // member must read as "no translation", not as an inherited function.
  it('treats a prototype-shaped language code as untranslated, not as an inherited member', () => {
    const [row] = buildTranslationRows([key], [], [{ code: 'constructor' }, { code: '__proto__' }])

    expect(row.missingCodes).toEqual(['constructor', '__proto__'])
    expect(Object.hasOwn(row.values, 'constructor')).toBe(false)
    expect(row.values.constructor as unknown).toBeUndefined()
  })

  it('keeps a prototype-shaped code that really has a value', () => {
    const [row] = buildTranslationRows(
      [key],
      [{ id: 11, keyId: 7, code: 'constructor', value: 'Costruttore', version: 1 }],
      [{ code: 'constructor' }],
    )
    expect(row.values.constructor).toEqual({ id: 11, value: 'Costruttore', version: 1 })
    expect(row.missingCodes).toEqual([])
  })

  it('accepts the string ids the postgres driver returns for bigint columns', () => {
    const [row] = buildTranslationRows(
      [{ ...key, idTranslationKey: '7' }],
      [{ id: '11', keyId: '7', code: 'it', value: 'Accedi', version: 2 }],
      [{ code: 'it' }],
    )
    expect(row.id).toBe(7)
    expect(row.values.it.id).toBe(11)
  })
})
```

- [✅] **Step 2: Run the test and confirm it fails**

Run: `npm test -- lib/i18n/translation-service.test.ts`
Expected: FAIL — `buildTranslationRows` is not exported from `./translation-service`.

- [✅] **Step 3: Extract the builder**

In `lib/i18n/translation-service.ts`, add the two input interfaces and the
builder above `listTranslations`:

```ts
/**
 * Structural row shapes rather than Drizzle's inferred types, so the builder can
 * be unit-tested without a database. A Drizzle select row is assignable to them.
 */
export interface TranslationKeyRowInput {
  idTranslationKey: number | string
  key: string
  description: string | null
  namespace: string
  module: string | null
  version: number
  updatedAt?: string | null
}

export interface TranslationValueRowInput {
  id: number | string
  keyId: number | string
  code: string
  value: string
  version: number
}

/**
 * Shape key rows plus their value rows into DTOs. Shared by `listTranslations`
 * and `getTranslationKeyRow` rather than copied into each: the prototype
 * hygiene below is exactly the kind of detail a second copy loses.
 *
 * Every bucket is created with `Object.create(null)`, not a `{}` literal:
 * `row.code` is DB-sourced, so a bare object would let a code like `__proto__`
 * or `constructor` resolve to an inherited `Object.prototype` member instead of
 * being treated as a missing/present language entry.
 */
export function buildTranslationRows(
  keyRows: TranslationKeyRowInput[],
  valueRows: TranslationValueRowInput[],
  languages: { code: string }[],
): TranslationRowDto[] {
  const byKey = new Map<number, Record<string, TranslationValueDto>>()
  for (const row of valueRows) {
    const keyId = Number(row.keyId)
    let bucket = byKey.get(keyId)
    if (!bucket) {
      bucket = Object.create(null) as Record<string, TranslationValueDto>
      byKey.set(keyId, bucket)
    }
    bucket[row.code] = { id: Number(row.id), value: row.value, version: row.version }
  }

  return keyRows.map(row => {
    const id = Number(row.idTranslationKey)
    // Same rationale as the populated buckets above: a prototype-ful `{}`
    // fallback would let a code like `constructor` resolve to
    // Object.prototype instead of "missing" when `missingCodes` indexes it.
    const values = byKey.get(id) ?? (Object.create(null) as Record<string, TranslationValueDto>)
    return {
      id,
      key: row.key,
      description: row.description,
      namespace: row.namespace,
      module: row.module,
      version: row.version,
      updatedAt: row.updatedAt ?? null,
      values,
      missingCodes: languages.filter(l => !values[l.code]?.value).map(l => l.code),
    }
  })
}
```

Then replace the tail of `listTranslations` — from `const byKey = new Map...`
down to `return { total, elements }` — with:

```ts
  return { total, elements: buildTranslationRows(keyRows, valueRows, languages) }
```

Note `TranslationValueDto` must be in the file's import from `./types`; add it
if it is not already there.

- [✅] **Step 4: Run the test and confirm it passes**

Run: `npm test -- lib/i18n/translation-service.test.ts`
Expected: PASS, 5 tests.

- [✅] **Step 5: Add the single-key reader**

Append to `lib/i18n/translation-service.ts`:

```ts
/**
 * One key with every language's value, for the edit page. Returns `null` for an
 * unknown id so the caller can answer `notFound()` rather than throwing.
 *
 * Not wrapped in `cache()` like `listNamespaces`/`listModules`: this is the
 * exact row the optimistic-locking check compares versions against, and a
 * request-scoped cache is one more place a stale `version` could come from.
 */
export async function getTranslationKeyRow(id: number): Promise<TranslationRowDto | null> {
  if (!Number.isInteger(id) || id <= 0) return null
  const languages = await listActiveLanguages()

  const [keyRow] = await db.select().from(translationKey)
    .where(eq(translationKey.idTranslationKey, id)).limit(1)
  if (!keyRow) return null

  const valueRows = await db
    .select({
      id: translationValue.idTranslationValue,
      keyId: translationValue.idTranslationKey,
      code: appLanguage.code,
      value: translationValue.value,
      version: translationValue.version,
    })
    .from(translationValue)
    .innerJoin(appLanguage, eq(appLanguage.idLanguage, translationValue.idLanguage))
    .where(eq(translationValue.idTranslationKey, id))

  return buildTranslationRows([keyRow], valueRows, languages)[0] ?? null
}
```

- [✅] **Step 6: Verify the suite, the lint and the types**

Run: `npm test && npm run lint -- --max-warnings=0 && npm run typecheck`
Expected: all clean. `listTranslations`'s existing integration tests must still
pass — the extraction is behaviour-preserving.

- [✅] **Step 7: Commit**

```bash
git add sources/microservices/web-construct/lib/i18n/translation-service.ts sources/microservices/web-construct/lib/i18n/translation-service.test.ts
git commit -m "feat(i18n): leggere una singola chiave di traduzione, senza ricopiare la cura sui prototipi"
```

---

### Task 2: The return URL, safe by construction

The grid's state lives in its query string. A page that returned to a bare
`/admin/translations` would throw away the filters the panel never lost. The
`from` parameter carries that query — and only that query: the destination path
is a constant in code, so no value of `from` can redirect anywhere else. That is
why this module never validates or sanitises `from`; there is nothing to
sanitise when the path is not taken from input.

**Files:**
- Create: `sources/microservices/web-construct/lib/i18n/translations-return-url.ts`
- Test: `sources/microservices/web-construct/lib/i18n/translations-return-url.test.ts`

**Interfaces:**
- Consumes: nothing. Pure string handling, no imports.
- Produces:
  ```ts
  export const TRANSLATIONS_LIST_PATH = '/admin/translations'
  export function translationsListHref(from: string | null | undefined): string
  export function translationEditHref(keyId: number, listSearch: string): string
  export function translationCreateHref(listSearch: string): string
  ```

- [✅] **Step 1: Write the failing test**

Create `sources/microservices/web-construct/lib/i18n/translations-return-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  translationCreateHref, translationEditHref, translationsListHref,
} from './translations-return-url'

describe('translationsListHref', () => {
  it('falls back to the bare list when there is nothing to restore', () => {
    expect(translationsListHref(undefined)).toBe('/admin/translations')
    expect(translationsListHref(null)).toBe('/admin/translations')
    expect(translationsListHref('')).toBe('/admin/translations')
  })

  it('restores the grid query it was given', () => {
    expect(translationsListHref('sort=namespace&direction=ASC'))
      .toBe('/admin/translations?sort=namespace&direction=ASC')
  })

  it('tolerates a leading question mark', () => {
    expect(translationsListHref('?sort=key')).toBe('/admin/translations?sort=key')
  })

  // The path is a constant in the module, never taken from `from`, so a hostile
  // value cannot move the destination — it can only become a useless parameter.
  it('cannot be pushed off the translations route', () => {
    for (const hostile of [
      'https://evil.example/steal',
      '//evil.example',
      '/admin/languages',
      '../../etc/passwd',
      'javascript:alert(1)',
    ]) {
      expect(translationsListHref(hostile).startsWith('/admin/translations')).toBe(true)
    }
  })

  it('keeps a filter value that itself contains a URL', () => {
    const search = new URLSearchParams({ value_it: 'https://www.lescienze.it/' }).toString()
    const restored = translationsListHref(search)
    expect(restored.startsWith('/admin/translations?')).toBe(true)
    const back = new URLSearchParams(restored.split('?')[1])
    expect(back.get('value_it')).toBe('https://www.lescienze.it/')
  })
})

describe('the hrefs the grid navigates to', () => {
  it('points at the edit page and carries the list query in one round trip', () => {
    const search = 'sort=namespace&direction=ASC&namespace=auth'
    const href = translationEditHref(42, search)

    expect(href.startsWith('/admin/translations/42/edit?')).toBe(true)
    const from = new URLSearchParams(href.split('?')[1]).get('from')
    expect(translationsListHref(from)).toBe(`/admin/translations?${search}`)
  })

  it('omits the parameter entirely when the list has no state', () => {
    expect(translationEditHref(42, '')).toBe('/admin/translations/42/edit')
    expect(translationCreateHref('')).toBe('/admin/translations/create')
  })

  it('points at the create page and carries the list query', () => {
    const href = translationCreateHref('sort=key')
    const from = new URLSearchParams(href.split('?')[1]).get('from')
    expect(translationsListHref(from)).toBe('/admin/translations?sort=key')
  })
})
```

- [✅] **Step 2: Run the test and confirm it fails**

Run: `npm test -- lib/i18n/translations-return-url.test.ts`
Expected: FAIL — the module does not exist.

- [✅] **Step 3: Write the module**

Create `sources/microservices/web-construct/lib/i18n/translations-return-url.ts`:

```ts
/**
 * Navigating between the translations grid and its form.
 *
 * The grid keeps sort and every column filter in its query string. The panel
 * this form replaced never left the list, so that state was never lost; a page
 * that came back to a bare list would be a regression for anyone working
 * through many keys. So the query travels along, in a `from` parameter.
 *
 * `from` holds a **query string only** — never a path, never an absolute URL.
 * The destination below is a module constant, so an open redirect is impossible
 * by construction instead of by validation: a hostile `from` can at worst
 * become a meaningless query parameter on the translations list itself. That is
 * why nothing here inspects or rejects the value.
 */
export const TRANSLATIONS_LIST_PATH = '/admin/translations'

/** The list URL to return to. Anything unusable yields the unfiltered list. */
export function translationsListHref(from: string | null | undefined): string {
  // URLSearchParams strips a single leading '?' itself, and re-encodes whatever
  // it parsed — so a filter value containing slashes or a colon survives.
  const query = new URLSearchParams(from ?? '').toString()
  return query ? `${TRANSLATIONS_LIST_PATH}?${query}` : TRANSLATIONS_LIST_PATH
}

function withFrom(path: string, listSearch: string): string {
  const from = new URLSearchParams(listSearch).toString()
  return from ? `${path}?${new URLSearchParams({ from }).toString()}` : path
}

export function translationEditHref(keyId: number, listSearch: string): string {
  return withFrom(`${TRANSLATIONS_LIST_PATH}/${keyId}/edit`, listSearch)
}

export function translationCreateHref(listSearch: string): string {
  return withFrom(`${TRANSLATIONS_LIST_PATH}/create`, listSearch)
}
```

- [✅] **Step 4: Run the test and confirm it passes**

Run: `npm test -- lib/i18n/translations-return-url.test.ts`
Expected: PASS, 8 tests.

- [✅] **Step 5: Lint, types, commit**

```bash
npm run lint -- --max-warnings=0 && npm run typecheck
git add sources/microservices/web-construct/lib/i18n/translations-return-url.ts sources/microservices/web-construct/lib/i18n/translations-return-url.test.ts
git commit -m "feat(i18n): filtri e ordinamento della griglia sopravvivono al giro sulla form"
```

---

### Task 3: Seed the two new labels

The form needs two headings that do not exist in the catalogue.
`sources/devops/i18n-key-inventory.test.mjs` fails hard on a `t()` call whose key
no migration seeds, because at runtime the label degrades to the key itself and
the administrator reads `translation.form.general_info` on screen. Seeding first
is safe in the other direction: a seeded-but-unreferenced key is a report, not a
failure.

**Files:**
- Create: `sources/devops/db/migrations/0013_translation_form_page_labels.sql`
- Modify: `sources/devops/db/schema.sql` (append the same block at the end)

**Interfaces:**
- Consumes: `public.apply_translation_seed(jsonb)`, already defined in the baseline.
- Produces: the keys `translation.form.general_info` and `translation.form.create_label`, both `namespace: translation`, `module: i18n`, matching every other `translation.*` key.

- [✅] **Step 1: Write the migration**

Create `sources/devops/db/migrations/0013_translation_form_page_labels.sql`:

```sql
-- La modifica di una traduzione era un pannello laterale montato dallo stato
-- della griglia, e la creazione una finestra modale separata. Ora sono due
-- pagine vere, /admin/translations/create e /admin/translations/[keyId]/edit,
-- come Funzionalita' e come Ruoli & permessi: in questa applicazione le
-- finestre modali sono riservate alle azioni brevi, non all'editor principale
-- di una pagina.
--
-- Quelle due pagine hanno intestazioni che il catalogo non aveva: il titolo
-- della colonna di sinistra, e il titolo della pagina in creazione. Senza
-- semina, sources/devops/i18n-key-inventory.test.mjs fallisce e a schermo
-- l'amministratore leggerebbe la chiave al posto dell'etichetta.
--
-- Additiva, come ogni semina: apply_translation_seed inserisce on conflict do
-- nothing, quindi rieseguirla non cambia nulla.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"translation.form.general_info","namespace":"translation","module":"i18n","description":"Left-column heading on the translation key form","it":"Informazioni generali","en":"General information"},
    {"key":"translation.form.create_label","namespace":"translation","module":"i18n","description":"Page title suffix when creating a translation key","it":"Nuova chiave","en":"New key"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
```

- [✅] **Step 2: Append the same block to the consolidated schema**

Append to the end of `sources/devops/db/schema.sql`, preserving the convention
of naming the migration in the header comment:

```sql

-- Migration: 0013_translation_form_page_labels.sql
-- Le due intestazioni delle pagine di creazione e modifica di una chiave di
-- traduzione, che hanno sostituito il pannello laterale e la finestra modale.
--
-- Additiva, come ogni semina: apply_translation_seed inserisce on conflict do
-- nothing, quindi rieseguirla non cambia nulla.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"translation.form.general_info","namespace":"translation","module":"i18n","description":"Left-column heading on the translation key form","it":"Informazioni generali","en":"General information"},
    {"key":"translation.form.create_label","namespace":"translation","module":"i18n","description":"Page title suffix when creating a translation key","it":"Nuova chiave","en":"New key"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
```

- [✅] **Step 3: Run the migration guards**

Run: `npm run test:migrations && npm run test:i18n-keys`
Expected: both PASS. The inventory guard will list the two keys as "seeded but
never referenced" — that is a report line, not a failure, and Task 4 resolves it.

- [ ] **Step 4: Hand the migration to the operator — you cannot apply it**  ← OUTSTANDING: the operator must run it

The subcommand is `apply`, not `migrate`, and it needs `MIGRATION_DATABASE_URL`,
which is deliberately absent from the repository and from every `.env*` file:
per the README it is operator-side only, exported by hand. Do not go looking for
it, do not write it into an env file, and do not run SQL against the database by
hand. Report that this step is the operator's:

```bash
export MIGRATION_DATABASE_URL='postgresql://...operator-only...'
node sources/devops/db/db.mjs apply
```

Nothing in the automated gates depends on this having run —
`test:i18n-keys` compares source against the migration *files*, not the
database. Only the browser checks in Tasks 5 and 6 do: until the migration is
applied, the two new headings render as their raw keys.

- [✅] **Step 5: Commit**

```bash
git add sources/devops/db/migrations/0013_translation_form_page_labels.sql sources/devops/db/schema.sql
git commit -m "feat(i18n): seminare le etichette della form a pagina per le traduzioni"
```

---

### Task 4: The shared form

One component for both modes, as `FunctionalityForm` does. Two components would
duplicate the metadata column, the per-language column, and the version
bookkeeping — and the two modes differ in exactly three places, which is not
enough to justify a second file.

Where they differ, and why:

- **Chiave** is editable only when creating. The save path has no rename: nothing
  in `SaveTranslationsInput` carries a key.
- **Salva** is gated on dirtiness when editing — resaving an untouched key would
  only burn a version — and on validity alone when creating, where there is
  nothing to be dirty against.
- **Creating writes twice**: `createTranslationKey` takes metadata only, so the
  values follow in a `saveTranslations` call. If that second call fails, the
  component keeps the new key's id and a retry saves only the values, instead of
  trying to create the same key again and colliding with the unique constraint.

**Files:**
- Create: `sources/microservices/web-construct/components/i18n/translations/TranslationKeyForm.tsx`
- Test: `sources/microservices/web-construct/components/i18n/translations/TranslationKeyForm.test.tsx`

**Interfaces:**
- Consumes: `PageContainer` from `@/components/shared/PageContainer`; `EditableCombobox` from `@/components/shared/EditableCombobox`; `Button`, `Input`, `Textarea` from `@/components/ui/*`; `useI18n` from `@/context/I18nContext`; `createTranslationKey`, `saveTranslations` from `@/lib/i18n/translation-actions`; `isValidNamespace`, `isValidTranslationKey`, `namespaceOf` from `@/lib/i18n/key-format`; `MAX_VALUE_LENGTH`, `TranslationConflict`, `TranslationRowDto` from `@/lib/i18n/types`; `translationEditHref`, `translationsListHref` from `@/lib/i18n/translations-return-url` (Task 2).
- Produces:
  ```ts
  export interface TranslationKeyFormProps {
    mode: 'create' | 'edit'
    /** Edit mode only. Loaded server-side; carries the versions the save path compares against. */
    row?: TranslationRowDto
    /** Namespaces already in use, for the suggestions. Never restricts what may be typed. */
    namespaces: string[]
    modules: string[]
    /** The list's query string, restored on Annulla and after Salva. */
    from: string
  }
  export function TranslationKeyForm(props: TranslationKeyFormProps): React.JSX.Element
  ```

- [✅] **Step 1: Write the failing test**

Create `sources/microservices/web-construct/components/i18n/translations/TranslationKeyForm.test.tsx`:

```tsx
// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranslationRowDto } from '@/lib/i18n/types'
import { createTranslationKey, saveTranslations } from '@/lib/i18n/translation-actions'
import { TranslationKeyForm } from './TranslationKeyForm'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `vi.hoisted`, not a plain `const`: vi.mock factories are hoisted above the
// module's top-level statements, so a bare const would still be in its
// temporal dead zone when the factory runs.
const pushed = vi.hoisted(() => ({ hrefs: [] as string[] }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => { pushed.hrefs.push(href) } }),
}))

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    languages: [
      { id: 1, code: 'it', locale: 'it-IT', name: 'Italian', nativeName: 'Italiano', isActive: true, isDefault: true },
      { id: 2, code: 'en', locale: 'en-GB', name: 'English', nativeName: 'English', isActive: true, isDefault: false },
    ],
  }),
}))

vi.mock('@/lib/i18n/translation-actions', () => ({
  createTranslationKey: vi.fn(),
  saveTranslations: vi.fn(),
}))

const row = {
  id: 7, key: 'auth.login.title', namespace: 'auth', module: 'core',
  description: 'Login card title', version: 3, updatedAt: null,
  values: { it: { id: 11, value: 'Accedi', version: 2 } },
  missingCodes: ['en'],
} as unknown as TranslationRowDto

// A stored module of `null` starts the field empty, so focusing it lists every
// option unfiltered. With `namespaces` and `modules` holding disjoint values, a
// swap of the two props would show ['auth','nav'] here and fail loudly.
const rowWithNoModule = { ...row, id: 8, namespace: 'nav', module: null } as unknown as TranslationRowDto

let root: Root | undefined
let container: HTMLDivElement | undefined

function render(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(node))
}

function field<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`missing element: ${selector}`)
  return found
}

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    element.value = value
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)
  if (!found) throw new Error(`missing button: ${label}`)
  return found as HTMLButtonElement
}

beforeEach(() => {
  pushed.hrefs.length = 0
  vi.mocked(createTranslationKey).mockReset()
  vi.mocked(saveTranslations).mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

describe('TranslationKeyForm in edit mode', () => {
  it('shows the stored metadata and one value box per language', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth', 'nav']} modules={['core']} from="" />)

    expect(field<HTMLInputElement>('#tk-ns').value).toBe('auth')
    expect(field<HTMLInputElement>('#tk-mod').value).toBe('core')
    expect(field<HTMLTextAreaElement>('#tk-desc').value).toBe('Login card title')
    expect(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]').value).toBe('Accedi')
    expect(field<HTMLTextAreaElement>('[data-testid="translation-value-en"]').value).toBe('')
  })

  it('does not let the key be renamed, because the save path cannot rename it', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth']} modules={['core']} from="" />)
    expect(document.querySelector('#tk-key')).toBeNull()
    expect(container?.textContent).toContain('auth.login.title')
  })

  it('offers the existing namespaces without discarding the stored value', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth', 'nav']} modules={['core']} from="" />)
    const ns = field<HTMLInputElement>('#tk-ns')
    expect(ns.getAttribute('role')).toBe('combobox')
    act(() => ns.focus())
    // 'auth' is already in the field, so the list is filtered down to it.
    expect(Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent)).toEqual(['auth'])
  })

  it('offers the existing modules, not the namespaces, in the module field', () => {
    render(
      <TranslationKeyForm
        mode="edit" row={rowWithNoModule}
        namespaces={['auth', 'nav']} modules={['billing', 'docs']} from=""
      />,
    )
    const mod = field<HTMLInputElement>('#tk-mod')
    expect(mod.value).toBe('')
    act(() => mod.focus())
    expect(Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent)).toEqual(['billing', 'docs'])
  })

  it('keeps Salva disabled until something actually changes', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth']} modules={['core']} from="" />)
    expect(button('common.actions.save').disabled).toBe(true)

    type(field<HTMLTextAreaElement>('[data-testid="translation-value-en"]'), 'Sign in')
    expect(button('common.actions.save').disabled).toBe(false)
  })

  it('puts the server values back when Ripristina is pressed', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth']} modules={['core']} from="" />)
    expect(button('translation.actions.discard').disabled).toBe(true)

    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Entra')
    type(field<HTMLTextAreaElement>('#tk-desc'), 'Something else')
    expect(button('translation.actions.discard').disabled).toBe(false)

    act(() => button('translation.actions.discard').click())

    expect(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]').value).toBe('Accedi')
    expect(field<HTMLTextAreaElement>('#tk-desc').value).toBe('Login card title')
    expect(button('translation.actions.discard').disabled).toBe(true)
    expect(button('common.actions.save').disabled).toBe(true)
  })

  it('sends every language with the version it loaded, and returns to the filtered list', async () => {
    vi.mocked(saveTranslations).mockResolvedValue({ ok: true })
    render(
      <TranslationKeyForm
        mode="edit" row={row} namespaces={['auth']} modules={['core']}
        from="sort=namespace&direction=ASC"
      />,
    )

    type(field<HTMLTextAreaElement>('[data-testid="translation-value-en"]'), 'Sign in')
    await act(async () => { button('common.actions.save').click() })

    expect(vi.mocked(saveTranslations).mock.calls[0][0]).toEqual({
      keyId: 7, keyVersion: 3, description: 'Login card title',
      namespace: 'auth', module: 'core',
      values: [
        { languageCode: 'it', value: 'Accedi', version: 2 },
        // No row for English yet, so the save path is told to insert.
        { languageCode: 'en', value: 'Sign in', version: null },
      ],
    })
    expect(pushed.hrefs).toEqual(['/admin/translations?sort=namespace&direction=ASC'])
  })

  it('shows the conflict panel instead of navigating away when the save is refused', async () => {
    vi.mocked(saveTranslations).mockResolvedValue({
      ok: false,
      conflicts: [{ languageCode: 'it', currentValue: 'Vinta', attemptedValue: 'Persa' }],
    })
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Persa')
    await act(async () => { button('common.actions.save').click() })

    const panel = field('[data-testid="translation-conflict"]')
    expect(panel.textContent).toContain('Vinta')
    expect(pushed.hrefs).toEqual([])
  })

  it('returns to the filtered list on Annulla without saving', () => {
    render(<TranslationKeyForm mode="edit" row={row} namespaces={['auth']} modules={['core']} from="sort=key" />)
    act(() => button('common.actions.cancel').click())

    expect(vi.mocked(saveTranslations)).not.toHaveBeenCalled()
    expect(pushed.hrefs).toEqual(['/admin/translations?sort=key'])
  })
})

describe('TranslationKeyForm in create mode', () => {
  it('lets the namespace follow the key by convention until it is overridden', () => {
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    expect(field<HTMLInputElement>('#tk-ns').value).toBe('billing')

    type(field<HTMLInputElement>('#tk-ns'), 'accounting')
    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.subtitle')
    expect(field<HTMLInputElement>('#tk-ns').value).toBe('accounting')
  })

  it('gates Salva on a well-formed key and namespace, not on dirtiness', () => {
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)
    expect(button('common.actions.save').disabled).toBe(true)

    // Rejected by the same rules as validateKeyInput: a key needs a dot.
    type(field<HTMLInputElement>('#tk-key'), 'billing')
    expect(button('common.actions.save').disabled).toBe(true)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    expect(button('common.actions.save').disabled).toBe(false)
  })

  it('creates the key and then saves the values that were typed', async () => {
    vi.mocked(createTranslationKey).mockResolvedValue({ error: null, id: 99 })
    vi.mocked(saveTranslations).mockResolvedValue({ ok: true })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="sort=key" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Fattura')
    await act(async () => { button('common.actions.save').click() })

    expect(vi.mocked(createTranslationKey).mock.calls[0][0]).toEqual({
      key: 'billing.invoice.title', namespace: 'billing', module: null, description: null,
    })
    expect(vi.mocked(saveTranslations).mock.calls[0][0]).toEqual({
      keyId: 99, keyVersion: 1, description: null, namespace: 'billing', module: null,
      values: [
        { languageCode: 'it', value: 'Fattura', version: null },
        { languageCode: 'en', value: '', version: null },
      ],
    })
    expect(pushed.hrefs).toEqual(['/admin/translations?sort=key'])
  })

  it('skips the second call when no value was typed', async () => {
    vi.mocked(createTranslationKey).mockResolvedValue({ error: null, id: 99 })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    await act(async () => { button('common.actions.save').click() })

    expect(vi.mocked(saveTranslations)).not.toHaveBeenCalled()
    expect(pushed.hrefs).toEqual(['/admin/translations'])
  })

  it('does not create the key twice when only the values failed', async () => {
    vi.mocked(createTranslationKey).mockResolvedValue({ error: null, id: 99 })
    vi.mocked(saveTranslations).mockResolvedValue({ ok: false, error: 'boom' })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    type(field<HTMLTextAreaElement>('[data-testid="translation-value-it"]'), 'Fattura')
    await act(async () => { button('common.actions.save').click() })

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('boom')
    expect(pushed.hrefs).toEqual([])
    // The key now exists. A retry must save values only, or it would collide
    // with the unique constraint on `key` and report a misleading error.
    vi.mocked(saveTranslations).mockResolvedValue({ ok: true })
    await act(async () => { button('common.actions.save').click() })

    expect(vi.mocked(createTranslationKey)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(saveTranslations)).toHaveBeenCalledTimes(2)
    expect(pushed.hrefs).toEqual(['/admin/translations'])
  })

  it('reports a refused create and calls nothing else', async () => {
    vi.mocked(createTranslationKey).mockResolvedValue({ error: 'Esiste già una chiave con questo nome.' })
    render(<TranslationKeyForm mode="create" namespaces={['auth']} modules={['core']} from="" />)

    type(field<HTMLInputElement>('#tk-key'), 'billing.invoice.title')
    await act(async () => { button('common.actions.save').click() })

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Esiste già')
    expect(vi.mocked(saveTranslations)).not.toHaveBeenCalled()
    expect(pushed.hrefs).toEqual([])
  })
})
```

- [✅] **Step 2: Run the test and confirm it fails**

Run: `npm test -- components/i18n/translations/TranslationKeyForm.test.tsx`
Expected: FAIL — `./TranslationKeyForm` does not exist.

- [✅] **Step 3: Write the component**

Create `sources/microservices/web-construct/components/i18n/translations/TranslationKeyForm.tsx`:

```tsx
'use client'

import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageContainer } from '@/components/shared/PageContainer'
import { EditableCombobox } from '@/components/shared/EditableCombobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/context/I18nContext'
import { createTranslationKey, saveTranslations } from '@/lib/i18n/translation-actions'
import { isValidNamespace, isValidTranslationKey, namespaceOf } from '@/lib/i18n/key-format'
import { MAX_VALUE_LENGTH, type TranslationConflict, type TranslationRowDto } from '@/lib/i18n/types'
import { translationsListHref } from '@/lib/i18n/translations-return-url'

export interface TranslationKeyFormProps {
  mode: 'create' | 'edit'
  /** Edit mode only. Loaded server-side; carries the versions the save path compares against. */
  row?: TranslationRowDto
  /** Namespaces already in use, for the suggestions. Never restricts what may be typed. */
  namespaces: string[]
  modules: string[]
  /** The list's query string, restored on Annulla and after Salva. */
  from: string
}

/**
 * Creating and editing a translation key, as a page rather than a panel — the
 * same shape Funzionalità and Ruoli & permessi use for their own main entity.
 * A dialog in this application means a short secondary action (rename, confirm
 * a delete), which this is not.
 *
 * All languages for the key are edited and saved together, in one transaction,
 * each carrying the version it was loaded with so a concurrent edit is refused
 * rather than overwritten.
 */
export function TranslationKeyForm({ mode, row, namespaces, modules, from }: TranslationKeyFormProps) {
  const { t, languages } = useI18n()
  const router = useRouter()

  // `Object.hasOwn` guards the lookup: `row.values` is keyed by DB-sourced
  // language codes, so a plain `row.values[l.code]` risks resolving to an
  // inherited Object.prototype member for a code like `constructor` instead
  // of being treated as "no translation for this language".
  const initialValues = useMemo(
    () => Object.fromEntries(languages.map(l => [
      l.code,
      row && Object.hasOwn(row.values, l.code) ? row.values[l.code].value : '',
    ])),
    [languages, row],
  )

  const [key, setKey] = useState(row?.key ?? '')
  const [namespaceTouched, setNamespaceTouched] = useState(false)
  const [namespace, setNamespace] = useState(row?.namespace ?? '')
  const [moduleName, setModuleName] = useState(row?.module ?? '')
  const [description, setDescription] = useState(row?.description ?? '')
  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<TranslationConflict[] | null>(null)
  // Create mode only. Set once the key exists, so a retry after a failed value
  // save does not try to create it again and collide on the unique constraint.
  const [createdId, setCreatedId] = useState<number | null>(null)

  const listHref = translationsListHref(from)

  const dirty =
    description !== (row?.description ?? '') ||
    namespace !== (row?.namespace ?? '') ||
    moduleName !== (row?.module ?? '') ||
    languages.some(l => values[l.code] !== initialValues[l.code])

  // Mirrors `validateKeyInput` in translation-actions.ts, so the button is
  // disabled rather than the action returning a string the admin has to read.
  const metadataValid =
    isValidNamespace(namespace.trim()) &&
    (!moduleName.trim() || isValidNamespace(moduleName.trim())) &&
    (mode === 'edit' || isValidTranslationKey(key.trim()))

  // The one place the two modes genuinely diverge: there is nothing for a new
  // key to be dirty against, while resaving an untouched key only burns a version.
  const canSave = metadataValid && (mode === 'create' || dirty)

  // The namespace follows the key by convention until the admin overrides it.
  const handleKeyChange = (next: string) => {
    setKey(next)
    if (!namespaceTouched) setNamespace(next.includes('.') ? namespaceOf(next) : '')
  }

  const valuePayload = () => languages.map(l => ({
    languageCode: l.code,
    value: values[l.code] ?? '',
    version: row && Object.hasOwn(row.values, l.code) ? row.values[l.code].version : null,
  }))

  const metadata = {
    namespace: namespace.trim(),
    module: moduleName.trim() || null,
    description: description.trim() || null,
  }

  const saveValues = async (keyId: number, keyVersion: number) => {
    const result = await saveTranslations({ keyId, keyVersion, ...metadata, values: valuePayload() })
    if (result.ok) { router.push(listHref); return }
    if ('conflicts' in result) setConflicts(result.conflicts)
    else setError(result.error)
  }

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    setConflicts(null)
    try {
      if (mode === 'edit') {
        // The edit page always passes a row — it answers `notFound()` when the
        // key does not exist. A thrown invariant rather than a message on
        // screen: this is a wiring bug, not something an admin can act on, and
        // user-facing copy here would need a translation key of its own.
        if (!row) throw new Error('TranslationKeyForm: mode="edit" requires a row')
        await saveValues(row.id, row.version)
        return
      }

      let keyId = createdId
      if (keyId == null) {
        const created = await createTranslationKey({ key: key.trim(), ...metadata })
        if (created.error != null) { setError(created.error); return }
        // `KeyActionResult` is `{ error: string | null; id?: number }`, and the
        // action returns an id whenever `error` is null. Narrowed by an
        // invariant, for the same reason as above.
        if (created.id == null) throw new Error('createTranslationKey returned neither an error nor an id')
        keyId = created.id
        setCreatedId(keyId)
      }
      // Nothing typed: the key alone is a complete result, and this is exactly
      // what the dialog this form replaced produced every time.
      if (!languages.some(l => (values[l.code] ?? '').trim())) { router.push(listHref); return }
      // A brand-new key is at `version` 1 (`not null default 1` in schema.sql).
      await saveValues(keyId, 1)
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setValues(initialValues)
    setDescription(row?.description ?? '')
    setNamespace(row?.namespace ?? '')
    setModuleName(row?.module ?? '')
    setError(null)
    setConflicts(null)
  }

  const title = `${t('translation.title')} / ${
    mode === 'create' ? t('translation.form.create_label') : t('common.actions.edit')
  }`

  return (
    <PageContainer title={title} subtitle={t('translation.editor.title')}>
      <div data-testid="translation-editor" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-border-subtle p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('translation.form.general_info')}
          </h2>

          {/* `htmlFor` only where there is a field to point at: in edit mode the
              key is static text, and a label referencing a missing id is a
              dangling accessible name. */}
          {mode === 'create' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="tk-key">
                {t('translation.key')}
              </label>
              <Input
                id="tk-key" value={key} onChange={e => handleKeyChange(e.target.value)}
                placeholder="common.actions.save"
              />
            </div>
          ) : (
            <div>
              <p className="mb-1 text-sm font-medium text-foreground-secondary">{t('translation.key')}</p>
              {/* Read-only text, not a disabled input: the save path carries no
                  key, so renaming is not something the form could offer. */}
              <p className="font-mono text-sm break-all">{row?.key}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="tk-ns">
                {t('translation.namespace')}
              </label>
              <EditableCombobox
                id="tk-ns" value={namespace} options={namespaces} placeholder="common"
                onChange={next => { setNamespaceTouched(true); setNamespace(next) }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="tk-mod">
                {t('translation.module')} <span className="font-normal text-foreground-faint">{t('common.labels.optional')}</span>
              </label>
              <EditableCombobox id="tk-mod" value={moduleName} onChange={setModuleName} options={modules} placeholder="core" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground-secondary" htmlFor="tk-desc">
              {t('translation.description')}
            </label>
            <Textarea
              id="tk-desc" value={description} onChange={e => setDescription(e.target.value)}
              rows={2} className="min-h-[76px]"
            />
          </div>
        </div>

        <div className="rounded-xl border border-border-subtle p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('translation.value')}
          </h2>
          {/* An open list, not an accordion: a translation has one field per
              language, and collapsing would hide the "missing" chip, which is
              the one thing a translator is scanning for. */}
          <div className="space-y-3">
            {languages.map(language => (
              <div key={language.code}>
                <label
                  className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground-secondary"
                  htmlFor={`tk-v-${language.code}`}
                >
                  {language.nativeName}
                  {!values[language.code] && (
                    <span className="rounded-full bg-warning-muted px-2 py-0.5 text-xs text-warning-muted-foreground">
                      {t('translation.missing')}
                    </span>
                  )}
                </label>
                <Textarea
                  id={`tk-v-${language.code}`}
                  data-testid={`translation-value-${language.code}`}
                  value={values[language.code] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [language.code]: e.target.value }))}
                  rows={2} maxLength={MAX_VALUE_LENGTH} className="min-h-[64px]"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {conflicts && (
        <div role="alert" data-testid="translation-conflict" className="rounded-lg border border-warning-border bg-warning-muted p-4 text-sm">
          <p className="mb-2 font-semibold">{t('translation.conflict.title')}</p>
          <p className="mb-3 text-foreground-secondary">{t('translation.conflict.explanation')}</p>
          <ul className="space-y-2">
            {conflicts.map(conflict => (
              <li key={conflict.languageCode}>
                <p className="font-medium">{conflict.languageCode}</p>
                <p><span className="text-muted-foreground">{t('translation.conflict.current')}:</span> {conflict.currentValue || '—'}</p>
                <p><span className="text-muted-foreground">{t('translation.conflict.yours')}:</span> {conflict.attemptedValue || '—'}</p>
              </li>
            ))}
          </ul>
          <Button variant="outline" onClick={() => router.push(listHref)} className="mt-3">
            {t('translation.conflict.reload')}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <div>{error && <p role="alert" className="text-sm text-destructive-muted-foreground">{error}</p>}</div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={discard} disabled={!dirty || saving}>
            {t('translation.actions.discard')}
          </Button>
          <Button variant="outline" onClick={() => router.push(listHref)} disabled={saving}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={save} disabled={!canSave || saving}>
            {saving ? t('common.states.saving') : t('common.actions.save')}
          </Button>
        </div>
      </div>
    </PageContainer>
  )
}
```

- [✅] **Step 4: Run the test and confirm it passes**

Run: `npm test -- components/i18n/translations/TranslationKeyForm.test.tsx`
Expected: PASS, 15 tests.

The component references exactly two keys that did not exist before this work,
`translation.form.general_info` and `translation.form.create_label`, and Task 3
seeded both. Every other `t()` call here is a key the drawer or the dialog
already used. If you find yourself wanting a third — for an error message, a
placeholder, anything — stop: it needs a migration, and the two thrown
invariants above exist precisely so that no unreachable branch drags a
translation key into the catalogue behind you.

- [✅] **Step 5: Lint, types, full suite, commit**

```bash
npm run lint -- --max-warnings=0 && npm run typecheck && npm test && npm run test:i18n-keys
git add sources/microservices/web-construct/components/i18n/translations/TranslationKeyForm.tsx sources/microservices/web-construct/components/i18n/translations/TranslationKeyForm.test.tsx
git commit -m "feat(i18n): una sola form per creare e modificare una chiave di traduzione"
```

---

### Task 5: The two routes

Both sit under `app/(protected)/(admin)/`, whose layout already calls
`requireAdmin()`. Neither page repeats that check: duplicating a guard invites
the reader to wonder which one is load-bearing.

**Files:**
- Create: `sources/microservices/web-construct/app/(protected)/(admin)/admin/translations/create/page.tsx`
- Create: `sources/microservices/web-construct/app/(protected)/(admin)/admin/translations/[keyId]/edit/page.tsx`

**Interfaces:**
- Consumes: `getTranslationKeyRow`, `listNamespaces`, `listModules` from `@/lib/i18n/translation-service` (Task 1); `TranslationKeyForm` from `@/components/i18n/translations/TranslationKeyForm` (Task 4); `notFound` from `next/navigation`.
- Produces: the routes `/admin/translations/create` and `/admin/translations/[keyId]/edit`, both reading `?from=`.

- [✅] **Step 1: Write the create page**

```tsx
import { listModules, listNamespaces } from '@/lib/i18n/translation-service'
import { TranslationKeyForm } from '@/components/i18n/translations/TranslationKeyForm'

export default async function CreateTranslationKeyPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> },
) {
  const [sp, namespaces, modules] = await Promise.all([searchParams, listNamespaces(), listModules()])
  return <TranslationKeyForm mode="create" namespaces={namespaces} modules={modules} from={sp.from ?? ''} />
}
```

- [✅] **Step 2: Write the edit page**

```tsx
import { notFound } from 'next/navigation'
import { getTranslationKeyRow, listModules, listNamespaces } from '@/lib/i18n/translation-service'
import { TranslationKeyForm } from '@/components/i18n/translations/TranslationKeyForm'

export default async function EditTranslationKeyPage(
  {
    params, searchParams,
  }: {
    params: Promise<{ keyId: string }>
    searchParams: Promise<Record<string, string | undefined>>
  },
) {
  const [{ keyId }, sp, namespaces, modules] = await Promise.all([
    params, searchParams, listNamespaces(), listModules(),
  ])
  // Loaded here, not passed from the grid, so the `version` the optimistic-lock
  // check compares against is read at the moment the form opens.
  const row = await getTranslationKeyRow(Number(keyId))
  if (!row) notFound()

  return (
    <TranslationKeyForm
      mode="edit" row={row} namespaces={namespaces} modules={modules} from={sp.from ?? ''}
    />
  )
}
```

- [✅] **Step 3: Check the routes render against a real database**

Do not use Bash to start a server. Open the preview with the Browser pane
(`preview_start` with the `web-construct` configuration), then navigate to
`/admin/translations`, pick any key's id from the grid, and visit
`/admin/translations/<id>/edit` and `/admin/translations/create`.

Expected: both render the two-column form; the edit page shows the stored
values; `/admin/translations/999999/edit` renders the not-found page.
Check `read_console_messages` and `preview_logs` for errors before moving on.

- [✅] **Step 4: Lint, types, commit**

```bash
npm run lint -- --max-warnings=0 && npm run typecheck && npm test
git add "sources/microservices/web-construct/app/(protected)/(admin)/admin/translations/create/page.tsx" "sources/microservices/web-construct/app/(protected)/(admin)/admin/translations/[keyId]/edit/page.tsx"
git commit -m "feat(i18n): due rotte vere per creare e modificare una traduzione"
```

---

### Task 6: The grid navigates, and the two shells go away

The Modifica action and the "Nuova chiave" button become navigations. With them,
`TranslationEditorDrawer` and `CreateTranslationKeyModal` lose their only caller
and are deleted — along with their two lines in the `import-x/no-default-export`
exception list, which the list's own comment asks you to remove when you touch a
file ("Quando ne converti uno, cancella la sua riga").

`TranslationsTableClient` is on that list too, and this task edits it anyway, so
convert it to a named export in the same pass and delete its line as well. Three
lines shorter is the whole point of the list.

Deletion keeps its `ConfirmModal`: a confirm is a short secondary action, which
is what dialogs are for here.

**Files:**
- Modify: `sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.tsx`
- Modify: `sources/microservices/web-construct/components/i18n/translations/TranslationsTableClient.test.tsx`
- Modify: `sources/microservices/web-construct/app/(protected)/(admin)/admin/translations/page.tsx` (import of the renamed export)
- Modify: `sources/microservices/web-construct/eslint.config.mjs` (remove three lines)
- Delete: `sources/microservices/web-construct/components/i18n/translations/TranslationEditorDrawer.tsx`
- Delete: `sources/microservices/web-construct/components/i18n/translations/TranslationEditorDrawer.test.tsx`
- Delete: `sources/microservices/web-construct/components/i18n/translations/CreateTranslationKeyModal.tsx`
- Delete: `sources/microservices/web-construct/components/i18n/translations/CreateTranslationKeyModal.test.tsx`

**Interfaces:**
- Consumes: `translationCreateHref`, `translationEditHref` from `@/lib/i18n/translations-return-url` (Task 2).
- Produces: `export function TranslationsTableClient(props: Props)` — a named export where a default one used to be.

- [✅] **Step 1: Write the failing test**

Add to `components/i18n/translations/TranslationsTableClient.test.tsx`. Note the
`next/navigation` mock at the top of the file must gain a `push` spy, and the
import must become `{ TranslationsTableClient }`:

```tsx
const pushed = vi.hoisted(() => ({ hrefs: [] as string[] }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: (href: string) => { pushed.hrefs.push(href) } }),
  usePathname: () => '/admin/translations',
  useSearchParams: () => new URLSearchParams('sort=key&direction=ASC'),
}))
```

```tsx
describe('TranslationsTableClient row actions', () => {
  beforeEach(() => { captured.columnDefs.length = 0; pushed.hrefs.length = 0 })

  it('sends Modifica to the edit page, carrying the grid query', () => {
    renderToStaticMarkup(<TranslationsTableClient urlParams={{}} namespaces={['common']} modules={[]} />)

    const actions = captured.columnDefs[0].find(column => column.colId === 'actions')
    const getItems = (actions?.cellRendererParams as { getItems: (row: TranslationRowDto) => { label: string; onClick: () => void }[] }).getItems
    const items = getItems({ id: 42 } as unknown as TranslationRowDto)

    items.find(item => item.label === 'common.actions.edit')?.onClick()

    expect(pushed.hrefs).toHaveLength(1)
    const from = new URLSearchParams(pushed.hrefs[0].split('?')[1]).get('from')
    expect(pushed.hrefs[0].startsWith('/admin/translations/42/edit?')).toBe(true)
    expect(new URLSearchParams(from ?? '').get('sort')).toBe('key')
    expect(new URLSearchParams(from ?? '').get('direction')).toBe('ASC')
  })

  it('leaves Elimina as an in-place action, not a navigation', () => {
    renderToStaticMarkup(<TranslationsTableClient urlParams={{}} namespaces={['common']} modules={[]} />)

    const actions = captured.columnDefs[0].find(column => column.colId === 'actions')
    const getItems = (actions?.cellRendererParams as { getItems: (row: TranslationRowDto) => { label: string; onClick: () => void }[] }).getItems
    getItems({ id: 42 } as unknown as TranslationRowDto).find(item => item.label === 'common.actions.delete')?.onClick()

    expect(pushed.hrefs).toEqual([])
  })
})
```

- [✅] **Step 2: Run the test and confirm it fails**

Run: `npm test -- components/i18n/translations/TranslationsTableClient.test.tsx`
Expected: FAIL — the import of `{ TranslationsTableClient }` is undefined, and
Modifica still sets state instead of navigating.

- [✅] **Step 3: Rewire the grid**

In `TranslationsTableClient.tsx`:

1. Replace the two imports
   ```ts
   import TranslationEditorDrawer from './TranslationEditorDrawer'
   import CreateTranslationKeyModal from './CreateTranslationKeyModal'
   ```
   with
   ```ts
   import { translationCreateHref, translationEditHref } from '@/lib/i18n/translations-return-url'
   ```

2. Delete the two state hooks:
   ```ts
   const [editing, setEditing] = useState<TranslationRowDto | null>(null)
   const [creating, setCreating] = useState(false)
   ```

3. In the actions column, replace the edit item's handler:
   ```ts
   { label: t('common.actions.edit'), onClick: () => router.push(translationEditHref(row.id, sp.toString())) },
   ```

4. Replace the toolbar button:
   ```tsx
   <Button size="sm" onClick={() => router.push(translationCreateHref(sp.toString()))}>
     {t('translation.actions.create')}
   </Button>
   ```

5. Delete the whole `{editing && (...)}` and `{creating && (...)}` blocks. Keep
   the `{deleting && (<ConfirmModal ... />)}` block untouched.

6. Change the declaration from `export default function TranslationsTableClient`
   to `export function TranslationsTableClient`.

If `useState` or `TranslationRowDto` become unused, remove them from the
imports — `npm run lint -- --max-warnings=0` will say so.

- [✅] **Step 4: Update the page's import**

In `app/(protected)/(admin)/admin/translations/page.tsx`:

```ts
import { TranslationsTableClient } from '@/components/i18n/translations/TranslationsTableClient'
```

- [✅] **Step 5: Delete the two shells and their tests**

```bash
git rm sources/microservices/web-construct/components/i18n/translations/TranslationEditorDrawer.tsx \
       sources/microservices/web-construct/components/i18n/translations/TranslationEditorDrawer.test.tsx \
       sources/microservices/web-construct/components/i18n/translations/CreateTranslationKeyModal.tsx \
       sources/microservices/web-construct/components/i18n/translations/CreateTranslationKeyModal.test.tsx
```

- [✅] **Step 6: Shrink the ESLint exception list by three lines**

In `eslint.config.mjs`, delete these three entries from the `files` array of the
`'import-x/no-default-export': 'off'` block:

```
      'components/i18n/translations/CreateTranslationKeyModal.tsx',
      'components/i18n/translations/TranslationEditorDrawer.tsx',
      'components/i18n/translations/TranslationsTableClient.tsx',
```

Also update the block's leading comment, which says "Questi 27 file": it is now
24. Leaving a stale count is how a comment stops being read.

- [✅] **Step 7: Confirm the whole suite, the lint and the types**

Run: `npm test && npm run lint -- --max-warnings=0 && npm run typecheck && npm run test:collection && npm run test:i18n-keys`
Expected: all clean. The i18n inventory guard should no longer report
`translation.form.general_info` or `translation.form.create_label` as unreferenced.

- [✅] **Step 8: Verify in the browser before claiming it works**

With the Browser pane: from `/admin/translations`, apply a namespace filter and
a sort, open a key with Modifica, change one language, press Salva. The grid must
come back **with the filter and sort still applied**. Then press "Nuova chiave",
confirm it navigates rather than opening a dialog. Take a screenshot of the
restored, still-filtered grid as the evidence.

- [✅] **Step 9: Commit**

```bash
git add -A sources/microservices/web-construct
git commit -m "refactor(i18n): la griglia naviga, il pannello e la finestra modale sono spariti"
```

---

### Task 7: The end-to-end tests

Six places in `sources/tests/e2e/test_i18n.py` reach the editor through
`[data-testid="translation-editor"]`. That test id lives on the form now, so the
locator survives; what changes is how the editor is reached and how "we are done"
is observed. Two of them also need more care:

- `_restore_save_translation` and the §18.1 test assert `expect(editor).to_be_hidden(...)`
  after saving. That still passes, because the navigation removes the element —
  but it passes for the wrong reason and would keep passing if the save silently
  failed and the form unmounted for any other cause. Assert the URL instead.
- `test_a_missing_english_translation_falls_back_to_italian` fills the create
  dialog through `page.get_by_role("dialog")`. There is no dialog any more.

**Files:**
- Modify: `sources/tests/e2e/test_i18n.py`

**Interfaces:**
- Consumes: the existing helpers `_open_translations`, `_filter_by_key`, `_rows`, `nav`, and the `logged_in_page` / `admin_storage_state` fixtures.
- Produces: no new helper is exported; one new local helper `_open_editor(page)` is used by the tests in this file.

- [✅] **Step 1: Add a helper that opens the editor and waits for the real signal**

Add near the other helpers in `test_i18n.py`:

```python
def _open_editor(page):
    """Open the first filtered row's editor and wait for the form, not the network.

    Waiting on `networkidle` would be waiting for the wrong thing: it reports
    that the browser stopped fetching, not that the form is mounted and
    populated. The editor's own test id is the real signal.
    """
    page.locator('[data-testid^="row-menu"]').first.click()
    page.get_by_role("button", name="Modifica").or_(
        page.get_by_role("button", name="Edit")).click()
    page.wait_for_url(re.compile(r"/admin/translations/\d+/edit"), timeout=15_000)
    editor = page.locator('[data-testid="translation-editor"]')
    expect(editor).to_be_visible(timeout=15_000)
    return editor


def _expect_back_on_the_list(page, base_url):
    """The save landed and returned. Asserting the URL, not the editor's absence:
    an unmounted form proves nothing about whether the write succeeded."""
    page.wait_for_url(re.compile(rf"{re.escape(base_url)}/admin/translations(\?.*)?$"), timeout=15_000)
```

Add `import re` at the top of the file if it is not already imported.

- [✅] **Step 2: Rewrite the six call sites**

In `_restore_save_translation`, replace the block from
`_rows(page).first.locator(...)` through `expect(editor).to_be_hidden(...)` with:

```python
        editor = _open_editor(page)
        editor.locator('[data-testid="translation-value-en"]').fill("Save")
        save_btn = editor.get_by_role("button", name="Salva").or_(
            editor.get_by_role("button", name="Save"))
        save_btn.click()
        _expect_back_on_the_list(page, base_url)
```

In `test_admin_edits_a_translation_and_the_user_sees_it`, replace the row-menu
click, the Modifica click, and the editor/hidden assertions with:

```python
        editor = _open_editor(page)
        editor.locator('[data-testid="translation-value-en"]').fill(marker)
        editor.get_by_role("button", name="Salva").click()
        _expect_back_on_the_list(page, base_url)
```

In `test_a_missing_english_translation_falls_back_to_italian`, replace the create
block:

```python
        page.get_by_role("button", name="Nuova chiave").click()
        page.wait_for_url(re.compile(r"/admin/translations/create"), timeout=15_000)
        form = page.locator('[data-testid="translation-editor"]')
        expect(form).to_be_visible(timeout=15_000)
        form.get_by_label("Chiave").fill(key)
        # The namespace follows the key by convention; set it explicitly anyway,
        # so the test does not silently depend on that behaviour.
        form.get_by_label("Namespace").fill("zzz_e2e")
        form.locator('[data-testid="translation-value-it"]').fill("Valore italiano")
        # English intentionally left empty.
        page.get_by_role("button", name="Salva").click()
        _expect_back_on_the_list(page, base_url)
```

and delete the now-redundant second visit to the editor (the `_filter_by_key` →
row-menu → Modifica → fill Italian → Salva sequence that followed it): the
create page writes the Italian value in one pass. Keep the two assertions that
follow — the grid showing "Mancante" and the dictionary API check.

In `_delete_translation_key`, nothing changes: it uses the row menu's Elimina,
which is still a `ConfirmModal`.

In `test_concurrent_edits_are_detected_instead_of_overwritten`, replace the
per-page loop body and the two `editor_*` lookups:

```python
        for page in (page_a, page_b):
            _open_translations(page, base_url)
            _filter_by_key(page, "common.actions.save")
            _open_editor(page)

        editor_a = page_a.locator('[data-testid="translation-editor"]')
        editor_a.locator('[data-testid="translation-value-en"]').fill(winner)
        editor_a.get_by_role("button", name="Salva").click()
        _expect_back_on_the_list(page_a, base_url)

        editor_b = page_b.locator('[data-testid="translation-editor"]')
        editor_b.locator('[data-testid="translation-value-en"]').fill("Loser")
        editor_b.get_by_role("button", name="Salva").click()
```

The rest of that test is unchanged and still proves what it claims: both pages
load the row — and therefore its `version` — before A saves, so B's save carries
a stale version and must be refused. Page B stays on its edit page and renders
the conflict panel.

- [✅] **Step 3: Run the i18n end-to-end group**

Run: `uv run pytest sources/tests/e2e/test_i18n.py -v` from the repository root.
Expected: every test passes. If a test leaves `common.actions.save` holding a
marker value, the module-level safety net restores it — but a failure there
cascades into unrelated groups, so re-run the full suite before committing.

- [✅] **Step 4: Run the whole end-to-end suite**

Run: `uv run pytest`
Expected: no regressions. `test_functionalities.py` also matches on
"translations" and must be unaffected; if it fails, read it before changing
anything — it may be asserting on the navigation tree, not on this form.

- [✅] **Step 5: Commit**

```bash
git add sources/tests/e2e/test_i18n.py
git commit -m "test(i18n): l'editor si raggiunge per URL, e il ritorno si verifica sull'URL non sull'assenza"
```

---

### Task 8: Tell the design record what changed

DEC-5 of the i18n design document currently describes the drawer as the chosen
design, citing a code comment in a file that no longer exists. Left alone, the
next reader finds a spec contradicting the code and has to guess which is true.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-28-i18n-system-design.md` (DEC-5 only)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Documentation only.

- [✅] **Step 1: Rewrite DEC-5**

Replace the DEC-5 section — its heading, `**Decision:**` and `**Why...**`
paragraphs — with:

```markdown
## DEC-5 — Superseded: the translations editor is a page, not a drawer

**Decision (2026-09-01):** `/admin/translations` still renders one AG Grid row
per key with a value column per active language, but editing and creating a key
are two routes — `/admin/translations/[keyId]/edit` and
`/admin/translations/create` — rendering one `TranslationKeyForm`. The
`TranslationEditorDrawer` side panel and the `CreateTranslationKeyModal` dialog
are gone.

**Why the original decision was reversed:** the drawer's argument was about
width — the grid carries Chiave, Descrizione, Namespace, Modulo, Stato and
Ultima modifica plus one column per language, so it is at its budget, and a
drawer gave every language a full-height textarea. That reasoning was sound
*against editing inside grid cells*, which nobody proposed instead. It was never
an argument for a panel over a page: a page gives each language more room than a
`max-w-xl` drawer, and more room for the conflict UI of DEC-6 as well.

What the drawer actually cost was consistency. Every other primary editor in
this application is a page — Funzionalità at `functionalities/[funcId]/edit`,
Ruoli & permessi at `roles-permissions/[roleId]` — and dialogs here are reserved
for short secondary actions: create role, rename role, manage a user's roles,
the language form, confirming a delete. The translations editor was the only
main-entity editor in a panel, which is what made it feel wrong to use.

The one thing the panel did better, it now does explicitly: it never left the
list, so the grid's filters and sort were never lost. The form carries the
list's query string in a `from` parameter and restores it on Annulla and after
Salva.

Full design: `docs/superpowers/specs/2026-09-01-translations-editor-page-design.md`.
```

- [✅] **Step 2: Confirm the docs contract still holds**

`sources/devops/docs-contract.test.mjs` reads this same file and asserts on
DEC-7's wording — `best-effort diagnostic`, `retention`, `redact`, and the
absence of "audit trail". DEC-7 must not be touched.

Run: `npm run test:docs-contract`
Expected: PASS.

- [✅] **Step 3: Tick this plan's own boxes and the spec's**

Per `AGENTS.md`: as each task above completed, its checkboxes should already have
been marked `- [✅]`. Confirm none were missed before committing — an unticked
plan is indistinguishable from an unstarted one.

- [✅] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-28-i18n-system-design.md docs/superpowers/plans/2026-09-01-translations-editor-page.md
git commit -m "docs(i18n): DEC-5 superata, il pannello era un argomento contro le celle non contro una pagina"
```

---

## Verification Before Claiming Done

Run all of these from `sources/microservices/web-construct/` unless noted, and
paste the real output rather than summarising it:

```bash
npm test
npm run lint -- --max-warnings=0
npm run typecheck
npm run test:i18n-keys
npm run test:migrations
npm run test:docs-contract
npm run test:collection
npm run test:tokens
npm run test:raw-colors
npm run schema:check
```

From the repository root:

```bash
uv run pytest
```

And in the browser, with evidence: a filtered, sorted grid → Modifica → change a
value → Salva → the grid comes back **still filtered and sorted**. A screenshot
of that final state is the proof this task set out to produce.
