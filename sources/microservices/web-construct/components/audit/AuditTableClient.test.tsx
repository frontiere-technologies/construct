// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ColDef } from 'ag-grid-community'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditRow, AuditUrlParams } from '@/lib/audit/audit-grid-query'
import { AUDIT_OPERATIONS } from '@/lib/audit/audit-types'
import { AuditTableClient } from './AuditTableClient'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** La griglia vera (ag-grid) non si disegna in jsdom: qui se ne legge la configurazione (MT5-DEC-16). */
const grid = vi.hoisted(() => ({ props: null as null | { columnDefs: ColDef<AuditRow>[]; initialFilterModel?: unknown; initialSortModel?: unknown; onFilterChanged?: (e: unknown) => void } }))
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock('@/components/grid/DataGrid', () => ({
  GRID_BLOCK_SIZE: 50,
  DataGrid: (props: NonNullable<typeof grid.props>) => { grid.props = props; return <div data-testid="grid" /> },
}))
vi.mock('@/components/grid/GridToolbar', () => ({ GridToolbar: () => <div data-testid="toolbar" /> }))
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/admin/audit',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({ t: (key: string) => key, fmt: { dateTime: (value: string) => `dt:${value}` } }),
}))

const defaults: AuditUrlParams = { search: '', operation: null, from: null, to: null, sortField: 'occurredAt', sortDir: 'DESC' }
const row: AuditRow = {
  id: '1', occurredAt: '2026-07-01T10:00:00.000Z', actorEmail: 'ada@example.test', actorKind: 'platform', operation: 'menu.update',
  objectType: 'menu', objectId: '9', details: { name: 'Home' }, tenantId: 4, tenantName: 'Acme',
}

let root: Root | undefined
let container: HTMLDivElement | undefined
beforeEach(() => { grid.props = null; nav.replace.mockReset() })
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.replaceChildren()
})

function render(props: Partial<React.ComponentProps<typeof AuditTableClient>> = {}) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<AuditTableClient {...defaults} endpoint="/api/audit/tenant-grid" {...props} />))
  return grid.props!
}

const column = (props: NonNullable<typeof grid.props>, id: string) => props.columnDefs.find(def => def.colId === id)!

function cell(def: ColDef<AuditRow>, data: AuditRow): HTMLElement {
  const holder = document.createElement('div')
  document.body.append(holder)
  const Renderer = def.cellRenderer as React.FC<{ data?: AuditRow }>
  act(() => createRoot(holder).render(<Renderer data={data} />))
  return holder
}

describe('AuditTableClient', () => {
  it('shows the tenant columns without the tenant one', () => {
    expect(render().columnDefs.map(def => def.headerName)).toEqual([
      'audit.col.time', 'audit.col.actor', 'audit.col.kind', 'audit.col.operation', 'audit.col.object', 'audit.col.details',
    ])
  })

  it('adds the tenant column in the platform audit, with a link to the tenant page', () => {
    const props = render({ endpoint: '/api/platform/audit-grid', showTenant: true })
    expect(props.columnDefs.map(def => def.headerName)).toContain('audit.col.tenant')
    const link = cell(column(props, 'tenant'), row).querySelector('a')
    expect(link?.getAttribute('href')).toBe('/platform/tenants/4')
    expect(link?.textContent).toBe('Acme')
    expect(cell(column(props, 'tenant'), { ...row, tenantId: null, tenantName: null }).textContent).toBe('')
  })

  it('offers every operation code as a filter, labelled, and sorts only on time, person and operation', () => {
    const props = render()
    const options = (column(props, 'operation').filterParams as { options: { value: string; label: string }[] }).options
    expect(options.map(option => option.value)).toEqual([...AUDIT_OPERATIONS])
    expect(options[0].label).toBe(`audit.operation.${AUDIT_OPERATIONS[0]}`)
    expect(props.columnDefs.filter(def => def.sortable).map(def => def.colId)).toEqual(['occurredAt', 'actor', 'operation'])
  })

  it('shows the capacity, the operation label and the object as text, and the details as compact JSON', () => {
    const props = render()
    const valueOf = (id: string) => (column(props, id).valueGetter as (p: { data: AuditRow }) => string)({ data: row })
    expect(valueOf('kind')).toBe('audit.kind.platform')
    expect(valueOf('operation')).toBe('audit.operation.menu.update')
    expect(valueOf('object')).toBe('menu 9')
    expect(cell(column(props, 'details'), row).textContent).toBe('{"name":"Home"}')
    expect(cell(column(props, 'details'), { ...row, details: {} }).textContent).toBe('')
  })

  it('starts from the filters and the sort of the address, newest first by default', () => {
    expect(render().initialSortModel).toEqual([{ colId: 'occurredAt', sort: 'desc' }])
    const props = render({ search: 'ada', operation: 'role.create', from: '2026-07-01', to: null })
    expect(props.initialFilterModel).toMatchObject({ actor: { filter: 'ada' }, operation: { value: 'role.create' } })
  })

  it('keeps the filters out of the address when it sits inside another page', () => {
    const props = render({ syncUrl: false })
    act(() => props.onFilterChanged?.({ api: { getFilterModel: () => ({ actor: { filter: 'x' } }) } }))
    expect(nav.replace).not.toHaveBeenCalled()
  })
})
