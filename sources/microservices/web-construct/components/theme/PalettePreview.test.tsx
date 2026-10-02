import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { derivePrimary } from '@/lib/theme-vars'
import { PalettePreview } from './PalettePreview'

const labels = {
  light: 'Chiaro', dark: 'Scuro', primary: 'Principale', hover: 'Passaggio',
  surface: 'Superficie', background: 'Sfondo', sidebar: 'Sidebar',
}

describe('PalettePreview', () => {
  it('paints each mode with its own primary pair and fixed palette', () => {
    const derived = derivePrimary('#4f46e5')!
    const html = renderToStaticMarkup(<PalettePreview derived={derived} labels={labels} />)
    expect(html).toContain('data-testid="theme-preview-light"')
    expect(html).toContain('data-testid="theme-preview-dark"')
    expect(html).toMatch(/data-testid="theme-preview-light-primary"[^>]*background-color:#4f46e5;color:#ffffff/)
    expect(html).toMatch(new RegExp(`data-testid="theme-preview-dark-primary"[^>]*background-color:${derived.dark.primary}`))
    expect(html).toMatch(/data-testid="theme-preview-dark-background"[^>]*background-color:#030712/)
  })
})
