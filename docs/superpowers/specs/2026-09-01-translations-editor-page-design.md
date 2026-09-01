# Translations Editor as a Full Page

**Date:** 2026-09-01
**Status:** Approved

## Context

Admin → Traduzioni edits a translation key in a right-hand side panel
(`components/i18n/translations/TranslationEditorDrawer.tsx`), mounted from React
state inside the grid client and reachable by no URL of its own. Creating a key
opens a second, unrelated shell: the `CreateTranslationKeyModal` dialog.

Every other *primary* editor in this application is a page. Funzionalità has two
real routes, `functionalities/create` and `functionalities/[funcId]/edit`, both
rendering one `FunctionalityForm`; Ruoli & permessi edits a role at
`roles-permissions/[roleId]`. Dialogs in this codebase are reserved for short
secondary actions — create role, rename role, manage a user's roles, the
language form, and today's "Nuova chiave". Translations are the only main-entity
editor that appears in a panel, and that is the inconsistency being removed.

### This reverses a recorded decision

The panel was deliberate, not an oversight. **DEC-5** of
`docs/superpowers/specs/2026-07-28-i18n-system-design.md` chose a drawer over
in-grid editing, reasoning that the grid already carries Chiave, Descrizione,
Namespace, Modulo, Stato and Ultima modifica plus one column per active
language, so it is at its width budget, and that a drawer gives each language a
full-height textarea plus room for the conflict UI.

That reasoning was an argument against *editing inside grid cells*. It is not an
argument against a page, which gives every language even more room than a
`max-w-xl` panel does. What the drawer bought — space — a page buys more
cheaply. DEC-5 is superseded here, and the i18n design document must be updated
to say so rather than left contradicting the code.

## Decisions

- **One shared form, two routes.** A single `TranslationKeyForm` with
  `mode: 'create' | 'edit'`, mirroring `FunctionalityForm`. Two separate forms
  would duplicate the metadata column, the per-language column, and the
  prototype-safety care around DB-sourced language codes — precisely the details
  that go missing in a copy.
- **The drawer and the create dialog are deleted**, not kept alongside. Two
  routes to one editor is the defect, not the fix.
- **Both create and edit become pages.** Create keeping its dialog would leave
  the two actions of the same screen behaving differently from each other.
- **Languages stay in an open list**, not the collapsible accordion Funzionalità
  uses. Funzionalità collapses because each locale there has three fields (nome,
  descrizione, tag); a translation has one, the value. Collapsing would also
  hide the "manca" chip, which is the single piece of information a translator
  is scanning for.
- **Grid state survives the round trip.** The panel never left the list, so
  filters and sort were never lost. A page that returned to a bare
  `/admin/translations` would be a regression for anyone working through many
  keys, so the list's query travels with the navigation.
- **Ripristina is kept.** On a page, Annulla navigates away, which makes
  Ripristina the only way to reset the form to server values without losing your
  place. It currently has no test at all; it gets one.
- **Create writes values too, in two calls, not one transaction.** See
  "Saving from the create page".

## Routes

Both live under `app/(protected)/(admin)/`, whose layout already calls
`requireAdmin()`, so neither route needs its own guard:

| Route | File |
|---|---|
| `/admin/translations/create` | `admin/translations/create/page.tsx` |
| `/admin/translations/[keyId]/edit` | `admin/translations/[keyId]/edit/page.tsx` |

Next.js resolves the static `create` segment before the sibling dynamic
`[keyId]`, so the two do not collide.

Each page is a server component: it loads `listNamespaces()`,
`listModules()`, and — in edit mode — the key itself, then hands everything to
the client form. The existing `page.tsx` for the list keeps its own redundant
`isAdmin` check; nothing about it changes.

## Reading one key

`lib/i18n/translation-service.ts` exposes no single-key reader — only
`listTranslations(query)`, which builds its `TranslationRowDto`s inline. Two
details of that construction are load-bearing and easy to lose: value buckets
are `Object.create(null)`, and lookups use `Object.hasOwn`, both because
language codes come from the database and a code like `constructor` or
`__proto__` must read as "no translation" rather than resolving to an inherited
`Object.prototype` member.

So the row-shaping step is **extracted** into a shared helper that both
`listTranslations` and a new `getTranslationKeyRow(id)` call. Copying it would
put that care in two places, where one copy eventually loses it.

`getTranslationKeyRow` returns `null` for an unknown id, and the edit page turns
that into `notFound()`.

## The form

`components/i18n/translations/TranslationKeyForm.tsx`, in a `PageContainer`
titled `Traduzioni / Modifica` or `Traduzioni / Nuova chiave`, with the same
`grid-cols-1 lg:grid-cols-2 gap-6` split Funzionalità uses.

**Left — Informazioni generali**

- **Chiave.** Editable in create mode only; read-only text in edit mode, since
  renaming a key is not something the current save path supports. As in today's
  dialog, the namespace follows the key by convention (`namespaceOf`) until the
  administrator overrides it.
- **Namespace** (required) and **Modulo** (optional), both `EditableCombobox`
  over the existing lists.
- **Descrizione**, a `Textarea`.

**Right — Gestione traduzioni**

One `Textarea` per active language, labelled with the language's native name and
carrying the `manca` chip when empty, capped at `MAX_VALUE_LENGTH`. This is the
drawer's current language block, unchanged in behaviour.

**Footer**

Ripristina, Annulla, Salva, matching the drawer's set, laid out like
Funzionalità's footer with the error message on the left. The conflict panel
(DEC-6 — per-language optimistic locking, with its "Ricarica" action) moves over
as it is; a page gives it more room than the drawer did, not less.

