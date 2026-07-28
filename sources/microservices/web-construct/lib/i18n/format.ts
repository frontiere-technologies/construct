export type DateLike = Date | string | number | null | undefined

const EMPTY = '—'

function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export interface Formatters {
  date(value: DateLike, timeZone?: string): string
  time(value: DateLike, timeZone?: string): string
  dateTime(value: DateLike, timeZone?: string): string
  number(value: number | null | undefined): string
  percent(value: number | null | undefined): string
  currency(value: number | null | undefined, currency: string): string
  relativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string
  /**
   * The CLDR plural category for `count` in the active locale, so a caller can
   * pick between keys like `users.count.one` and `users.count.other` instead of
   * hardcoding an English `n === 1` rule that is wrong in most languages.
   */
  plural(count: number): Intl.LDMLPluralRule
}

/**
 * Every localized value in the UI goes through these — never through manual
 * concatenation of a value and a symbol (§8.2). Built once per request and
 * carried on the i18n bundle, so `Intl` objects are not re-created per call.
 */
export function createFormatters(locale: string): Formatters {
  const dateFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const numberFmt = new Intl.NumberFormat(locale)
  const percentFmt = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const relativeFmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const pluralRules = new Intl.PluralRules(locale)
  const currencyFmts = new Map<string, Intl.NumberFormat>()

  // `hour: 'numeric'`, not '2-digit': zero-padding is right for a 24-hour locale
  // but produces "02:05 PM" in en-US, which no English speaker writes. 'numeric'
  // still renders "14:05" for it-IT (two digits already) and "2:05 PM" for en-US.
  const TIME_FIELDS = { hour: 'numeric', minute: '2-digit' } as const
  const DATE_FIELDS = { day: '2-digit', month: '2-digit', year: 'numeric' } as const

  // Cached per time zone, exactly like `currencyFmts` below: `timeZone` is a
  // variable parameter, so without a cache every call in a list of timestamps
  // would construct a fresh Intl.DateTimeFormat.
  const timeFmts = new Map<string, Intl.DateTimeFormat>()
  const dateTimeFmts = new Map<string, Intl.DateTimeFormat>()
  const zonedDateFmts = new Map<string, Intl.DateTimeFormat>()

  const cached = (
    cache: Map<string, Intl.DateTimeFormat>,
    timeZone: string | undefined,
    options: Intl.DateTimeFormatOptions,
  ): Intl.DateTimeFormat => {
    // `|| undefined`, not `?? ''`: an empty string is not a valid IANA zone, so
    // normalizing it to "no zone" keeps a caller that passes '' for "unset" from
    // either throwing or silently sharing the default zone's cache entry.
    const zone = timeZone || undefined
    const key = zone ?? ''
    let fmt = cache.get(key)
    if (!fmt) {
      fmt = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone })
      cache.set(key, fmt)
    }
    return fmt
  }

  return {
    date(value, timeZone) {
      const d = toDate(value)
      if (!d) return EMPTY
      return timeZone ? cached(zonedDateFmts, timeZone, DATE_FIELDS).format(d) : dateFmt.format(d)
    },
    time(value, timeZone) {
      const d = toDate(value)
      return d ? cached(timeFmts, timeZone, TIME_FIELDS).format(d) : EMPTY
    },
    dateTime(value, timeZone) {
      const d = toDate(value)
      return d ? cached(dateTimeFmts, timeZone, { ...DATE_FIELDS, ...TIME_FIELDS }).format(d) : EMPTY
    },
    number(value) {
      return value === null || value === undefined || Number.isNaN(value) ? EMPTY : numberFmt.format(value)
    },
    percent(value) {
      return value === null || value === undefined || Number.isNaN(value) ? EMPTY : percentFmt.format(value)
    },
    currency(value, currency) {
      if (value === null || value === undefined || Number.isNaN(value)) return EMPTY
      let fmt = currencyFmts.get(currency)
      if (!fmt) {
        fmt = new Intl.NumberFormat(locale, { style: 'currency', currency })
        currencyFmts.set(currency, fmt)
      }
      return fmt.format(value)
    },
    relativeTime(value, unit) {
      return relativeFmt.format(value, unit)
    },
    plural(count) {
      return pluralRules.select(count)
    },
  }
}
