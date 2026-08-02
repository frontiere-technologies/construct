# UI/UX Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all five actionable findings in `docs/reviews/2026-07-31-ui-ux-tester.md` with tested responsive and accessibility behavior.

**Architecture:** Restore responsive sidebar behavior through a pure derived-state helper, centralize modal semantics and focus handling in one shared primitive, complete the existing custom listbox instead of replacing its visuals, and isolate loading semantics in a renderable component. Existing feature components retain ownership of content and mutations.

**Tech Stack:** React 19, Next.js 16, TypeScript, Tailwind CSS, Vitest, jsdom, Python Playwright E2E

## Global Constraints

- Do not add a third-party UI component library.
- Preserve existing visual layout and business behavior.
- Below 768 px, force visible sidebar columns into icon-only mode without changing persisted preferences.
- `masterCollapsed` remains exclusively user-controlled.
- Every modal/drawer must expose dialog semantics, contained focus, safe Escape handling, and trigger-focus restoration.
- `CustomSelect` remains custom-styled and implements the complete ARIA listbox keyboard contract.
- Mark each originating review checkbox `- [✅]` only after its focused tests pass.
- Do not run database-mutating E2E or integration tests against the configured application database.

---

### Task 1: Responsive navigation and sidebar semantics

**Files:**
- Create: `sources/microservices/web-construct/components/sidebarPresentation.ts`
- Create: `sources/microservices/web-construct/components/sidebarPresentation.test.ts`
- Create: `sources/microservices/web-construct/components/Sidebar.accessibility.test.ts`
- Modify: `sources/microservices/web-construct/components/Sidebar.tsx`
- Modify: `sources/tests/e2e/test_sidebar.py`
- Modify: `docs/reviews/2026-07-31-ui-ux-tester.md`
- Modify: `docs/superpowers/specs/2026-08-02-ui-ux-review-remediation-design.md`

**Interfaces:**
- Produces `resolveSidebarPresentation(isNarrowViewport: boolean, masterCollapsed: boolean, persistedColumnCollapsed: boolean): { masterCollapsed: boolean; columnCollapsed: boolean; showColumnToggle: boolean }`.

- [ ] **Step 1: Write the failing responsive-state test**

```ts
import { describe, expect, it } from 'vitest'
import { resolveSidebarPresentation } from './sidebarPresentation'

describe('resolveSidebarPresentation', () => {
  it('forces only the column into icon mode on a narrow viewport', () => {
    expect(resolveSidebarPresentation(true, false, false)).toEqual({
      masterCollapsed: false, columnCollapsed: true, showColumnToggle: false,
    })
  })

  it('restores saved preferences on a wide viewport', () => {
    expect(resolveSidebarPresentation(false, true, false)).toEqual({
      masterCollapsed: true, columnCollapsed: false, showColumnToggle: true,
    })
  })
})
```

- [ ] **Step 2: Verify RED**

Run `npm test -- components/sidebarPresentation.test.ts` from `sources/microservices/web-construct`.

Expected: FAIL because `sidebarPresentation.ts` does not exist.

- [ ] **Step 3: Implement the presentation helper**

```ts
export function resolveSidebarPresentation(isNarrowViewport: boolean, masterCollapsed: boolean, persistedColumnCollapsed: boolean) {
  return {
    masterCollapsed,
    columnCollapsed: isNarrowViewport || persistedColumnCollapsed,
    showColumnToggle: !isNarrowViewport,
  }
}
```

- [ ] **Step 4: Write failing sidebar accessibility contract tests**

Read `Sidebar.tsx` and assert these exact contracts:

```ts
expect(source).toContain('aria-expanded={userPanelOpen}')
expect(source).toContain('role="switch"')
expect(source).toContain("aria-checked={settings.theme === 'dark'}")
expect(source).toContain("aria-label={t('nav.account')}")
expect(source).toContain('aria-label={toggleTitle}')
expect(source).toContain("aria-label={t('nav.expand_menu')}")
```

Run `npm test -- components/Sidebar.accessibility.test.ts` and confirm it fails because the semantics are absent.

- [ ] **Step 5: Integrate responsive and accessibility behavior**

Use the helper for column 1 and every sub-column. Render columns whenever `masterCollapsed` is false, including narrow viewports. Extend `ColToggleStack` with `toggleTitle: string` and `showToggle?: boolean`; hide only its chevron below 768 px. Preserve the close/master-collapse action.

Apply these semantics:

