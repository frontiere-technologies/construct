# Final fix report — Grid Status and Resize

Status: DONE

## Fix

- Replaced the three stateful Translations column `width` declarations with create-only `initialWidth` values `260`, `200`, and `200`; the shared normalizer continues to apply `minWidth: 20`.
- Updated the normalizer regression to assert preservation of `initialWidth`.
- Added a focused component regression that rebuilds Translations column definitions from changed props and verifies the key, description, and language-value columns expose `initialWidth` and never stateful `width`. This protects the create-only boundary AG Grid uses to preserve user-resized state when column definitions refresh.
- Updated the design and completed implementation plan to describe the final `initialWidth` semantics and post-refresh browser sequence.

## TDD evidence

- RED: `npm test -- components/i18n/translations/TranslationsTableClient.test.tsx` failed with the expected mismatch: the key definition contained `width: 260` and did not contain `initialWidth: 260`.
- GREEN: `npm test -- components/i18n/translations/TranslationsTableClient.test.tsx components/ui/gridColumnSizing.test.ts components/rbac/GridRowActionsMenu.test.ts` passed: 3 files, 6 tests.

## Browser evidence

- Opened `/admin/translations?sort=key&direction=ASC` in the local application.
- Resized the `key` / “Chiave” column from 260 px to 81 px.
- Clicked the same header to apply descending sort; the URL changed to `sort=key&direction=DESC`, causing the server/props-driven column-definition refresh.
- After the refresh, the header reported `aria-sort="descending"` and the column width remained exactly 81 px.

## Automated gate

- Full Vitest: PASS — 54 files, 494 tests.
- TypeScript (`npx tsc --noEmit`): PASS.
- ESLint (`npm run lint`): PASS — 0 errors, 4 pre-existing unrelated warnings.
- Production build (`npm run build`): PASS. The sandboxed attempt hit Turbopack's local-port `EPERM`; the required rerun with build permission compiled, type-checked, generated all 27 static pages, and exited successfully.
- `git diff --check`: PASS.

## Commit

- Implementation and regression commit: `d5836c7` (`fix(grid): preserve translation column resize state`).
- This report is committed separately so it can record the immutable implementation SHA.

## Concerns

- No blocking concerns.
- The repository still has the two declared unrelated worktree changes (`lib/i18n/translation-actions.integration.test.ts` and deleted `task-3-report.md`); neither was staged or committed.
- Four unrelated lint warnings remain unchanged.
