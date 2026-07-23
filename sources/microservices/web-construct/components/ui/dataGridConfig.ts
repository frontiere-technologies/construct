import { themeQuartz } from 'ag-grid-community'

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