```tsx
aria-label={effCol1Collapsed ? t('nav.account') : undefined}
aria-expanded={userPanelOpen}
aria-controls="sidebar-user-panel"

role="switch"
aria-checked={settings.theme === 'dark'}
aria-label={t('nav.theme_mode')}

aria-label={t('nav.expand_menu')}
aria-expanded={false}
```

Give the user panel `id="sidebar-user-panel"`. Add `aria-label={item.label}` to icon-only `L1Item` and `SubItem` links/buttons. Hover preview remains only for explicit master collapse.

- [ ] **Step 6: Replace contradictory E2E expectations**

Replace the two narrow-rail tests with 767/768 px tests: at 767 px assert the first and opened sub-column remain visible at icon width and column toggles are hidden; at 768 px assert persisted text widths and toggles return. Syntax-check only:

```bash
uv run python -m py_compile sources/tests/e2e/test_sidebar.py
```

- [ ] **Step 7: Verify and commit Task 1**

Run:

```bash
npm test -- components/sidebarPresentation.test.ts components/Sidebar.accessibility.test.ts
```

After PASS, mark `HIGH-UIUX-01` and `MED-A11Y-04` `- [✅]` in the review and design, then commit with `fix(sidebar): restore accessible responsive navigation`.

### Task 2: Shared accessible dialog behavior

**Files:**
- Create: `sources/microservices/web-construct/components/ui/AccessibleDialog.tsx`
- Create: `sources/microservices/web-construct/components/ui/AccessibleDialog.test.tsx`
- Create: `sources/microservices/web-construct/components/ui/dialogConsumers.test.ts`
- Modify: `sources/microservices/web-construct/components/rbac/FilterDrawer.tsx`
- Modify: `sources/microservices/web-construct/components/ui/ConfirmModal.tsx`
- Modify: `sources/microservices/web-construct/components/i18n/languages/LanguageFormModal.tsx`
- Modify: `sources/microservices/web-construct/components/i18n/translations/CreateTranslationKeyModal.tsx`
- Modify: `sources/microservices/web-construct/components/i18n/translations/TranslationEditorDrawer.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/users/ManageRolesModal.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/roles/CreateRoleModal.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/roles/RenameRoleModal.tsx`
- Modify: `docs/reviews/2026-07-31-ui-ux-tester.md`
- Modify: `docs/superpowers/specs/2026-08-02-ui-ux-review-remediation-design.md`

**Interfaces:**
- Produces `AccessibleDialog({ titleId, descriptionId?, onClose, busy?, align?, panelClassName, children })`.

- [ ] **Step 1: Write failing jsdom behavior tests**

Use `// @vitest-environment jsdom`, `createRoot`, and React `act` to render:

```tsx
<AccessibleDialog titleId="dialog-title" onClose={onClose}>
  <h2 id="dialog-title">Title</h2>
  <button data-dialog-initial-focus>Cancel</button>
  <button>Save</button>
</AccessibleDialog>
```

Assert dialog role, `aria-modal`, `aria-labelledby`, initial focus, Tab and Shift+Tab wrapping, Escape close, busy suppression, backdrop behavior, and restoration to the pre-dialog trigger.

- [ ] **Step 2: Verify RED**

Run `npm test -- components/ui/AccessibleDialog.test.tsx`.

Expected: FAIL because `AccessibleDialog` does not exist.

- [ ] **Step 3: Implement AccessibleDialog**

Use a panel ref and this selector:

```ts
const FOCUSABLE = [
  'button:not([disabled])', '[href]', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')
```

Capture `document.activeElement` on mount. Focus `[data-dialog-initial-focus]`, then `[autofocus]`, then the first enabled focusable. Handle only unmodified Escape and Tab. Restore focus only when the prior element is connected. Close from backdrop only when target equals currentTarget and `busy` is false.

- [ ] **Step 4: Convert all eight consumers**

Each consumer uses `useId()`, gives its heading that ID, passes description IDs where copy exists, passes `busy`/`saving`, and marks the intended initial control. Preserve panel classes and use `align="right"` for drawers. Remove duplicated overlay/stop-propagation behavior.

- [ ] **Step 5: Add consumer contract test and verify GREEN**

`dialogConsumers.test.ts` reads all eight source files and asserts each imports/renders `AccessibleDialog` and supplies `titleId`.

```bash
npm test -- components/ui/AccessibleDialog.test.tsx components/ui/dialogConsumers.test.ts
```

- [ ] **Step 6: Mark and commit Task 2**

