# Grid Minimum Column Width Design

## Summary

Increase the shared minimum width for grid data columns from 20 px to 112 px. This keeps the beginning of each header title and its filter control visible while preserving manual resizing. The fixed actions column (`...`) remains unchanged.

## Scope

- [✅] ID=GRID-MIN-1, Severity=Medium, Complexity=Low, Priority=P1, Title=Readable minimum grid width, Fix description=Set the shared minimum width for every non-actions grid column to 112 px.
- [✅] ID=GRID-MIN-2, Severity=Medium, Complexity=Low, Priority=P1, Title=Preserve fixed actions column, Fix description=Keep the actions column definition and fixed sizing unchanged.
- [✅] ID=GRID-MIN-3, Severity=Medium, Complexity=Low, Priority=P1, Title=Regression coverage, Fix description=Update the sizing unit test to prove the 112 px minimum is applied without mutating caller definitions.

## Design

`normalizeGridColumnDefs` remains the single place that standardizes sizing across all AG Grid tables. `GRID_MIN_COLUMN_WIDTH` changes to `112`, and every column except the one with `colId: 'actions'` continues to receive `resizable: true` plus the shared `minWidth`.

No per-page overrides or responsive variants are introduced. This keeps the behavior consistent across users, roles, languages, and translations tables. Existing `initialWidth` values remain initial preferences only, so user resizing continues to survive column-definition refreshes.

## Error Handling and Compatibility

The change does not add new runtime failure modes or affect filtering, sorting, data loading, or persisted URL state. Input column definitions remain immutable because the normalizer continues to clone non-actions definitions.

## Verification

- [✅] Update the focused unit test first and confirm it fails because the current minimum is 20 px.
- [✅] Change the shared constant to 112 px and confirm the focused test passes.
- [✅] Run the complete unit suite, TypeScript check, lint, and production build.
- [ ] Verify in the browser that a data column cannot shrink below 112 px and that the header title prefix plus filter control remain visible.
