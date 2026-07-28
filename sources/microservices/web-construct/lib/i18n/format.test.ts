import { describe, it, expect } from 'vitest'
import { createFormatters } from './format'

const it_ = createFormatters('it-IT')
const en = createFormatters('en-US')
const D = new Date(Date.UTC(2026, 6, 28, 14, 5, 0))

describe('createFormatters', () => {
  it('formats dates per locale', () => {
    expect(it_.date(D)).toBe('28/07/2026')
    expect(en.date(D)).toBe('07/28/2026')
  })
  it('formats times per locale', () => {
    expect(it_.time(D, 'UTC')).toBe('14:05')
    // `hour: '2-digit'` pads a single-digit hour, so en-US renders '02:05 PM', not '2:05 PM'.
    expect(en.time(D, 'UTC')).toBe('02:05 PM')
  })
  it('formats date+time per locale', () => {
    expect(it_.dateTime(D, 'UTC')).toBe('28/07/2026, 14:05')
    expect(en.dateTime(D, 'UTC')).toBe('07/28/2026, 02:05 PM')
  })
  it('formats numbers per locale', () => {
    expect(it_.number(1234567.89)).toBe('1.234.567,89')
    expect(en.number(1234567.89)).toBe('1,234,567.89')
  })
  it('formats percentages per locale', () => {
    expect(it_.percent(0.256)).toBe('25,6%')
    expect(en.percent(0.256)).toBe('25.6%')
  })
  it('formats currency per locale', () => {
    // it-IT's CLDR grouping strategy is `min2`: a four-digit run takes no thousands
    // separator, and the space before the symbol is U+00A0 (non-breaking), not U+0020.
    expect(it_.currency(1234.5, 'EUR')).toBe('1234,50 €')
    expect(en.currency(1234.5, 'USD')).toBe('$1,234.50')
  })
  it('formats relative time per locale', () => {
    expect(it_.relativeTime(-3, 'day')).toBe('3 giorni fa')
    expect(en.relativeTime(-3, 'day')).toBe('3 days ago')
  })
  it('renders null and undefined as an em dash rather than "Invalid Date"', () => {
    expect(it_.date(null)).toBe('—')
    expect(it_.dateTime(undefined)).toBe('—')
    expect(it_.number(null)).toBe('—')
  })
  it('accepts an ISO string as well as a Date', () => {
    expect(it_.date('2026-07-28T14:05:00.000Z')).toBe('28/07/2026')
  })
  it('renders an unparseable date as an em dash instead of throwing', () => {
    expect(it_.date('not-a-date')).toBe('—')
  })
  it('picks the plural category for the active locale', () => {
    expect(it_.plural(1)).toBe('one')
    expect(it_.plural(0)).toBe('other')
    expect(it_.plural(2)).toBe('other')
    expect(en.plural(1)).toBe('one')
    expect(en.plural(2)).toBe('other')
  })
})
