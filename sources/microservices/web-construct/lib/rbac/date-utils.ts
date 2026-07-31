/** The exclusive SQL bound must stay inside PostgreSQL's four-digit date range. */
export const MAX_RBAC_INCLUSIVE_DATE_TO = '9999-12-30'

export function isSupportedRbacInclusiveDateTo(value: string): boolean {
  return value <= MAX_RBAC_INCLUSIVE_DATE_TO
}

export function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
