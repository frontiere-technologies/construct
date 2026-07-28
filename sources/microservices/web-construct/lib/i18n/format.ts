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

  const timeFmt = (timeZone?: string) =>
    new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone })
  const dateTimeFmt = (timeZone?: string) =>
    new Intl.DateTimeFormat(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone,
    })

  return {
    date(value, timeZone) {
      const d = toDate(value)
      if (!d) return EMPTY
      return timeZone
        ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).format(d)
        : dateFmt.format(d)
    },
    time(value, timeZone) {
      const d = toDate(value)
      return d ? timeFmt(timeZone).format(d) : EMPTY
    },
    dateTime(value, timeZone) {
      const d = toDate(value)
      return d ? dateTimeFmt(timeZone).format(d) : EMPTY
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
