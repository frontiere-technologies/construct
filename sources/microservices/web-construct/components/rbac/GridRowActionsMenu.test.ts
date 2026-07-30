import { describe, it, expect } from 'vitest'
import GridRowActionsMenu, { actionsColumnDef } from './GridRowActionsMenu'

interface Row { id: number }

describe('actionsColumnDef', () => {
  it('pins the actions column to the left and locks it there', () => {
    const col = actionsColumnDef<Row>(() => [])
    expect(col.pinned).toBe('left')
    expect(col.lockPinned).toBe(true)
    expect(col.lockPosition).toBe('left')
    expect(col.suppressMovable).toBe(true)
  })

  it('renders the row menu and is neither sortable, filterable nor resizable', () => {
    const col = actionsColumnDef<Row>(() => [])
    expect(col.colId).toBe('actions')
    expect(col.cellRenderer).toBe(GridRowActionsMenu)
    expect(col.sortable).toBe(false)
    expect(col.filter).toBe(false)
    expect(col.resizable).toBe(false)
  })

  it('uses an empty header and remains the only fixed-width exception', () => {
    const col = actionsColumnDef<Row>(() => [])
    expect(col.headerName).toBe('')
    expect(col.resizable).toBe(false)
    expect(col.width).toBe(56)
  })

  it('forwards the row items builder to the cell renderer', () => {
    const getItems = (row: Row) => [{ label: `row-${row.id}`, onClick: () => {} }]
    const col = actionsColumnDef<Row>(getItems)
    expect((col.cellRendererParams as { getItems: typeof getItems }).getItems).toBe(getItems)
  })
})
