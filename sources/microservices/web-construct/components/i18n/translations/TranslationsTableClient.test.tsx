import { renderToStaticMarkup } from 'react-dom/server'
import type { ColDef } from 'ag-grid-community'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranslationRowDto } from '@/lib/i18n/types'
import { TranslationsTableClient } from './TranslationsTableClient'

const captured = vi.hoisted(() => ({
  columnDefs: [] as ColDef<TranslationRowDto>[][],
}))

const pushed = vi.hoisted(() => ({ hrefs: [] as string[] }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: (href: string) => { pushed.hrefs.push(href) } }),
  usePathname: () => '/admin/translations',
  useSearchParams: () => new URLSearchParams('sort=key&direction=ASC'),
}))

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    fmt: { dateTime: (value: string) => value },
    languages: [
      { id: 1, code: 'it', locale: 'it-IT', name: 'Italian', nativeName: 'Italiano', isActive: true, isDefault: true },
    ],
  }),
}))

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
  beforeEach(() => { captured.columnDefs.length = 0; pushed.hrefs.length = 0 })

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
})
