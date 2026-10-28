import { describe, expect, it } from 'vitest'
import { platformAuditGridQuerySchema } from '@/lib/platform/audit-grid-query-schema'
import {
  auditFilterModelToSearchParams, auditUrlParamsToFilterModel, auditUrlParamsToSortModel,
  buildAuditGridQuery, parseAuditGridUrlParams,
} from './audit-grid-query'
import { AUDIT_GRID_MAX_PAGE_SIZE, auditGridQuerySchema } from './audit-grid-query-schema'

/**
 * La griglia del registro (specifica 2026-10-26, MT5-DEC-16): dal modello dei filtri di ag-grid alla
 * richiesta, dalla richiesta all'indirizzo della pagina e ritorno, e che cosa lo schema accetta.
 */
describe('buildAuditGridQuery', () => {
  it('maps the period, the person, the operation, the sort and the page', () => {
    const query = buildAuditGridQuery(100, 50, [{ colId: 'actor', sort: 'asc' }], {
      occurredAt: { dateFrom: '2026-07-01 00:00:00', dateTo: '2026-07-30 00:00:00' },
      actor: { filter: 'ada@' },
      operation: { value: 'role.create' },
    })
    expect(query).toEqual({
      page: 2, size: 50, actorSearch: 'ada@', operation: 'role.create', from: '2026-07-01', to: '2026-07-30',
      sort: 'actor', direction: 'ASC',
    })
  })

  it('sorts by time, newest first, by default and leaves out filters that were not set', () => {
    const query = buildAuditGridQuery(0, 50, [], {})
    expect(query).toEqual({ page: 0, size: 50, sort: 'occurredAt', direction: 'DESC' })
  })

  it('drops an operation that is not a known code and a sort that is not listed', () => {
    const query = buildAuditGridQuery(0, 50, [{ colId: 'id_tenant', sort: 'asc' }], { operation: { value: 'drop.table' } })
    expect(query.operation).toBeUndefined()
    expect(query.sort).toBe('occurredAt')
  })
})

describe('the page address', () => {
  it('round-trips the filters through the URL', () => {
    const model = {
      occurredAt: { filterType: 'date' as const, type: 'inRange' as const, dateFrom: '2026-07-01', dateTo: '2026-07-30' },
      actor: { filter: 'ada' },
      operation: { value: 'menu.move' },
    }
    const params = auditFilterModelToSearchParams(model)
    expect(params).toMatchObject({ search: 'ada', operation: 'menu.move', from: '2026-07-01', to: '2026-07-30' })
    const parsed = parseAuditGridUrlParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null)) as Record<string, string>)
    expect(auditUrlParamsToFilterModel(parsed)).toEqual(model)
  })

  it('ignores a malformed date, an inverted period, an unknown operation and an unlisted sort', () => {
    expect(parseAuditGridUrlParams({ from: '2026-02-30' }).from).toBeNull()
    const inverted = parseAuditGridUrlParams({ from: '2026-07-30', to: '2026-07-01' })
    expect([inverted.from, inverted.to]).toEqual([null, null])
    expect(parseAuditGridUrlParams({ operation: 'nope' }).operation).toBeNull()
    expect(parseAuditGridUrlParams({ sort: 'details' }).sortField).toBe('occurredAt')
  })

  it('turns the sort into the grid model', () => {
    expect(auditUrlParamsToSortModel(parseAuditGridUrlParams({ sort: 'operation', direction: 'ASC' }))).toEqual([{ colId: 'operation', sort: 'asc' }])
    expect(auditUrlParamsToSortModel(parseAuditGridUrlParams({}))).toEqual([{ colId: 'occurredAt', sort: 'desc' }])
  })
})

describe('auditGridQuerySchema', () => {
  const ok = { page: 0, size: 50 }

  it('accepts a plain page and every filter', () => {
    expect(auditGridQuerySchema.safeParse(ok).success).toBe(true)
    expect(auditGridQuerySchema.safeParse({
      ...ok, actorSearch: { operator: 'OR', conditions: ['a', 'b'] }, operation: 'language.delete', from: '2026-01-01', to: '2026-12-31',
      sort: 'operation', direction: 'DESC',
    }).success).toBe(true)
  })

  it.each([
    ['a page size over the cap', { size: AUDIT_GRID_MAX_PAGE_SIZE + 1 }],
    ['a negative page', { page: -1 }],
    ['an operation that does not exist', { operation: 'role.explode' }],
    ['a sort column that is not listed', { sort: 'id_tenant' }],
    ['an inverted period', { from: '2026-07-30', to: '2026-07-01' }],
    ['a date that does not exist', { from: '2026-02-30' }],
    ['the unsupported terminal date', { to: '9999-12-31' }],
    ['a search text that is too long', { actorSearch: 'x'.repeat(201) }],
  ])('rejects %s', (_label, bad) => {
    expect(auditGridQuerySchema.safeParse({ ...ok, ...bad }).success).toBe(false)
  })

  it('lets the platform schema take a scope, and only the two known ones', () => {
    expect(platformAuditGridQuerySchema.safeParse({ ...ok, scope: 'template' }).success).toBe(true)
    expect(platformAuditGridQuerySchema.safeParse({ ...ok, scope: 'platform' }).success).toBe(true)
    expect(platformAuditGridQuerySchema.safeParse({ ...ok, scope: 'tenant' }).success).toBe(false)
    expect(auditGridQuerySchema.safeParse({ ...ok, scope: 'template' }).success).toBe(true) // le chiavi in più si ignorano
  })
})
