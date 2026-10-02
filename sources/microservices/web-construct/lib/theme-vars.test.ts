import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, it, expect } from 'vitest'
import {
  DARK_PALETTE, DEFAULT_PRIMARY, LIGHT_PALETTE, PRIMARY_PRESETS,
  derivePrimary, primaryCss, primaryForeground,
  type PrimaryPair,
} from './theme-vars'

describe('primaryForeground', () => {
  it('picks white on a dark primary and the darkest foreground on a pale one', () => {
    expect(primaryForeground('#4f46e5')).toBe('#ffffff')
    expect(primaryForeground('#fbbf24')).toBe('#111827')
  })
})

/**
 * The accessibility floor of the default palette, pinned as numbers.
 *
 * These are not decoration: three of the shipped values were below 4.5:1 until
 * 2026-08-21, and nothing failed when they were. Contrast is a property of the
 * value, so only a test that computes it can hold the line — a token can be
 * perfectly wired to the theme and still be illegible.
 *
 * Each level is checked against the *worst* surface its own theme contains, not
 * against plain white and black. In light that is #f3f4f6 (surfaceHover and
 * activeItemBg), and measuring against #ffffff instead is exactly how
 * foregroundMutedLight passed review while sitting at 4.39:1 on a real surface.
 */
describe('default palette contrast', () => {
  const relativeLuminance = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const channel = (v: number) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  it('computes contrast correctly on two independently known pairs', () => {
    // Without this the suite could enforce a floor using broken arithmetic.
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 2)
    expect(contrast('#9ca3af', '#ffffff')).toBeCloseTo(2.54, 2)
  })

  const L = LIGHT_PALETTE
  const D = DARK_PALETTE
  const lightSurfaces = [L.background, L.card, L.popover, L.accent, L.sidebar, L['sidebar-accent']]
  const darkSurfaces = [D.background, D.card, D.popover, D.accent, D.sidebar, D['sidebar-accent']]
  const worst = (color: string, surfaces: string[]) => Math.min(...surfaces.map(s => contrast(color, s)))

  it.each([
    ['foreground',           L.foreground,                 D.foreground],
    ['foreground-secondary', L['foreground-secondary'], D['foreground-secondary']],
    ['foreground-muted',     L['muted-foreground'],        D['muted-foreground']],
    ['foreground-faint',     L['foreground-faint'],        D['foreground-faint']],
  ])('%s clears 4.5:1 on every surface of both themes', (_name, light, dark) => {
    expect(worst(light, lightSurfaces)).toBeGreaterThanOrEqual(4.5)
    expect(worst(dark, darkSurfaces)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the four text levels visibly distinct, not merely legal', () => {
    const ladder = [L.foreground, L['foreground-secondary'], L['muted-foreground'], L['foreground-faint']]
      .map(v => worst(v, lightSurfaces))
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThan(ladder[i - 1])
  })

  it('keeps sidebar and active-item text legible on their own backgrounds', () => {
    // These pairs are exact rather than worst-case: each of these text colours
    // has one defined background, so there is nothing to take a minimum over.
    expect(contrast(L['sidebar-foreground'], L.sidebar)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(D['sidebar-foreground'], D.sidebar)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(L['sidebar-foreground'], L['sidebar-accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(D['sidebar-foreground'], D['sidebar-accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(L['sidebar-accent-foreground'], L['sidebar-accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(D['sidebar-accent-foreground'], D['sidebar-accent'])).toBeGreaterThanOrEqual(4.5)
  })

  it('ships a primary colour some label colour can actually sit on', () => {
    // #6366f1, the previous default, topped out at 4.47:1 with white — no choice
    // of label could make a primary button accessible.
    expect(contrast(primaryForeground(DEFAULT_PRIMARY), DEFAULT_PRIMARY)).toBeGreaterThanOrEqual(4.5)
  })

  it('gives every semantic state a legible triple and a legible solid fill', () => {
    const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
    const light = css.slice(css.indexOf(':root {', css.indexOf('Colori di stato')))
    const dark = css.slice(css.indexOf('.dark {', css.indexOf('Colori di stato')))
    const read = (source: string, name: string) =>
      source.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1] as string

    for (const state of ['destructive', 'success', 'warning']) {
      const solidL = read(light, state), labelL = read(light, `${state}-foreground`)
      const fgL = read(light, `${state}-muted-foreground`), surfL = read(light, `${state}-muted`)
      const bordL = read(light, `${state}-border`)
      const solidD = read(dark, state), labelD = read(dark, `${state}-foreground`)
      const fgD = read(dark, `${state}-muted-foreground`), surfD = read(dark, `${state}-muted`)
      const bordD = read(dark, `${state}-border`)

      for (const v of [solidL, labelL, fgL, surfL, bordL, solidD, labelD, fgD, surfD, bordD]) {
        expect(v).toMatch(/^#[0-9a-f]{6}$/)
      }

      // Il pieno e la sua etichetta. E' il caso che shadcn sbaglia di serie:
      // bianco su #ef4444 legge 3.76:1, sotto la soglia, e nel tema scuro
      // l'etichetta deve essere scura.
      expect(contrast(labelL, solidL)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(labelD, solidD)).toBeGreaterThanOrEqual(4.5)

      // Il testo tenue: sulla superficie peggiore del tema e sulla propria.
      expect(worst(fgL, lightSurfaces)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(fgL, surfL)).toBeGreaterThanOrEqual(4.5)
      expect(worst(fgD, darkSurfaces)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(fgD, surfD)).toBeGreaterThanOrEqual(4.5)

      // Il bordo: WCAG 1.4.11 chiede 3:1 contro cio' che gli sta dietro.
      expect(worst(bordL, lightSurfaces)).toBeGreaterThanOrEqual(3)
      expect(worst(bordD, darkSurfaces)).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the switch off-track visible against its own knob (task 14)', () => {
    // A switch conveys its state through the knob's position, so the ratio
    // that matters is knob-against-track, not track-against-page: bg-input
    // (== --border) measured 1.24:1 in light theme, a featureless pale pill
    // that hid the white knob entirely. Fixed rather than themed, like the
    // other state tokens above — see the --switch-off comment in globals.css.
    const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
    const switchOffLight = css.match(/:root\s*\{[^}]*--switch-off:\s*(#[0-9a-f]{6})/i)?.[1]
    const switchOffDark = css.match(/\.dark\s*\{[^}]*--switch-off:\s*(#[0-9a-f]{6})/i)?.[1]
    expect(switchOffLight).toMatch(/^#[0-9a-f]{6}$/i)
    expect(switchOffDark).toMatch(/^#[0-9a-f]{6}$/i)

    const knob = '#ffffff'
    expect(contrast(knob, switchOffLight as string)).toBeGreaterThanOrEqual(3)
    expect(contrast(knob, switchOffDark as string)).toBeGreaterThanOrEqual(3)
  })
})

/**
 * Il colore principale calcolato da un colore scelto (specifica §3).
 *
 * L'aritmetica del contrasto e' riscritta qui e non importata dal modulo, come
 * nel blocco «default palette contrast»: un test che misura con la stessa
 * funzione che verifica non si accorgerebbe di una formula sbagliata.
 */
describe('derivePrimary', () => {
  const luminance = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const channel = (v: number) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  }
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const surfaces = (p: typeof LIGHT_PALETTE) =>
    [p.background, p.card, p.popover, p.accent, p.sidebar, p['sidebar-accent']]

  const expectReadable = (pair: PrimaryPair, palette: typeof LIGHT_PALETTE) => {
    expect(pair.primary).toMatch(/^#[0-9a-f]{6}$/)
    expect(pair.foreground).toMatch(/^#[0-9a-f]{6}$/)
    for (const surface of surfaces(palette)) {
      expect(ratio(pair.primary, surface)).toBeGreaterThanOrEqual(4.5)
    }
    expect(ratio(pair.foreground, pair.primary)).toBeGreaterThanOrEqual(4.5)
  }

  /** HSL -> hex, per generare colori di prova senza passare dal codice sotto test. */
  const hslToHex = (h: number, s: number, l: number) => {
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => {
      const k = (n + h / 30) % 12
      const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
      return Math.round(v * 255).toString(16).padStart(2, '0')
    }
    return `#${f(0)}${f(8)}${f(4)}`
  }

  it('keeps the shipped default untouched in light mode', () => {
    const derived = derivePrimary(DEFAULT_PRIMARY)!
    expect(derived.light).toEqual({ primary: '#4f46e5', foreground: '#ffffff' })
  })

  it('lightens the default in dark mode, where #4f46e5 reads 1.8:1 on the card', () => {
    expect(ratio('#4f46e5', DARK_PALETTE.card)).toBeLessThan(4.5)
    const derived = derivePrimary(DEFAULT_PRIMARY)!
    expect(derived.dark.primary).not.toBe('#4f46e5')
    expectReadable(derived.dark, DARK_PALETTE)
  })

  it.each(PRIMARY_PRESETS.map(p => [p.id, p.color]))('makes the %s preset readable in both modes', (_id, color) => {
    const derived = derivePrimary(color)!
    expectReadable(derived.light, LIGHT_PALETTE)
    expectReadable(derived.dark, DARK_PALETTE)
  })

  it('makes any colour readable in both modes', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      for (const saturation of [0.3, 0.65, 1]) {
        for (const lightness of [0.2, 0.4, 0.6, 0.85]) {
          const seed = hslToHex(hue, saturation, lightness)
          const derived = derivePrimary(seed)
          expect(derived, seed).not.toBeNull()
          expectReadable(derived!.light, LIGHT_PALETTE)
          expectReadable(derived!.dark, DARK_PALETTE)
        }
      }
    }
  })

  it('returns a colour that already passes exactly as chosen', () => {
    expect(derivePrimary('#123456')!.light.primary).toBe('#123456')
  })

  it('normalises upper case to lower case', () => {
    expect(derivePrimary('#4F46E5')!.light.primary).toBe('#4f46e5')
  })

  it.each(['', '#fff', 'red', '#12345g', '4f46e5', '#4f46e5 '])('rejects %j, which is not six hex digits', value => {
    expect(derivePrimary(value)).toBeNull()
  })
})

describe('primaryCss', () => {
  it('writes both modes with selectors that beat the :root fallback in globals.css', () => {
    // html:root e html.dark pesano (0,1,1), :root di globals.css (0,1,0): vincono qualunque sia
    // l'ordine in cui il browser incontra il <style> del layout e il foglio di globals.css.
    const css = primaryCss(DEFAULT_PRIMARY)
    expect(css).toContain('html:root{--primary:#4f46e5;--primary-foreground:#ffffff}')
    expect(css).toMatch(/html\.dark\{--primary:#[0-9a-f]{6};--primary-foreground:#[0-9a-f]{6}\}/)
    expect(css.indexOf('html:root')).toBeLessThan(css.indexOf('html.dark'))
  })

  it('falls back to the default for a value that is not a colour', () => {
    expect(primaryCss('nope')).toBe(primaryCss(DEFAULT_PRIMARY))
  })
})

describe('fixed palette', () => {
  /**
   * La tavolozza esiste in due copie: le costanti TypeScript, che il calcolo del
   * colore principale e questi test leggono, e `globals.css`, che il browser
   * legge. Se divergono, il contrasto verificato qui non e' quello mostrato.
   */
  const sheet = postcss.parse(readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8'))
  const declared = (selector: string, token: string) => {
    let value: string | undefined
    sheet.walkRules(rule => {
      if (rule.selector !== selector) return
      rule.walkDecls(`--${token}`, decl => { value ??= decl.value })
    })
    return value
  }

  it.each(Object.keys(LIGHT_PALETTE))('ships --%s identically in TypeScript and in :root / .dark', token => {
    expect(declared(':root', token)).toBe(LIGHT_PALETTE[token as keyof typeof LIGHT_PALETTE])
    expect(declared('.dark', token)).toBe(DARK_PALETTE[token as keyof typeof DARK_PALETTE])
  })

  it('keeps the :root primary fallback on the default colour', () => {
    expect(declared(':root', 'primary')).toBe(DEFAULT_PRIMARY)
    expect(declared(':root', 'primary-foreground')).toBe('#ffffff')
  })
})
