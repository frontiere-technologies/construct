import { renderToStaticMarkup } from 'react-dom/server'
import type { ColDef } from 'ag-grid-community'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranslationRowDto } from '@/lib/i18n/types'
import TranslationsTableClient from './TranslationsTableClient'

const captured = vi.hoisted(() => ({
  columnDefs: [] as ColDef<TranslationRowDto>[][],
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
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

vi.mock('@/components/ui/DataGrid', () => ({
  default: (props: { columnDefs: ColDef<TranslationRowDto>[] }) => {
    captured.columnDefs.push(props.columnDefs)
    return null
  },
}))

vi.mock('@/components/ui/GridToolbar', () => ({ default: () => null }))
vi.mock('@/components/ui/grid-url-sync', () => ({
  useGridUrlSync: () => ({ update: vi.fn() }),
}))
vi.mock('@/lib/i18n/translation-actions', () => ({ deleteTranslationKey: vi.fn() }))
vi.mock('./translationsDatasource', () => ({ createTranslationsDatasource: () => ({ getRows: vi.fn() }) }))

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