Validation mirrors `validateKeyInput` in `lib/i18n/translation-actions.ts`,
which rejects a key not matching `modulo.sezione.elemento`, a namespace outside
lowercase/digits/underscore, and a malformed module. The form disables Salva on
those conditions rather than waiting for the action to return a string.

**Salva is gated differently per mode**, and this is the one place the two modes
genuinely diverge. In edit mode it stays disabled until the form is dirty, as
the drawer does — resaving an untouched key would only burn a version. In create
mode there is nothing to be dirty against, so it is gated on validity alone: a
key and a namespace being present and well-formed.

## Returning to the list

The grid's state lives in the URL (`?sort=namespace&direction=ASC`, plus
per-column and per-language filters). Both row actions carry that query into the
navigation as a `from` parameter, and Annulla and Salva return to it, so a
filtered, sorted grid comes back as it was left.

`from` holds the **query string alone**, URL-encoded — not a path, and not an
absolute URL. The destination is always `/admin/translations`, built in code;
`from` only supplies what follows the `?`. That makes an open-redirect
impossible by construction rather than by validation. An absent or empty `from`,
or one that does not parse, yields a bare `/admin/translations`.

In `TranslationsTableClient`, the Modifica action and the "Nuova chiave" button
become navigations; the `editing` and `creating` state, and the two components
they mounted, go away. Deletion keeps its `ConfirmModal` — it is a short
secondary action, which is what dialogs are for here.

`from` restores filters and sort, but deliberately not scroll position. The
grid uses AG Grid's infinite row model, and its datasource is remounted on
navigation back to the list, which has no cheap way to seek back to a given
scroll offset — unlike filters and sort, which are just the query string
replayed into props. The old side panel never lost scroll because it never
left the list; a page necessarily can. Editing a row far down a filtered,
sorted grid and saving returns to the top of that same grid, not to a blank
one. That is a known, accepted gap, not an oversight to "fix" later.

## Saving from the create page

`createTranslationKey` accepts metadata only. The create page therefore calls it
first, then calls `saveTranslations` for whatever values were typed. This needs
no new plumbing: the action already returns the new key's id
(`{ error: null, id }`), which is both what `saveTranslations` needs as `keyId`
and where the redirect goes. Values are saved with a `null` per-language
version, the same shape the edit form sends for a language that has no row yet.

If the second call fails, the key exists with no values. The form stays where it
is and shows the error, rather than navigating — a redirect would throw the
message away at exactly the moment it matters. It also remembers the new key's
id, so pressing Salva again saves only the values instead of trying to create
the same key a second time and colliding with the unique constraint on `key`,
which would report "Esiste già una chiave con questo nome" for what is really a
half-finished save.

That intermediate state is not corrupt: a key with no values is exactly what
today's create dialog produces every time. The
alternative — extending `createTranslationKey` to write values in one
transaction — is cleaner on paper but enters the write path guarded by the
optimistic-locking and concurrency integration tests, for a failure mode that is
already benign. Not worth the risk here.

## Translation keys and the migration

`sources/devops/i18n-key-inventory.test.mjs` fails hard when source calls `t()`
with a key no SQL migration seeds, because at runtime the label degrades to the
key itself. The new headings therefore need a migration, `0013_`, seeding:

- `translation.form.general_info` — "Informazioni generali"
- `translation.form.create_label` — "Nuova chiave", for the page title

Everything else is reused: `translation.title`, `translation.key`,
`translation.description`, `translation.namespace`, `translation.module`,
`translation.value`, `translation.missing`, `translation.actions.discard`,
`translation.conflict.*`, `common.actions.edit`, `common.actions.cancel`,
`common.actions.save`, `common.states.saving`, `common.labels.optional`.

## Testing

**Unit.** `TranslationEditorDrawer.test.tsx` and
`CreateTranslationKeyModal.test.tsx` become `TranslationKeyForm.test.tsx`,
covering both modes: the namespace-follows-key convention, the combobox
behaviour those two files already assert, dirty tracking, the conflict panel,
and Ripristina — which has no test today.

`TranslationsTableClient.test.tsx` asserts that Modifica and Nuova chiave
navigate, carrying the grid's query, instead of asserting that a panel mounts.

A unit test covers the `from` fallback: absent, empty, and off-site values all
resolve to `/admin/translations`.

**E2E.** `sources/tests/e2e/test_i18n.py` reaches the editor through
`[data-testid="translation-editor"]` in six places; the test id moves onto the
form so the selector survives, and the tests navigate to the new URL rather than
clicking a panel open. The two-context concurrency test still holds: two browser
contexts open the same edit URL, and the conflict assertions are unchanged.

**Guards.** `npm run test:i18n-keys` covers the new keys. Note that
`sources/devops/docs-contract.test.mjs` reads the i18n design document and
asserts on its DEC-7 audit wording (`best-effort diagnostic`, `retention`,
`redact`, and the absence of "audit trail"); rewriting DEC-5 in that file must
leave DEC-7 untouched.

## Documentation

- `docs/superpowers/specs/2026-07-28-i18n-system-design.md` — DEC-5 rewritten to
  record that the drawer was replaced by a page, why the width-budget argument
  did not survive, and a pointer to this document.
- The design note at the top of `TranslationEditorDrawer.tsx`, which cites §4.4
  of the input specs, leaves with the file.

## Out of scope

- The grid's columns, filters, and datasource.
- The delete flow.
- `createTranslationKey` and `saveTranslations` themselves: the two server
  actions are called differently, never changed.
- Renaming an existing key.
