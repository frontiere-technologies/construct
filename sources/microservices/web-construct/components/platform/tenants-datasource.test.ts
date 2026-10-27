import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTenantsDatasource } from './tenants-datasource'

// La griglia vera tira dentro ag-grid e il contesto delle lingue: qui basta la dimensione del blocco.
vi.mock('@/components/grid/DataGrid', () => ({ GRID_BLOCK_SIZE: 50 }))

/** Il collegamento fra la griglia e la rotta: blocco richiesto, risposta riportata alla griglia. */
function params(overrides: Record<string, unknown> = {}) {
  return {
    startRow: 0, endRow: 50, sortModel: [], filterModel: {}, context: undefined,
    successCallback: vi.fn(), failCallback: vi.fn(),
    ...overrides,
  }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => vi.unstubAllGlobals())

describe('createTenantsDatasource', () => {
  it('posts the query to the tenants route and hands the rows to the grid', async () => {
    const rows = [{ id: 1, name: 'Modello' }]
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ rows, total: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const p = params({ sortModel: [{ colId: 'slug', sort: 'desc' }], filterModel: { status: { value: 'suspended' } } })

    createTenantsDatasource().getRows(p as never)
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/platform/tenants-grid')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({ page: 0, status: 'suspended', sort: 'slug', direction: 'DESC' })
    expect(p.successCallback).toHaveBeenCalledWith(rows, 1)
    expect(p.failCallback).not.toHaveBeenCalled()
  })

  it('leaves the last row open while there may be more pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ rows: [{ id: 1 }], total: 500 }), { status: 200 })))
    const p = params()
    createTenantsDatasource().getRows(p as never)
    await flush()
    expect(p.successCallback).toHaveBeenCalledWith([{ id: 1 }], undefined)
  })

  it('fails the block when the route refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    const p = params()
    createTenantsDatasource().getRows(p as never)
    await flush()
    expect(p.failCallback).toHaveBeenCalled()
    expect(p.successCallback).not.toHaveBeenCalled()
  })
})
