import { themeQuartz } from 'ag-grid-community'

export const appGridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--theme-surface)',
  foregroundColor: 'var(--theme-foreground)',
  borderColor: 'var(--theme-border)',
  accentColor: 'var(--theme-primary)',
  rowHoverColor: 'var(--theme-surface-hover)',
  headerBackgroundColor: '#111827',
  headerTextColor: '#ffffff',
  headerColumnResizeHandleColor: 'var(--theme-border)',
  oddRowBackgroundColor: 'var(--theme-surface)',
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
