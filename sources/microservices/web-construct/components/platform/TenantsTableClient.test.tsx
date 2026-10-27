// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ColDef } from 'ag-grid-community'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformTenantRow, TenantsUrlParams } from '@/lib/platform/tenants-grid-query'
import { TenantsTableClient } from './TenantsTableClient'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * La griglia vera (ag-grid) non si disegna in jsdom: qui se ne legge la configurazione, cioè le
 * colonne, i filtri e come ogni cella mostra una riga (specifica 2026-10-26, MT5-DEC-4).
 */
const grid = vi.hoisted(() => ({ props: null as null | { columnDefs: ColDef<PlatformTenantRow>[]; initialFilterModel?: unknown; initialSortModel?: unknown; onRowClicked?: (row: PlatformTenantRow) => void } }))
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock('@/components/grid/DataGrid', () => ({
  GRID_BLOCK_SIZE: 50,
  DataGrid: (props: NonNullable<typeof grid.props>) => { grid.props = props; return <div data-testid="grid" /> },
}))
vi.mock('@/components/grid/GridToolbar', () => ({ GridToolbar: () => <div data-testid="toolbar" /> }))
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/platform',
  useSearchParams: () => new URLSearchParams(),
}))
// Il modulo vero è una server action: arriva al database, che qui non c'è.
vi.mock('@/lib/platform/tenant-actions', () => ({ createTenant: vi.fn() }))
vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({ t: (key: string) => key, fmt: { date: (value: string) => `date:${value}` } }),
}))

const base: PlatformTenantRow = {
  id: 7, slug: 'acme', name: 'Acme', status: 'active', isTemplate: false, primaryHost: 'acme.example.test',
  activeMembers: 3, adminEmails: ['a@acme.test', 'b@acme.test'], createdAt: '2026-07-01T10:00:00Z',
}

const defaultProps: TenantsUrlParams = {
  sortField: 'name', sortDir: 'ASC',
  search: '', search2: '', searchOperator: null,
  slugSearch: '', slugSearch2: '', slugSearchOperator: null,
  hostSearch: '', hostSearch2: '', hostSearchOperator: null,
  status: null, createdFrom: null, createdTo: null,
}

let root: Root | undefined
let container: HTMLDivElement | undefined

beforeEach(() => { grid.props = null; nav.push.mockReset() })
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.replaceChildren()
})

function render(props: Partial<typeof defaultProps> = {}) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<TenantsTableClient {...defaultProps} {...props} />))
  return grid.props!
}

const column = (props: NonNullable<typeof grid.props>, key: string) =>
  props.columnDefs.find(def => def.field === key || def.colId === key)!

function cell(def: ColDef<PlatformTenantRow>, data: PlatformTenantRow): HTMLElement {
  const holder = document.createElement('div')
  document.body.append(holder)
  const cellRoot = createRoot(holder)
  const Renderer = def.cellRenderer as React.FC<{ data?: PlatformTenantRow }>
  act(() => cellRoot.render(<Renderer data={data} />))
  return holder
}

describe('TenantsTableClient', () => {
  it('shows the columns of MT5-DEC-4 with translated headers', () => {
    const props = render()
    expect(props.columnDefs.map(def => def.headerName)).toEqual([
      'platform.tenants.name', 'platform.tenants.slug', 'platform.tenants.host', 'platform.tenants.status',
      'platform.tenants.members', 'platform.tenants.admins', 'platform.tenants.created_at',
    ])
  })

  it('marks the template tenant apart', () => {
    const props = render()
    const marked = cell(column(props, 'name'), { ...base, isTemplate: true, name: 'Modello', slug: 'template' })
    expect(marked.textContent).toContain('Modello')
    expect(marked.querySelector('[data-testid="tenant-template-badge"]')?.textContent).toBe('platform.tenants.template_badge')
    expect(cell(column(props, 'name'), base).querySelector('[data-testid="tenant-template-badge"]')).toBe(null)
  })

  it('shows the status as a badge and the administrators as their emails', () => {
    const props = render()
    expect(cell(column(props, 'status'), { ...base, status: 'suspended' })
      .querySelector('[data-testid="tenant-status-badge"]')?.getAttribute('data-status')).toBe('suspended')
    expect(cell(column(props, 'adminEmails'), base).textContent).toBe('a@acme.test, b@acme.test')
  })

  it('shows a dash for a tenant without a dedicated address, and the date through the formatter', () => {
    const props = render()
    const host = column(props, 'primaryHost').valueGetter as (p: { data?: PlatformTenantRow }) => string
    expect(host({ data: { ...base, primaryHost: null } })).toBe('—')
    expect(host({ data: base })).toBe('acme.example.test')
    const created = column(props, 'createdAt').valueGetter as (p: { data?: PlatformTenantRow }) => string
    expect(created({ data: base })).toBe('date:2026-07-01T10:00:00Z')
  })

  it('cannot sort by the numbers that are counted one tenant at a time', () => {
    const props = render()
    expect(column(props, 'activeMembers').sortable).toBe(false)
    expect(column(props, 'adminEmails').sortable).toBe(false)
    expect(column(props, 'name').sortable).toBe(true)
  })

  it('offers the three statuses as a filter and starts from the address of the page', () => {
    const props = render({ status: 'archived', search: 'Ac' })
    const status = column(props, 'status')
    expect((status.filterParams as { options: { value: string }[] }).options.map(option => option.value))
      .toEqual(['active', 'suspended', 'archived'])
    expect(props.initialFilterModel).toMatchObject({ status: { value: 'archived' }, name: { filter: 'Ac' } })
    expect(props.initialSortModel).toEqual([{ colId: 'name', sort: 'asc' }])
  })

  it('opens the tenant page when a row is clicked', () => {
    const props = render()
    props.onRowClicked!(base)
    expect(nav.push).toHaveBeenCalledWith('/platform/tenants/7')
  })

  it('opens the new-tenant dialog from the "New tenant" button', () => {
    render()
    const button = container!.querySelector<HTMLButtonElement>('[data-testid="new-tenant"]')!
    expect(button.textContent).toBe('platform.tenants.new')
    expect(document.querySelector('[role="dialog"]')).toBe(null)
    act(() => button.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('platform.tenant.new.title')
  })
})