After PASS, mark `HIGH-A11Y-02` `- [✅]` in review/design and commit with `fix(a11y): centralize accessible dialog focus`.

### Task 3: CustomSelect listbox behavior

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/CustomSelect.tsx`
- Create: `sources/microservices/web-construct/components/rbac/CustomSelect.test.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx`
- Modify: `docs/reviews/2026-07-31-ui-ux-tester.md`
- Modify: `docs/superpowers/specs/2026-08-02-ui-ux-review-remediation-design.md`

**Interfaces:**
- Adds required `ariaLabel: string`; preserves all existing value/options/style props.

- [ ] **Step 1: Write failing jsdom tests**

Render three options and assert:

```ts
expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
expect(trigger.getAttribute('aria-expanded')).toBe('false')
// ArrowDown opens; End + Enter selects last and restores focus.
// Escape closes without selection and restores focus.
// Options expose role=option and aria-selected.
```

Also prove an empty option set does not open a popup.

- [ ] **Step 2: Verify RED**

Run `npm test -- components/rbac/CustomSelect.test.tsx` and confirm failure on missing ARIA/keyboard behavior.

- [ ] **Step 3: Implement the listbox contract**

Add trigger/list refs, `useId`, active index, trigger ARIA, focused listbox with `aria-activedescendant`, stable option IDs, and option selected state. Reuse the proven `LanguageSwitcher` key model: wrapping arrows, Home/End, Enter/Space selection, Escape close, and focus return. Outside dismissal must not steal focus from an element the user explicitly selected.

- [ ] **Step 4: Label both consumers**

```tsx
ariaLabel={t('functionalities.form.parent_placeholder')}
ariaLabel={t('functionalities.form.type_heading')}
```

- [ ] **Step 5: Verify, mark, and commit Task 3**

Run `npm test -- components/rbac/CustomSelect.test.tsx`. After PASS, mark `MED-A11Y-03` `- [✅]` and commit with `fix(a11y): complete CustomSelect listbox behavior`.

### Task 4: Loading status semantics

**Files:**
- Create: `sources/microservices/web-construct/components/ui/LoadingStatus.tsx`
- Create: `sources/microservices/web-construct/components/ui/LoadingStatus.test.tsx`
- Modify: `sources/microservices/web-construct/app/(protected)/loading.tsx`
- Modify: `docs/reviews/2026-07-31-ui-ux-tester.md`
- Modify: `docs/superpowers/specs/2026-08-02-ui-ux-review-remediation-design.md`

**Interfaces:**
- Produces `LoadingStatus({ label }: { label: string })`.

- [ ] **Step 1: Write failing static-render test**

```tsx
const html = renderToStaticMarkup(<LoadingStatus label="Loading…" />)
expect(html).toContain('role="status"')
expect(html).toContain('aria-label="Loading…"')
expect(html).toContain('aria-hidden="true"')
```

- [ ] **Step 2: Verify RED**

Run `npm test -- components/ui/LoadingStatus.test.tsx`.

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement and use LoadingStatus**

```tsx
export default function LoadingStatus({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex items-center justify-center h-full min-h-[200px]">
      <div aria-hidden="true" className="w-6 h-6 border-2 border-[var(--theme-primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
```

Resolve `common.states.loading` in the route loading component and pass it as `label`.

- [ ] **Step 4: Verify, mark, and commit Task 4**

Run `npm test -- components/ui/LoadingStatus.test.tsx`. After PASS, mark `LOW-A11Y-05` `- [✅]` and commit with `fix(a11y): announce protected route loading`.

### Task 5: Complete verification

**Files:**
- Modify: `docs/superpowers/plans/2026-08-02-ui-ux-review-remediation.md`
- Modify: `docs/superpowers/specs/2026-08-02-ui-ux-review-remediation-design.md`
- Verify: all Task 1-4 files

- [ ] **Step 1: Run complete gates**

From `sources/microservices/web-construct`:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: no test, type, lint-error, or build failures. Report existing unrelated warnings.

- [ ] **Step 2: Run non-mutating repository checks**

From the repository root:

```bash
uv run python -m py_compile sources/tests/e2e/test_sidebar.py
git diff --check
```

Do not run database-mutating E2E/integration suites without a disposable database.

- [ ] **Step 3: Verify ledgers and commit bookkeeping**

Confirm all five review and design scope IDs are `- [✅]`, mark only completed plan steps, and commit documentation with `docs: complete UI accessibility remediation`.
