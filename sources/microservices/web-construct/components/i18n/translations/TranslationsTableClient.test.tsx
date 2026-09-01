// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ColDef } from 'ag-grid-community'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranslationRowDto } from '@/lib/i18n/types'
import { TranslationsTableClient } from './TranslationsTableClient'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const captured = vi.hoisted(() => ({
  columnDefs: [] as ColDef<TranslationRowDto>[][],
}))

const pushed = vi.hoisted(() => ({ hrefs: [] as string[] }))

// A mutable holder, not a fixed return value: the regression test below needs
// to change what useSearchParams() reports *between* two renders of the same
// mounted instance, to prove the columnDefs memo picks up the new query
// instead of a stale closure over the first render's sp.
const searchParamsHolder = vi.hoisted(() => ({ value: 'sort=key&direction=ASC' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: (href: string) => { pushed.hrefs.push(href) } }),
  usePathname: () => '/admin/translations',
  useSearchParams: () => new URLSearchParams(searchParamsHolder.value),
}))

// A single object built once and returned by reference on every call — not a
// fresh literal per render. The regression test below relies on every other
// useMemo dependency (t, fmt, languages) staying referentially stable across
// two renders of the same instance, so that only `sp`'s identity moves and
// the memo's recompute-or-not decision is actually about the fix under test.
vi.mock('@/context/I18nContext', () => {
  const i18n = {
    t: (key: string) => key,
    fmt: { dateTime: (value: string) => value },
    languages: [
      { id: 1, code: 'it', locale: 'it-IT', name: 'Italian', nativeName: 'Italiano', isActive: true, isDefault: true },
    ],
  }
  return { useI18n: () => i18n }
})

vi.mock('@/components/grid/DataGrid', () => ({
  DataGrid: (props: { columnDefs: ColDef<TranslationRowDto>[] }) => {
    captured.columnDefs.push(props.columnDefs)
    return null
  },
}))

vi.mock('@/components/grid/GridToolbar', () => ({ GridToolbar: () => null }))
vi.mock('@/components/grid/grid-url-sync', () => ({
  useGridUrlSync: () => ({ update: vi.fn() }),
}))
vi.mock('@/lib/i18n/translation-actions', () => ({ deleteTranslationKey: vi.fn() }))
vi.mock('./translations-datasource', () => ({ createTranslationsDatasource: () => ({ getRows: vi.fn() }) }))

describe('TranslationsTableClient column sizing', () => {
  beforeEach(() => { captured.columnDefs.length = 0 })

  it('uses create-only initial widths when URL-driven props rebuild column definitions', () => {
    const renderWithNamespaces = (namespaces: string[]) => renderToStaticMarkup(
      <TranslationsTableClient urlParams={{}} namespaces={namespaces} modules={[]} />,
    )

    renderWithNamespaces(['common'])
    renderWithNamespaces(['common', 'admin'])

    expect(captured.columnDefs).toHaveLength(2)
    for (const definitions of captured.columnDefs) {
      expect(definitions.find(column => column.field === 'key')).toMatchObject({ initialWidth: 260 })
      expect(definitions.find(column => column.field === 'description')).toMatchObject({ initialWidth: 200 })
      expect(definitions.find(column => column.colId === 'value_it')).toMatchObject({ initialWidth: 200 })

      expect(definitions.find(column => column.field === 'key')).not.toHaveProperty('width')
      expect(definitions.find(column => column.field === 'description')).not.toHaveProperty('width')
      expect(definitions.find(column => column.colId === 'value_it')).not.toHaveProperty('width')
    }
  })
})

describe('TranslationsTableClient row actions', () => {
  beforeEach(() => {
    captured.columnDefs.length = 0
    pushed.hrefs.length = 0
    searchParamsHolder.value = 'sort=key&direction=ASC'
  })

  it('sends Modifica to the edit page, carrying the grid query', () => {
    renderToStaticMarkup(<TranslationsTableClient urlParams={{}} namespaces={['common']} modules={[]} />)

    const actions = captured.columnDefs[0].find(column => column.colId === 'actions')
    const getItems = (actions?.cellRendererParams as { getItems: (row: TranslationRowDto) => { label: string; onClick: () => void }[] }).getItems
    const items = getItems({ id: 42 } as unknown as TranslationRowDto)

    items.find(item => item.label === 'common.actions.edit')?.onClick()

    expect(pushed.hrefs).toHaveLength(1)
    const from = new URLSearchParams(pushed.hrefs[0].split('?')[1]).get('from')
    expect(pushed.hrefs[0].startsWith('/admin/translations/42/edit?')).toBe(true)
    expect(new URLSearchParams(from ?? '').get('sort')).toBe('key')
    expect(new URLSearchParams(from ?? '').get('direction')).toBe('ASC')
  })

  it('leaves Elimina as an in-place action, not a navigation', () => {
    renderToStaticMarkup(<TranslationsTableClient urlParams={{}} namespaces={['common']} modules={[]} />)

    const actions = captured.columnDefs[0].find(column => column.colId === 'actions')
    const getItems = (actions?.cellRendererParams as { getItems: (row: TranslationRowDto) => { label: string; onClick: () => void }[] }).getItems
    getItems({ id: 42 } as unknown as TranslationRowDto).find(item => item.label === 'common.actions.delete')?.onClick()

    expect(pushed.hrefs).toEqual([])
  })

  it('carries the query as it stands at click time, not a snapshot from the first render', () => {
    // renderToStaticMarkup mounts a fresh instance per call, so it can never
    // observe a stale useMemo closure — there is no prior render to bail out
    // against. A real client root, reused across two renders, is what
    // exercises the columnDefs memo's dependency array for real.
    // Stable references, reused across both renders: the point of this test
    // is to isolate `sp` as the only thing that moves. A fresh array literal
    // per render would itself force the memo to recompute regardless of the
    // fix, and prove nothing.
    const namespaces = ['common']
    const modules: string[] = []
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    act(() => root.render(<TranslationsTableClient urlParams={{}} namespaces={namespaces} modules={modules} />))

    searchParamsHolder.value = 'sort=namespace&direction=DESC'
    act(() => root.render(<TranslationsTableClient urlParams={{}} namespaces={namespaces} modules={modules} />))

    act(() => root.unmount())
    container.remove()

    expect(captured.columnDefs.length).toBeGreaterThanOrEqual(2)
    const latest = captured.columnDefs[captured.columnDefs.length - 1]
    const actions = latest.find(column => column.colId === 'actions')
    const getItems = (actions?.cellRendererParams as { getItems: (row: TranslationRowDto) => { label: string; onClick: () => void }[] }).getItems
    getItems({ id: 42 } as unknown as TranslationRowDto).find(item => item.label === 'common.actions.edit')?.onClick()

    expect(pushed.hrefs).toHaveLength(1)
    const from = new URLSearchParams(pushed.hrefs[0].split('?')[1]).get('from')
    expect(new URLSearchParams(from ?? '').get('sort')).toBe('namespace')
    expect(new URLSearchParams(from ?? '').get('direction')).toBe('DESC')
  })
})
