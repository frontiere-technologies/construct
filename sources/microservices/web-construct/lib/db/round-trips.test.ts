import { describe, expect, it } from 'vitest'
import { countRoundTrips } from './round-trips'

describe('countRoundTrips', () => {
  it('counts one trip without parameters and two with parameters', () => {
    expect(countRoundTrips([
      { query: 'begin', parameterCount: 0 },
      { query: 'select 1 where x = $1', parameterCount: 1 },
      { query: 'commit', parameterCount: 0 },
    ])).toEqual({ statements: 3, roundTrips: 4, queries: ['begin', 'select 1 where x = $1', 'commit'] })
  })

  it('counts nothing for nothing', () => {
    expect(countRoundTrips([])).toEqual({ statements: 0, roundTrips: 0, queries: [] })
  })
})
