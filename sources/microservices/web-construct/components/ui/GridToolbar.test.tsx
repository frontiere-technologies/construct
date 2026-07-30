import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as I18nContext from '@/context/I18nContext'
import { I18nProvider } from '@/context/I18nContext'
import GridToolbar, { GridToolbarResetButton } from './GridToolbar'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/i18n/user-language-actions', () => ({ setPreferredLanguage: vi.fn() }))

const bundle = {
  language: { id: 1, code: 'it', locale: 'it-IT', name: 'Italiano', nativeName: 'Italiano', isActive: true, isDefault: true },
  languages: [],
  dict: {
    'common.actions.reset_filters': 'Reimposta filtri',
    'common.labels.columns': 'Colonne',
  },
  defaultDict: {},
  isDev: false,
}

describe('GridToolbar', () => {
  afterEach(() => vi.restoreAllMocks())

  it('forwards its supplied clear callback to the reset action', () => {
    vi.spyOn(I18nContext, 'useI18n').mockReturnValue({
      t: (key: string) => `translated:${key}`,
    } as ReturnType<typeof I18nContext.useI18n>)
    const onClearFilters = vi.fn()

    const toolbar = GridToolbar({ gridApi: null, columns: [], onClearFilters })
    const resetAction = toolbar.props.children[0]
    expect(resetAction.type).toBe(GridToolbarResetButton)

    const button = GridToolbarResetButton(resetAction.props)
    button.props.onClick()
    expect(onClearFilters).toHaveBeenCalledOnce()
  })

  it('wires the reset button click to the supplied clear callback', () => {
    const onClearFilters = vi.fn()
    const button = GridToolbarResetButton({ label: 'Reimposta filtri', onClearFilters })

    expect(button.props.children).toBe('Reimposta filtri')
    expect(button.props.type).toBe('button')
    button.props.onClick()
    expect(onClearFilters).toHaveBeenCalledOnce()
  })

  it('renders the translated reset action, column toggle, and children through the i18n provider', () => {
    const html = renderToStaticMarkup(
      <I18nProvider bundle={bundle}>
        <GridToolbar gridApi={null} columns={[{ colId: 'email', label: 'Email' }]} onClearFilters={() => undefined}>
          <span>Extra actions</span>
        </GridToolbar>
      </I18nProvider>,
    )

    expect(html).toContain('Reimposta filtri')
    expect(html).toContain('Colonne')
    expect(html).toContain('Extra actions')
  })
})
