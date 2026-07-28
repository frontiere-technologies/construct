import { describe, it, expect } from 'vitest'
import type { ColDef } from 'ag-grid-community'
import { columnPinningState } from './dataGridConfig'

describe('columnPinningState', () => {
  it('collects left- and right-pinned columns by id', () => {
    const cols: ColDef[] = [
      { colId: 'actions', pinned: 'left' },
      { field: 'email' },
      { colId: 'total', pinned: 'right' },
    ]
    expect(columnPinningState(cols)).toEqual({ leftColIds: ['actions'], rightColIds: ['total'] })
  })

  it('falls back to `field` when a pinned column has no explicit colId', () => {
    expect(columnPinningState([{ field: 'email', pinned: 'left' }])).toEqual({
      leftColIds: ['email'], rightColIds: [],
    })
  })

  it('returns empty lists when nothing is pinned', () => {
    expect(columnPinningState([{ field: 'email' }, { colId: 'roles' }])).toEqual({
      leftColIds: [], rightColIds: [],
    })
  })
})
