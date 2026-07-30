import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
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
  it('wires the reset button click to the supplied clear callback', () => {
    const onClearFilters = vi.fn()
    const button = GridToolbarResetButton({ label: 'Reimposta filtri', onClearFilters })

    expect(button.props.children).toBe('Reimposta filtri')
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
