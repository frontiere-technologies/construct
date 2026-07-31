import { describe, expect, it } from 'vitest'
import {
  dateRangeToGridFilter,
  gridDateFilterToRange,
  gridNumberFilterToRange,
  numberRangeToGridFilter,
} from './grid-filter-models'

describe('grid filter models', () => {
  it('maps an in-range number filter without swapping its bounds', () => {
    expect(gridNumberFilterToRange({ type: 'inRange', filter: 10, filterTo: 20 }))
      .toEqual({ min: 10, max: 20 })
  })

  it('maps an equality number filter to equal bounds', () => {
    expect(gridNumberFilterToRange({ type: 'equals', filter: 10 }))
      .toEqual({ min: 10, max: 10 })
  })

  it('returns no range when a number filter has no starting value', () => {
    expect(gridNumberFilterToRange({ type: 'inRange', filterTo: 20 })).toBeUndefined()
  })

  it('creates an in-range filter from distinct number bounds', () => {
    expect(numberRangeToGridFilter({ min: 10, max: 20 }))
      .toEqual({ type: 'inRange', filter: 10, filterTo: 20 })
  })

  it('creates an equality filter from matching number bounds', () => {
    expect(numberRangeToGridFilter({ min: 10, max: 10 }))
      .toEqual({ type: 'equals', filter: 10 })
  })

  it('round-trips a date range using YYYY-MM-DD values', () => {
    const model = dateRangeToGridFilter({ from: '2026-07-01', to: '2026-07-30' })
    expect(model).toEqual({
      filterType: 'date', type: 'inRange', dateFrom: '2026-07-01', dateTo: '2026-07-30',
    })
    expect(gridDateFilterToRange(model)).toEqual({ from: '2026-07-01', to: '2026-07-30' })
  })

  it('builds real AG Grid models for all supported date range shapes', () => {
    expect(dateRangeToGridFilter({ from: '2026-07-01' })).toEqual({
      filterType: 'date', type: 'greaterThanOrEqual', dateFrom: '2026-07-01',
    })
    expect(dateRangeToGridFilter({ to: '2026-07-30' })).toEqual({
      filterType: 'date', type: 'lessThanOrEqual', dateFrom: '2026-07-30',
    })
    expect(gridDateFilterToRange({ filterType: 'date', type: 'greaterThanOrEqual', dateFrom: '2026-07-01' }))
      .toEqual({ from: '2026-07-01' })
    expect(gridDateFilterToRange({ filterType: 'date', type: 'lessThanOrEqual', dateFrom: '2026-07-30' }))
      .toEqual({ to: '2026-07-30' })
  })

  it('strips timestamps from a grid date filter', () => {
    expect(gridDateFilterToRange({ dateFrom: '2026-07-01 00:00:00', dateTo: '2026-07-30T23:59:59' }))
      .toEqual({ from: '2026-07-01', to: '2026-07-30' })
  })
})
