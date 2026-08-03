# Role selection overflow design

## Summary

The selected-role area in the user role management dialog must remain compact when many roles are selected and must contain exceptionally long role names without overflowing the dialog. The selected-role area will have independent vertical and horizontal scrolling, while the role-option list keeps its existing scroll behavior.

## Requirements

- [ ] ID=ROLE-OVERFLOW-1, Severity=Medium, Complexity=Low, Priority=P1, Title=Bound selected-role height, Fix description=Limit the selected-role area to approximately four tag rows with a maximum height of 7rem and show a vertical scrollbar only when its content exceeds that height.
- [ ] ID=ROLE-OVERFLOW-2, Severity=Medium, Complexity=Low, Priority=P1, Title=Contain long role names, Fix description=Keep role chips from shrinking or breaking unspaced names and show a horizontal scrollbar only when selected content exceeds the available width.
- [ ] ID=ROLE-OVERFLOW-3, Severity=Low, Complexity=Low, Priority=P2, Title=Preserve option-list scrolling, Fix description=Keep the existing role-option list scroll container independent from the selected-role scroll container.
- [ ] ID=ROLE-OVERFLOW-4, Severity=Low, Complexity=Low, Priority=P2, Title=Add regression coverage, Fix description=Add a focused component source contract that fails unless the selected-role container declares both bounded height and two-axis automatic overflow.

## Component design

`RoleMultiSelect` will retain its current structure and behavior. Only the selected-role input container will change:

- `max-h-28` caps the area at 7rem, approximately four compact chip rows.
- `overflow-y-auto` provides vertical scrolling as selections accumulate.
- `overflow-x-auto` contains very long unbroken role names.
- An inner width-preserving flex wrapper and non-shrinking chips allow horizontal overflow to be measured inside the selected area instead of escaping the modal.

The filter input remains part of the same selected-role area. The checkbox list below continues to use its existing `max-h-56 overflow-y-auto` container.

## Accessibility and interaction

No keyboard, focus, checkbox, or remove-button behavior changes. Scrollbars appear only when needed. Role names remain fully available rather than being truncated, including for keyboard and touch users.

## Verification

The implementation will follow test-driven development:

1. Add a focused source contract for the selected-role container and observe it fail against the current component.
2. Apply the minimal class and wrapper changes.
3. Run the focused test, the relevant component tests, lint, and TypeScript/build verification.
4. Inspect the dialog in the running development application with many selected roles and long unbroken names when practical.
