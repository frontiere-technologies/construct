import { expect, it } from 'vitest'
import { assertExactCatalogSection } from './schema-contract'

it('fails closed on a deliberately mismatched deployed catalog fixture', () => {
  const drizzleColumns = [{ table: 'users', column: 'email', type: 'text' }]
  const deployedColumns = [{ table: 'users', column: 'email', type: 'uuid' }]
  expect(() => assertExactCatalogSection('columns', drizzleColumns, deployedColumns))
    .toThrow(/columns drift:.*text.*uuid/)
})
