# UI/UX Quality Review — 2026-07-31

## Findings and recommendations summary

Five actionable issues were found by static inspection of the current `feature/migliorie-varie` branch: one high-impact responsive-navigation regression and four accessibility/keyboard gaps across overlays, selectors, sidebar controls, and loading feedback. Browser-driven validation, visual screenshots, console inspection, and live data-state tests are blocked by the in-app browser URL policy after the local server was started; they are not represented as passed checks.

Severity counts: Critical 0, High 2, Medium 2, Low 1.

## Actionable findings

- [✅] ID=HIGH-UIUX-01, Severity=High, Complexity=Medium, Priority=P1, Title=Small viewports hide all navigation behind hover-only preview, Fix description=Restore the documented responsive contract: below 768 px force each visible sidebar column to icon-only mode while keeping the sidebar rendered and its meaningful controls available; keep `masterCollapsed` exclusively user-controlled. If the rail/preview design remains intentional, add an explicit touch/keyboard-open control that works at the narrow breakpoint and update the approved specification and tests.

  Flow/state: protected navigation at a viewport of 767 px or below, including touch devices and keyboard-only use.

  Reproduction: 1. Start with the normal sidebar expanded. 2. Reduce the viewport to 767 px. 3. Attempt to reach a navigation item without a hover-capable pointer.

  Observed: `isNarrowViewport` is folded into `effMasterCollapsed` (`isNarrowViewport || masterCollapsed`), so the normal columns are unmounted and only a 24 px rail is rendered. The rail button deliberately does nothing while narrow; the only opening mechanism is pointer hover. On touch devices there is no hover, and the expected icon-only navigation items are unavailable.

  Expected: the documented responsive flow keeps columns in icon-only mode below 768 px, hides only the per-column chevrons, preserves the user's master-collapse preference, and leaves navigation directly operable.

  Evidence: static DOM/render evidence in `sources/microservices/web-construct/components/Sidebar.tsx:291-306` and `:669-700`; the approved responsive contract is in `docs/superpowers/specs/2026-07-20-sidebar-responsive-collapse-design.md` (Goal, Architecture, and Testing sections).

  Impact: mobile and touch users can lose access to the primary navigation; keyboard users cannot reveal the preview by hover. This is a functional navigation failure rather than merely a compact-layout difference.

  Recommendation: implement the documented `effCol*Collapsed` render-time overrides independently from `masterCollapsed`, then cover 767/768 px with touch-equivalent and keyboard regression tests.

- [✅] ID=HIGH-A11Y-02, Severity=High, Complexity=Medium, Priority=P1, Title=Drawers and modal workflows do not establish an accessible modal focus boundary, Fix description=Use a shared accessible dialog primitive (or equivalent) for Filter Drawer, confirmations, role/language/translation modals, and the translation editor: `role="dialog"`, `aria-modal="true"`, programmatic label/description, initial focus, focus trap, Escape close where safe, and focus restoration to the invoking control. Keep backdrop click as a supplemental pointer affordance only.

  Flow/state: opening Filters, creating/editing a language or translation key, confirming destructive actions, managing roles, and creating/renaming a role.

  Reproduction: 1. Open any listed overlay. 2. Navigate by keyboard with Tab/Shift+Tab, or inspect it with a screen reader. 3. Press Escape and try to return to the triggering control.

  Observed: the shared Filter Drawer is plain fixed `<div>` markup with no dialog semantics, keyboard handler, focus movement, or focus trap. The same absence occurs in several modal components; the translation editor has `role="dialog"` but still lacks `aria-modal`, an `aria-labelledby` relationship, focus management, and Escape handling.

  Expected: overlays isolate keyboard and assistive-technology interaction from the covered page and provide predictable close/return behavior.

  Evidence: `sources/microservices/web-construct/components/rbac/FilterDrawer.tsx:19-48`, `components/ui/ConfirmModal.tsx:24-39`, `components/i18n/languages/LanguageFormModal.tsx:35-80`, `components/i18n/translations/CreateTranslationKeyModal.tsx:37-72`, `components/rbac/users/ManageRolesModal.tsx:39-60`, and `components/i18n/translations/TranslationEditorDrawer.tsx:81-94`.

  Impact: keyboard and screen-reader users can tab into obscured page controls, lose orientation, and have no dependable Escape/focus-return recovery across high-frequency admin workflows.

  Recommendation: centralize dialog behavior to avoid each new modal repeating the same accessibility defect, and add keyboard tests for focus containment, Escape, and trigger-focus restoration.

- [ ] ID=MED-A11Y-03, Severity=Medium, Complexity=Medium, Priority=P2, Title=CustomSelect does not expose or implement a keyboard-accessible select pattern, Fix description=Replace CustomSelect with a native `<select>` where feasible, or implement the ARIA combobox/listbox pattern completely: trigger `aria-expanded`/`aria-controls`, listbox/options semantics and selected/active state, Arrow/Home/End navigation, Enter/Space selection, Escape close, focus movement, and outside-click parity.

  Flow/state: filters and forms using `CustomSelect`, including role/status filter choices.

  Reproduction: 1. Tab to a CustomSelect trigger. 2. Open it with the keyboard. 3. Try Arrow keys, Home/End, Escape, or screen-reader list navigation.

  Observed: the component renders an unlabeled generic button plus generic `<div>` containers and option buttons. It has no ARIA expanded/controls/listbox/option contract and no keyboard event handling; only mouse click and mousedown-outside behavior are implemented.

  Expected: a selector has a discoverable state and supports standard keyboard selection and dismissal without requiring pointer navigation.

  Evidence: `sources/microservices/web-construct/components/rbac/CustomSelect.tsx:38-88`.

  Impact: filtering and form completion are materially slower or inaccessible to keyboard and assistive-technology users; state is not reliably announced.

  Recommendation: prefer the native element unless custom rendering is necessary; otherwise adopt a proven accessible primitive and test keyboard behavior as part of each consuming flow.

