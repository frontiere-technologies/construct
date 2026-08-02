export function assertExactCatalogSection<T>(section: string, expected: T[], actual: T[]): void {
  const expectedRows = expected.map(value => JSON.stringify(value))
  const actualRows = actual.map(value => JSON.stringify(value))
  const missing = expectedRows.filter(value => !actualRows.includes(value))
  const unexpected = actualRows.filter(value => !expectedRows.includes(value))
  if (missing.length || unexpected.length) {
    throw new Error(`${section} drift: missing=${missing.join('|') || 'none'} unexpected=${unexpected.join('|') || 'none'}`)
  }
}
