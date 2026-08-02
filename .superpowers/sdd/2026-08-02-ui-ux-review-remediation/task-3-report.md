# Task 3 Report: CustomSelect listbox behavior

## Result

`CustomSelect` is now a custom-styled ARIA listbox control with a labeled trigger, listbox/options semantics, active-option tracking, keyboard operation, selection, and focus restoration.

## Files changed

- `sources/microservices/web-construct/components/rbac/CustomSelect.tsx`
- `sources/microservices/web-construct/components/rbac/CustomSelect.test.tsx`
- `sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx`
- `sources/microservices/web-construct/components/ui/AccessibleDialog.test.tsx` (compile-only fixture correction for the Task 2 required prop)
- `docs/reviews/2026-07-31-ui-ux-tester.md`
- `docs/superpowers/specs/2026-08-02-ui-ux-review-remediation-design.md`
- `.superpowers/sdd/2026-08-02-ui-ux-review-remediation/task-3-report.md`

## Decisions

- Kept the existing custom visual layout and introduced no UI dependency.
- Added required `ariaLabel` so each consumer supplies a stable accessible name.
- Used a generated listbox ID, with stable option IDs derived from it, for `aria-controls` and `aria-activedescendant`.
- Matched `LanguageSwitcher`'s keyboard model: wrapped Arrow navigation, Home/End, Enter/Space selection, Escape dismissal, and listbox focus while open.
- Selection and Escape restore focus to the trigger. Outside pointer dismissal intentionally does not restore trigger focus, so it cannot steal focus from the element the user clicked.
- Empty option arrays leave the trigger closed and do not render a focusless popup.

## Test evidence

1. RED — from `sources/microservices/web-construct/`:

   ```text
   npm test -- components/rbac/CustomSelect.test.tsx
   Test Files  1 failed (1)
   Tests  4 failed (4)
   ```

   Failures were the expected missing `aria-haspopup`, missing keyboard popup/focus behavior, and missing `aria-expanded` state.

2. GREEN — from `sources/microservices/web-construct/`:

   ```text
   npm test -- components/rbac/CustomSelect.test.tsx
   Test Files  1 passed (1)
   Tests  4 passed (4)
   ```

3. Type check — from `sources/microservices/web-construct/`:

   ```text
   npx tsc --noEmit
   ```

   The first run found the pre-existing Task 2 test fixture omitted `AccessibleDialog`'s required `panelClassName`. Adding `panelClassName=""` to that fixture made the type check pass on re-run.

4. Lint — from `sources/microservices/web-construct/`:

   ```text
   npm run lint
   ✖ 4 problems (0 errors, 4 warnings)
   ```

   The four warnings are unrelated pre-existing `no-img-element` and unused-variable warnings; lint exits successfully with no errors.

## Self-review

- Trigger exposes `aria-label`, `aria-haspopup="listbox"`, `aria-expanded`, and `aria-controls`.
- The open popup is a focused `role="listbox"` with `aria-activedescendant`; every item is a `role="option"` with `aria-selected`.
- Keyboard behavior handles the required keys without modifier combinations and avoids opening an empty list.
- The form's two `CustomSelect` consumers pass the exact translated labels required by the brief.
- `MED-A11Y-03` was marked `[✅]` only after the focused test suite passed.
- No database-mutating integration or E2E test was run.
