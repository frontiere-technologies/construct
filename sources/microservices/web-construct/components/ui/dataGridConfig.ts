import { themeQuartz, type ColDef } from 'ag-grid-community'

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

export const appGridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--theme-surface)',
  foregroundColor: 'var(--theme-foreground)',
  borderColor: 'var(--theme-border)',
  accentColor: 'var(--theme-primary)',
  rowHoverColor: 'var(--theme-surface-hover)',
  headerBackgroundColor: '#111827',
  headerTextColor: '#ffffff',
  // A single static divider (not the resize-drag handle) between every header
  // cell, including non-resizable ones like the actions column -- otherwise
  // resizable columns show their resize handle as a short tick and
  // non-resizable columns show nothing at all.
  headerColumnResizeHandleColor: 'transparent',
  headerColumnBorder: { style: 'solid', width: 2, color: 'var(--theme-border)' },
  headerColumnBorderHeight: '50%',
  oddRowBackgroundColor: 'var(--theme-surface)',
  // No vertical rule between the pinned actions column and the scrolling columns:
  // the actions column reads as part of the row, not as a separate pane. The header
  // divider that `headerColumnBorder` would still draw there is suppressed in
  // `globals.css` (it is per-column, so it can't be turned off from the theme).
  pinnedColumnBorder: false,
})

export const itLocaleText = {
  contains: 'Contiene',
  inRange: "Nell'intervallo",
  inRangeStart: 'Da',
  inRangeEnd: 'A',
  filterOoo: 'Filtra...',
  applyFilter: 'Applica',
  resetFilter: 'Reset',
  clearFilter: 'Cancella',
  noRowsToShow: 'Nessun risultato',
  loadingOoo: 'Caricamento...',
}
