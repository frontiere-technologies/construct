import { describe, expect, it } from 'vitest'
import { resetGridFilters } from './grid-reset'

describe('resetGridFilters', () => {
  it('clears the AG Grid model before clearing URL params', () => {
    const calls: string[] = []
    resetGridFilters({ setFilterModel: value => { expect(value).toBeNull(); calls.push('grid') } }, () => calls.push('url'))
    expect(calls).toEqual(['grid', 'url'])
  })

  it('clears URL params when no grid API is available', () => {
    const calls: string[] = []
    resetGridFilters(null, () => calls.push('url'))
    expect(calls).toEqual(['url'])
  })
})
