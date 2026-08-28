import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultThemeConfig } from '@/types/menu'
import { themeContrastViolations } from '@/lib/theme-vars'
import { ContrastRejection, tokenLabel, type TokenGroup } from './AdminTheme'

// Il pannello e i suoi context incatenano moduli 'use server' -> '@/lib/auth'
// -> next-auth, che l'ambiente node di vitest non risolve (probe di
// 'next/server'). Stessa medicina di NavigationTree.test.ts: si stubbano i
// confini, perche' qui servono solo i due pezzi puri del file.
vi.mock('@/lib/theme-actions', () => ({ saveThemeConfig: vi.fn(), loadThemeConfig: vi.fn() }))
vi.mock('@/context/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/context/UIContext', () => ({ useUI: () => ({ settings: {}, setSettings: vi.fn() }) }))

/**
 * Il rifiuto per contrasto, dal lato del pannello.
 *
 * La matematica sta in `lib/theme-vars.test.ts` e il rifiuto in
 * `lib/theme-actions.ts`. Qui si prova la parte che l'amministratore legge: che
 * i colori in difetto arrivino con il nome della riga da riaprire, non con la
 * chiave di ThemeConfig, e con il rapporto misurato accanto.
 */

const groups: TokenGroup[] = [
  {
    key: 'text',
    title: 'Testo',
    rows: [
      { key: 'foregroundFaint', label: 'Testo tenue', lightKey: 'foregroundFaintLight', darkKey: 'foregroundFaintDark' },
    ],
  },
]

describe('tokenLabel', () => {
  it('names the light and the dark half of a row distinctly', () => {
    expect(tokenLabel(groups, 'foregroundFaintLight', 'chiaro', 'scuro')).toBe('Testo tenue (chiaro)')
    expect(tokenLabel(groups, 'foregroundFaintDark', 'chiaro', 'scuro')).toBe('Testo tenue (scuro)')
  })

  it('falls back to the key rather than showing nothing', () => {
    expect(tokenLabel(groups, 'primaryColor', 'chiaro', 'scuro')).toBe('primaryColor')
  })
})

describe('ContrastRejection', () => {
  it('lists every offending colour with its measured ratio', () => {
    const violations = themeContrastViolations({
      ...defaultThemeConfig,
      foregroundFaintLight: '#9ca3af',
      foregroundFaintDark: '#6b7280',
    })
    const html = renderToStaticMarkup(
      <ContrastRejection
        message="Contrasto insufficiente"
        items={violations.map(violation => ({
          key: violation.key,
          label: tokenLabel(groups, violation.key, 'chiaro', 'scuro'),
          ratio: violation.ratio,
        }))}
      />,
    )

    expect(html).toContain('Contrasto insufficiente')
    expect(html).toContain('Testo tenue (chiaro) — 2.31:1')
    expect(html).toContain('Testo tenue (scuro) — 3.04:1')
  })

  it('is announced, because it appears after the click that asked for the save', () => {
    const html = renderToStaticMarkup(<ContrastRejection message="x" items={[]} />)

    expect(html).toContain('role="alert"')
  })
})
