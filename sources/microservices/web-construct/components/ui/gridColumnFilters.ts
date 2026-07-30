import type { ColDef } from 'ag-grid-community'

export const TEXT_FILTER: Partial<ColDef> = {
  filter: 'agTextColumnFilter',
  filterParams: {
    filterOptions: ['contains'],
    buttons: ['apply', 'reset'],
  },
}

export const NUMBER_FILTER: Partial<ColDef> = {
  filter: 'agNumberColumnFilter',
  filterParams: {
    filterOptions: ['equals', 'inRange'],
    buttons: ['apply', 'reset'],
  },
}

export const DATE_FILTER: Partial<ColDef> = {
  filter: 'agDateColumnFilter',
  filterParams: {
    filterOptions: ['inRange'],
    buttons: ['apply', 'reset'],
  },
}
