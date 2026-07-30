import { describe, expect, it } from 'vitest'
import { DATE_FILTER, NUMBER_FILTER, TEXT_FILTER } from './gridColumnFilters'

describe('shared grid filter presets', () => {
  it('uses a contains text filter with explicit apply and reset controls', () => {
    expect(TEXT_FILTER).toMatchObject({
      filter: 'agTextColumnFilter',
      filterParams: { filterOptions: ['contains'], buttons: ['apply', 'reset'] },
    })
  })

  it('uses equality and range options for number filters', () => {
    expect(NUMBER_FILTER).toMatchObject({
      filter: 'agNumberColumnFilter',
      filterParams: { filterOptions: ['equals', 'inRange'], buttons: ['apply', 'reset'] },
    })
  })

  it('uses a range-only date filter with explicit apply and reset controls', () => {
    expect(DATE_FILTER).toMatchObject({
      filter: 'agDateColumnFilter',
      filterParams: { filterOptions: ['inRange'], buttons: ['apply', 'reset'] },
    })
  })
})
