import { themeQuartz, type ColDef } from 'ag-grid-community'
import type { TranslateFn } from '@/lib/i18n/types'

/**
 * The `columnPinning` slice of AG Grid's `initialState`, derived from the column
 * definitions.
 *
 * Needed because `initialState` takes precedence over the column definitions: as
 * soon as any state is passed (here: filter and sort restored from the URL), AG Grid
 * applies the *whole* column state, and every `pinned` set on a ColDef is reset to
 * null -- silently, with no console warning. Feeding the pinning back in through the
 * state keeps the ColDef the single source of truth.
 */
export function columnPinningState<T>(columnDefs: ColDef<T>[]): { leftColIds: string[]; rightColIds: string[] } {
  const idsPinnedTo = (side: 'left' | 'right') => columnDefs
    .filter(c => c.pinned === side)
    .map(c => c.colId ?? c.field ?? '')
    .filter(Boolean)
  return { leftColIds: idsPinnedTo('left'), rightColIds: idsPinnedTo('right') }
}

export const appGridThemeParams = {
  backgroundColor: 'var(--theme-surface)',
  foregroundColor: 'var(--theme-foreground)',
  borderColor: 'var(--theme-border)',
  accentColor: 'var(--theme-primary)',
  rowHoverColor: 'var(--theme-surface-hover)',
  headerBackgroundColor: 'var(--theme-surface-hover)',
  headerTextColor: 'var(--theme-foreground)',
  // A single static divider (not the resize-drag handle) between every header
  // cell, including non-resizable ones like the actions column -- otherwise
  // resizable columns show their resize handle as a short tick and
  // non-resizable columns show nothing at all.
  headerColumnResizeHandleColor: 'transparent',
  headerColumnBorder: { style: 'solid', width: 2, color: 'var(--theme-border)' },
  headerColumnBorderHeight: '50%',
  oddRowBackgroundColor: 'var(--theme-surface)',
  // No vertical rule between the pinned actions column and the scrolling columns:
  // the actions column reads as part of the row, not as a separate pane.
  pinnedColumnBorder: false,
}

export const appGridTheme = themeQuartz.withParams(appGridThemeParams)

/**
 * AG Grid's built-in strings. Built per render from the active dictionary
 * rather than exported as a constant — a constant is evaluated once at module
 * load, so it would freeze the grid's chrome in whatever language the first
 * request happened to use.
 */
export function gridLocaleText(t: TranslateFn): Record<string, string> {
  return {
    contains: t('grid.filter.contains'),
    inRange: t('grid.filter.in_range'),
    inRangeStart: t('grid.filter.range_start'),
    inRangeEnd: t('grid.filter.range_end'),
    filterOoo: t('grid.filter.placeholder'),
    applyFilter: t('grid.filter.apply'),
    resetFilter: t('grid.filter.reset'),
    clearFilter: t('grid.filter.clear'),
    noRowsToShow: t('grid.no_rows'),
    loadingOoo: t('grid.loading'),
  }
}
