# Editable Combobox for Namespace and Module

**Date:** 2026-08-31
**Status:** Approved

## Context

Admin → Traduzioni asks for two classifying fields whenever a translation key is created or edited: `Namespace` (required) and `Modulo` (optional). Both are plain free-text `Input`s today, in two places:

- `components/i18n/translations/CreateTranslationKeyModal.tsx` — the "Nuova chiave" dialog
- `components/i18n/translations/TranslationEditorDrawer.tsx` — the edit panel for an existing key

Free text alone means the administrator types blind. Nothing shows which namespaces already exist, so `auth`, `Auth` and `authentication` can all be created by hand without anyone noticing, and the catalogue fragments one typo at a time. The values are not a fixed enumeration either — inventing a new namespace is a legitimate, expected action — so a closed dropdown would be wrong in the opposite direction.

What is needed is a combobox: suggest what exists, accept what does not.

## Decisions

- **Hand-rolled combobox**, not a native `<datalist>`. `datalist` is a handful of lines, but the browser owns its appearance: it ignores the application theme, and Chrome, Firefox and Safari each render and filter it differently. The project already hand-rolls `CustomSelect` and the `LanguageSwitcher` listbox for exactly this reason.
- **One component, four call sites.** Namespace and Modulo, in both the create dialog and the edit drawer. The edit drawer was not part of the original report but has the identical fields and the identical defect.
- **Suggestions never constrain the value.** Whatever is in the field is what gets saved.
- **No new query and no new server round-trip.** The lists already exist.
- **No new translation keys, therefore no migration.** See "Accessibility".

## Where the data comes from

`listNamespaces()` and `listModules()` already exist in `lib/i18n/translation-service.ts` and already run on every render of the Traduzioni page:

```
app/(protected)/(admin)/admin/translations/page.tsx
  → listNamespaces(), listModules()
    → TranslationsTableClient  props.namespaces, props.modules   (grid column filters)
      → CreateTranslationKeyModal    ← to be added
      → TranslationEditorDrawer      ← to be added
```

Both consumers are already children of `TranslationsTableClient`, which already holds both arrays. The change is to pass them down two more levels — nothing is fetched that is not fetched today.

Freshness is already handled: `TranslationsTableClient.refresh()` calls `router.refresh()`, which re-runs the server component and re-queries both lists. A namespace invented in the dialog therefore appears in the suggestions immediately after saving, with no reload.

## The component

`components/shared/EditableCombobox.tsx`.

It belongs in `shared/`, not `components/ui/`. That directory is reserved for shadcn stock primitives, and a placeholder for the hand-rolled dropdown was deliberately put there and withdrawn on 2026-08-27 because it occupied a stock name with different semantics. The same reasoning applies here.

```ts
interface Props {
  id: string
  value: string
  onChange: (next: string) => void
  /** Values already in use. Suggestions only — never a constraint on `value`. */
  options: string[]
  placeholder?: string
  'data-testid'?: string
}
```

`value` is the single source of truth and always mirrors the text field. Passed an empty `options`, the component degrades to exactly the `Input` it replaces — which is what makes it safe to drop into all four call sites at once.

## Behaviour

- Focus or click on the field opens the list showing **every** value already in use.
- Typing filters it by case-insensitive substring. When nothing matches, the list closes and typing continues undisturbed — an unmatched value is a new value, not an error.
- The list is capped at `max-h-56` with `overflow-y-auto`, so a long catalogue scrolls instead of growing off-screen.
- Choosing an option — click or Enter — writes it into the field and closes the list.
- Keyboard: ↓/↑ move the highlight, Enter takes the highlighted option, Escape closes and returns focus to the field, Tab closes and keeps whatever was typed.
- A click outside closes the list.
- The chevron is a decorative indicator, not a control.

## Accessibility

The full ARIA combobox pattern, implemented completely rather than partially:

- the input carries `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, and `aria-activedescendant` pointing at the highlighted option
- the list is `role="listbox"`, each entry `role="option"` with `aria-selected`

This is affordable precisely because the keyboard navigation it promises is being written anyway. It is the opposite situation from `GridRowActionsMenu`, where the project deliberately declares no `aria-haspopup` rather than promise a widget contract it does not honour — there, the roles would have been a claim without an implementation.

The chevron is `aria-hidden` and not a tab stop: the field itself opens the list. That choice also removes the need for a "show suggestions" label, which is why this design adds no translation key and needs no seed migration.

## Testing

Unit tests in jsdom for the component:

- opens on focus listing every option
- filters by substring as the user types
- keeps a typed value that matches nothing, and closes the list
- ↓/↑/Enter select; Escape closes and restores focus; Tab preserves the typed text
- the scroll container carries the max-height that produces the scrollbar
- `aria-expanded` and `aria-activedescendant` track the real state

Wiring tests: the four fields receive their lists, and the saved payload still reflects free text.

Then verification in the browser against the real catalogue.

## Out of scope

- Deduplicating or normalising the namespaces that already exist in the database.
- Any combobox elsewhere in the application. The two grids' column filters keep their current closed-choice control, which is correct for filtering.
- Validation changes: `namespace` keeps whatever server-side rules it has today.

## Tasks

- [✅] ID=CMB-1, Severity=Medium, Complexity=Medium, Priority=P1, Estimate=hours, Title=EditableCombobox component, Fix description=New `components/shared/EditableCombobox.tsx` implementing the behaviour and ARIA above, with its jsdom unit tests written first.
- [✅] ID=CMB-2, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Wire the create dialog, Fix description=Pass `namespaces`/`modules` from `TranslationsTableClient` into `CreateTranslationKeyModal` and replace the two `Input`s.
- [✅] ID=CMB-3, Severity=Medium, Complexity=Low, Priority=P1, Estimate=minutes, Title=Wire the edit drawer, Fix description=Same for `TranslationEditorDrawer`.
- [✅] ID=CMB-4, Severity=Low, Complexity=Low, Priority=P2, Estimate=minutes, Title=Browser verification, Fix description=Confirm against the real catalogue that the list opens, filters, scrolls, and that a new namespace survives saving and then appears among the suggestions.
