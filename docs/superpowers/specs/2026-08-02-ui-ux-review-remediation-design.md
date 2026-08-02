# UI/UX Review Remediation Design

## Summary

Resolve every actionable finding in `docs/reviews/2026-07-31-ui-ux-tester.md` without introducing a new UI dependency. The implementation restores the approved responsive-sidebar contract, centralizes accessible dialog behavior, completes the existing custom select's ARIA and keyboard model, names sidebar controls, and announces protected-route loading.

## Scope

- [✅] ID=HIGH-UIUX-01, Severity=High, Complexity=Medium, Priority=P1, Title=Restore operable narrow-viewport navigation, Fix description=Keep visible sidebar columns rendered below 768 px, force them into icon-only presentation, hide ineffective per-column collapse toggles, preserve the user's `masterCollapsed` state, and replace hover-only narrow-viewport tests with 767/768 px responsive tests.
- [✅] ID=HIGH-A11Y-02, Severity=High, Complexity=Medium, Priority=P1, Title=Create accessible modal focus boundaries, Fix description=Introduce one shared dialog focus primitive and apply it to FilterDrawer, ConfirmModal, LanguageFormModal, CreateTranslationKeyModal, TranslationEditorDrawer, ManageRolesModal, CreateRoleModal, and RenameRoleModal.
- [✅] ID=MED-A11Y-03, Severity=Medium, Complexity=Medium, Priority=P2, Title=Complete CustomSelect listbox accessibility, Fix description=Preserve the existing visual component while implementing a complete ARIA listbox contract, keyboard navigation, active-option state, selection, dismissal, and focus behavior.
- [✅] ID=MED-A11Y-04, Severity=Medium, Complexity=Low, Priority=P2, Title=Name and expose sidebar control state, Fix description=Add translated accessible names and expanded/checked state to icon-only and expanded sidebar controls, including account, theme, column toggles, close controls, and master expansion.
- [ ] ID=LOW-A11Y-05, Severity=Low, Complexity=Low, Priority=P3, Title=Announce route loading, Fix description=Render the protected-route loading fallback as a live status and keep the animated spinner decorative.

## Architecture

### Responsive sidebar

`isNarrowViewport` affects only per-column presentation. The derived state becomes `effCol1Collapsed = isNarrowViewport || col1Collapsed`; each sub-column uses the same rule with its persisted preference. `effMasterCollapsed` becomes exactly `masterCollapsed`.

When the viewport is below 768 px, all rendered columns use their icon widths and icon-only content. Per-column collapse controls are hidden because changing their persisted preference would have no visible effect at that breakpoint. The master-collapse action remains usable and continues to produce the thin rail only after an explicit user action. Widening the viewport restores the saved per-column modes.

### Shared dialog focus boundary

A focused UI primitive under `components/ui` owns dialog semantics and keyboard behavior while leaving each feature component responsible for its content and mutations. Its public contract supplies:

- a dialog title identifier and optional description identifier;
- `aria-modal="true"` and `role="dialog"`;
- initial focus on an explicitly marked element, an existing `autofocus` target, or the first enabled focusable control;
- cyclic Tab and Shift+Tab containment;
- Escape dismissal when closing is enabled;
- focus restoration to the element active before mount;
- an inert busy mode that suppresses Escape and backdrop dismissal during an in-flight mutation.

The primitive does not decide whether the panel is centered or right-aligned. Existing modal and drawer layouts remain visually unchanged. Backdrop clicks remain supported when the dialog is not busy.

### CustomSelect listbox

`CustomSelect` remains a styled custom control. The trigger exposes an accessible name, `aria-haspopup="listbox"`, `aria-expanded`, and `aria-controls`. The popup uses `role="listbox"`; every item uses `role="option"` and `aria-selected`; the list owns focus while open and exposes its active option through `aria-activedescendant`.

Opening initializes the active index to the selected option or the first option. Arrow keys wrap, Home and End jump, Enter and Space select, and Escape closes. Selection and dismissal return focus to the trigger. Outside click keeps the existing behavior. Consumers provide a stable accessible label rather than relying on placeholder text.

### Sidebar control semantics

Existing translations are reused where their meaning matches. Buttons that open panels receive `aria-expanded`; the account trigger receives `aria-label`; collapse, close, and expand buttons receive translated names. Theme toggles use `role="switch"`, `aria-checked`, and an accessible label in both icon-only and expanded modes. Tooltips remain visual supplements rather than the only label.

### Loading status

The protected-route loading wrapper owns `role="status"` and an accessible loading label. The animated child is marked `aria-hidden="true"`, preventing duplicate or meaningless announcements.

## Error and State Handling

- Dialog close requests are ignored while the owning mutation is busy, preventing unmounts during pending saves.
- Focus restoration checks that the prior element is still connected and focusable before calling `focus()`.
- Dialog and listbox keyboard handlers ignore modified key combinations and disabled controls.
- Empty CustomSelect option arrays keep the trigger operable as an empty control but do not open a focusless popup.
- Responsive state remains derived and is never persisted as a user preference.

## Testing

- [ ] Add focused failing unit tests for responsive sidebar derivation at 767 px and restored state at 768 px or wider.
- [ ] Add focused failing DOM tests for dialog semantics, initial focus, Tab wrapping, Escape behavior, busy-state blocking, and trigger-focus restoration.
- [✅] Add focused DOM tests for CustomSelect ARIA attributes and keyboard selection/dismissal.
- [ ] Add focused assertions for sidebar control accessible names and switch/panel state.
- [ ] Add a static-render test for the live loading status and decorative spinner.
- [ ] Update the existing sidebar E2E expectations so narrow viewports assert visible icon columns instead of a hover-only rail.
- [ ] Run the complete unit suite, TypeScript, lint, production build, and safe non-mutating UI checks available in the environment.

## Non-goals

- No visual redesign of dialogs, selectors, sidebar widths, or loading animation.
- No new third-party component library.
- No changes to authentication, RBAC, database mutations, or business validation.
- No automatic persistence of viewport-forced collapse state.
