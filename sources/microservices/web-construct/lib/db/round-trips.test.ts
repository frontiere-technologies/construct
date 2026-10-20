import { describe, expect, it } from 'vitest'
import { answersBetween, countRoundTrips, type TripEvent } from './round-trips'

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

describe('answersBetween', () => {
  const sent = (query: string): TripEvent => ({ type: 'sent', query })
  const answer: TripEvent = { type: 'answer' }

  it('is 0 when the second statement is sent before any answer', () => {
    const events = [sent('begin'), answer, sent('select a'), sent('select b'), answer, answer, sent('commit')]
    expect(answersBetween(events, /select a/, /select b/)).toBe(0)
  })

  it('counts the answers that came back before the second statement was sent', () => {
    const events = [sent('select a'), answer, answer, sent('select b'), answer]
    expect(answersBetween(events, /select a/, /select b/)).toBe(2)
  })

  it('looks for the second statement only after the first one', () => {
    const events = [sent('select b'), sent('select a'), answer, sent('select b')]
    expect(answersBetween(events, /select a/, /select b/)).toBe(1)
  })

  it('fails loudly when a statement is missing', () => {
    expect(() => answersBetween([sent('select a')], /select a/, /select b/)).toThrow(/select b/)
    expect(() => answersBetween([], /select a/, /select b/)).toThrow(/select a/)
  })
})
