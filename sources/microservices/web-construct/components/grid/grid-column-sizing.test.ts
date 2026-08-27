import { describe, expect, it } from 'vitest'
import type { ColDef } from 'ag-grid-community'
import { GRID_MIN_COLUMN_WIDTH, normalizeGridColumnDefs } from './grid-column-sizing'

describe('normalizeGridColumnDefs', () => {
  it('keeps actions fixed and gives every data column a readable resize minimum', () => {
    const actions: ColDef = { colId: 'actions', width: 56, resizable: false }
    const columns: ColDef[] = [
      actions,
      { field: 'key', initialWidth: 260, minWidth: 260, resizable: false },
      { field: 'description', initialWidth: 200 },
    ]

    const normalized = normalizeGridColumnDefs(columns)

    expect(GRID_MIN_COLUMN_WIDTH).toBe(112)
    expect(normalized[0]).toBe(actions)
    expect(normalized[0]).toMatchObject({ colId: 'actions', width: 56, resizable: false })
    expect(normalized[1]).toMatchObject({ field: 'key', initialWidth: 260, minWidth: 112, resizable: true })
    expect(normalized[2]).toMatchObject({ field: 'description', initialWidth: 200, minWidth: 112, resizable: true })
    expect(columns[1]).toMatchObject({ minWidth: 260, resizable: false })
  })
})