- [✅] ID=MED-A11Y-04, Severity=Medium, Complexity=Low, Priority=P2, Title=Icon-only sidebar controls have no accessible names or state, Fix description=Give every icon-only interactive control an explicit translated `aria-label`; model the theme control as a labelled `role="switch"` with `aria-checked`, and expose expanded/collapsed state where the control changes a panel or column. Ensure the compact account button remains named when its visible email text is hidden.

  Flow/state: collapsed sidebar columns, account panel, theme mode, and sidebar column/master controls.

  Reproduction: 1. Collapse the first or a sub-sidebar column. 2. Navigate controls through a screen reader or inspect accessible names. 3. Try to identify the chevrons, compact theme icon, and compact account trigger without hover tooltips.

  Observed: the close/column-toggle icon buttons contain only SVG icons; the collapse toggle has neither label nor title. The compact theme button has no name/state, and the expanded theme toggle is an unnamed visual switch without `aria-checked`. The account trigger loses all visible text in compact mode and does not supply an alternate name.

  Expected: each control has a stable translated accessible name and state; hover-only tooltips are supplementary, never the sole label.

  Evidence: `sources/microservices/web-construct/components/Sidebar.tsx:61-87`, `:501-526`, and `:570-595`.

  Impact: assistive-technology users encounter unnamed controls in core navigation/settings; they cannot reliably discover or operate sidebar micro-interactions.

  Recommendation: add translated names and semantic state in Sidebar, then validate the accessible tree in both expanded and icon-only states.

- [ ] ID=LOW-A11Y-05, Severity=Low, Complexity=Low, Priority=P3, Title=Route loading state is not announced as a live status, Fix description=Expose the loading component as `role="status"` with an appropriate accessible name (or use a visually-hidden live status), and mark the decorative spinner `aria-hidden="true"` when the status container owns the announcement.

  Flow/state: route transition/loading fallback for all protected pages.

  Reproduction: 1. Trigger a slow protected-route transition. 2. Observe the accessibility tree or use a screen reader while the fallback is visible.

  Observed: the spinner is a generic `<div>` with an `aria-label`, but no status/live-region role. A label alone does not cause an asynchronous loading change to be announced.

  Expected: users are informed that content is loading and are not left on an apparently inert page.

  Evidence: `sources/microservices/web-construct/app/(protected)/loading.tsx:6-12`.

  Impact: low-vision and screen-reader users may receive no feedback during navigation latency.

  Recommendation: use an announced status pattern and verify it during a throttled route-transition test.

## Coverage ledger

| Area | Status | Notes |
|---|---|---|
| Documented flows and current routes | Statically inspected | README, CLAUDE, UI/UX-agent protocol, current route tree, E2E flow inventory, and current 2026-07 sidebar/grid specifications read. |
| Sidebar navigation, hierarchy, active states, collapse/hover micro-interactions | Statically inspected | Responsive contract mismatch and accessible-control gaps found. Live pointer/animation behavior blocked. |
| Language switcher | Statically inspected | Component has a considered keyboard listbox implementation; live persistence/translation refresh was blocked. |
| Theme behavior | Statically inspected | Theme state wiring reviewed; sidebar theme toggle accessibility issue found. Live light/dark visual contrast blocked. |
| Users, roles, languages, and translations grids/filters | Statically inspected | Current grid sizing/filter specifications and shared configuration reviewed; live filter, resize, and empty/error states blocked. |
| Forms and mutation flows | Statically inspected | Modal/select accessibility gaps found. Data-mutating create/edit/delete/save flows intentionally not exercised. |
| Loading/error states | Statically inspected | Protected loading and error boundaries reviewed; loading announcement issue found. |
| Authentication and anonymous flows | Untested | Browser interaction is blocked; no credentials or session data were accessed. |
| Responsive visual layout and white-space/contrast audit | Blocked | No compliant browser surface was available to inspect rendered pixels at breakpoints/themes. |
| Keyboard interaction and accessibility-tree validation | Blocked live / statically inspected | Source evidence supports the findings; actual focus order and computed accessible names still require browser validation. |
| Console-visible failures and network errors | Blocked | Browser logs could not be collected after navigation was policy-blocked. |

## Blockers and limitations

The local Next.js development server was started successfully on port 3000. The in-app browser initially received a connection refusal before the server was running; after startup, its URL policy rejected further localhost navigation/reload actions. Per browser safety policy, no alternate browser surface, raw browser protocol, session inspection, or workaround was attempted. No screenshots were captured because no rendered app state could be safely inspected. No application data was modified.
