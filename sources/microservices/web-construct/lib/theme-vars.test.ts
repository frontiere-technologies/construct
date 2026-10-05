import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, it, expect } from 'vitest'
import {
  DARK_PALETTE, DEFAULT_APP_THEME, DEFAULT_PRIMARY, LIGHT_PALETTE, PRIMARY_PRESETS,
  SURFACE_KEYS, derivePrimary, effectivePalette, primaryDarkSuggestions, primaryForeground, surfaceDefault, surfaceSuggestions,
  themeContrastWarnings,
  themeCss, themePrimary,
  type AppTheme, type PaletteMode, type PrimaryPair,
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

/** Un tema con le sole superfici date, sul colore predefinito. */
const withSurfaces = (surfaces: Partial<AppTheme['surfaces']>): AppTheme => ({
  primaryColor: DEFAULT_PRIMARY,
  surfaces: { light: {}, dark: {}, ...surfaces },
})

describe('effectivePalette', () => {
  it('is the fixed palette when nothing is overridden', () => {
    expect(effectivePalette('light', {})).toEqual(LIGHT_PALETTE)
    expect(effectivePalette('dark', {})).toEqual(DARK_PALETTE)
  })

  it('maps each surface onto the variables it drives, and nothing else', () => {
    const palette = effectivePalette('light', {
      background: '#fefefe', card: '#fafafa', accent: '#eeeeee', sidebar: '#f0f0f0',
    })
    expect(palette).toEqual({
      ...LIGHT_PALETTE,
      'background': '#fefefe',
      'card': '#fafafa',
      'popover': '#fafafa',
      'accent': '#eeeeee',
      'sidebar-accent': '#eeeeee',
      'sidebar': '#f0f0f0',
    })
  })

  it('ignores a value that is not a colour and lower-cases a valid one', () => {
    const palette = effectivePalette('dark', { card: 'nope', background: '#ABCDEF' })
    expect(palette.card).toBe(DARK_PALETTE.card)
    expect(palette.background).toBe('#abcdef')
  })
})

describe('themeContrastWarnings', () => {
  it('has nothing to say about the shipped defaults', () => {
    expect(themeContrastWarnings(DEFAULT_APP_THEME)).toEqual([])
  })

  it('names every text level that a dark card in light mode makes unreadable, with its ratio', () => {
    const warnings = themeContrastWarnings(withSurfaces({ light: { card: '#1f2937' } }))
    const onCard = warnings.filter(w => w.mode === 'light' && w.surface === 'card')
    expect(onCard.map(w => w.text).sort()).toEqual(
      ['foreground', 'foreground-faint', 'foreground-secondary', 'muted-foreground'],
    )
    const foreground = onCard.find(w => w.text === 'foreground')!
    expect(foreground.ratio).toBeCloseTo(1.21, 2)
    expect(warnings.every(w => w.mode === 'light')).toBe(true)
  })

  it('reports a failing pair once, even when one surface drives two variables', () => {
    // La superficie veste --card e --popover: lo stesso testo sullo stesso colore e' un problema solo.
    const warnings = themeContrastWarnings(withSurfaces({ light: { card: '#1f2937' } }))
    const keys = warnings.map(w => `${w.mode}|${w.text}|${w.surface === 'popover' ? 'card' : w.surface}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('checks the sidebar text on a custom sidebar', () => {
    const warnings = themeContrastWarnings(withSurfaces({ dark: { sidebar: '#9ca3af' } }))
    expect(warnings).toContainEqual(expect.objectContaining({ mode: 'dark', text: 'sidebar-foreground', surface: 'sidebar' }))
    expect(warnings.some(w => w.text === 'foreground')).toBe(false)
  })

  it('checks the active-item text on a custom hover surface', () => {
    const warnings = themeContrastWarnings(withSurfaces({ dark: { accent: '#e5e7eb' } }))
    expect(warnings).toContainEqual(
      expect.objectContaining({ mode: 'dark', text: 'sidebar-accent-foreground', surface: 'sidebar-accent' }),
    )
  })

  it('warns about the primary when no variant reads on every surface of a mode', () => {
    // Uno sfondo bianco e una superficie nera: nessun colore arriva a 4,5 su entrambi.
    const warnings = themeContrastWarnings(withSurfaces({ light: { card: '#000000' } }))
    expect(warnings).toContainEqual({ mode: 'light', text: 'primary', surface: null, ratio: null })
  })
})

describe('derivePrimary on custom surfaces', () => {
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

  it('keeps the primary at 4.5:1 on the surfaces the admin chose', () => {
    const light = effectivePalette('light', { background: '#e0e7ff', card: '#eef2ff', accent: '#c7d2fe' })
    const dark = effectivePalette('dark', { card: '#334155', sidebar: '#1e293b' })
    const derived = derivePrimary('#6366f1', { light, dark })!
    for (const surface of ['#e0e7ff', '#eef2ff', '#c7d2fe']) {
      expect(ratio(derived.light.primary, surface)).toBeGreaterThanOrEqual(4.5)
    }
    for (const surface of ['#334155', '#1e293b']) {
      expect(ratio(derived.dark.primary, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('themePrimary', () => {
  it('is derivePrimary on the effective palettes when both modes have a readable variant', () => {
    const theme = withSurfaces({ dark: { card: '#334155' } })
    expect(themePrimary(theme)).toEqual(derivePrimary(DEFAULT_PRIMARY, {
      light: LIGHT_PALETTE, dark: effectivePalette('dark', { card: '#334155' }),
    }))
  })

  it('keeps the chosen colour in a mode with no readable variant, and the variant in the other', () => {
    const theme: AppTheme = { primaryColor: '#6366f1', surfaces: { light: { card: '#000000' }, dark: {} } }
    const pair = themePrimary(theme)
    expect(pair.light).toEqual({ primary: '#6366f1', foreground: primaryForeground('#6366f1') })
    expect(pair.dark).toEqual(derivePrimary('#6366f1')!.dark)
  })
})

describe('surfaceSuggestions', () => {
  const MODES: PaletteMode[] = ['light', 'dark']
  const PRIMARIES = [DEFAULT_PRIMARY, ...PRIMARY_PRESETS.map(p => p.color)]

  it('offers five distinct lower-case colours, the fixed default first', () => {
    for (const mode of MODES) {
      for (const key of SURFACE_KEYS) {
        const suggestions = surfaceSuggestions(DEFAULT_APP_THEME, mode, key)
        expect(suggestions.map(s => s.id)).toEqual(['default', 'cool', 'warm', 'neutral', 'tint'])
        expect(new Set(suggestions.map(s => s.color)).size).toBe(5)
        for (const s of suggestions) expect(s.color).toMatch(/^#[0-9a-f]{6}$/)
        const palette = mode === 'light' ? LIGHT_PALETTE : DARK_PALETTE
        expect(suggestions[0].color).toBe(palette[key])
      }
    }
  })

  it('never suggests a colour that would raise a contrast warning, whatever the preset primary', () => {
    for (const primaryColor of PRIMARIES) {
      for (const mode of MODES) {
        for (const key of SURFACE_KEYS) {
          for (const { color } of surfaceSuggestions({ ...DEFAULT_APP_THEME, primaryColor }, mode, key)) {
            const applied = withSurfaces({ [mode]: { [key]: color } })
            expect(themeContrastWarnings({ ...applied, primaryColor }), `${primaryColor} ${mode} ${key} ${color}`).toEqual([])
          }
        }
      }
    }
  })

  /** sRGB -> OKLab, riscritto qui come l'aritmetica del contrasto: misura senza il codice sotto test. */
  const oklab = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    const [r, g, b] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q,
    ]
  }
  const deltaE = (a: string, b: string) => Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]))

  it('keeps any two suggestions of a list visibly apart (OKLab distance at least 0.01)', () => {
    for (const primaryColor of PRIMARIES) {
      for (const mode of MODES) {
        for (const key of SURFACE_KEYS) {
          const colors = surfaceSuggestions({ ...DEFAULT_APP_THEME, primaryColor }, mode, key).map(s => s.color)
          for (let i = 0; i < colors.length; i++) {
            for (let j = i + 1; j < colors.length; j++) {
              expect(deltaE(colors[i], colors[j]), `${primaryColor} ${mode} ${key} ${colors[i]} ${colors[j]}`).toBeGreaterThanOrEqual(0.01)
            }
          }
        }
      }
    }
  })

  it('steps the near-white surfaces down, so their suggestions are not four whites', () => {
    for (const key of ['card', 'sidebar', 'background'] as const) {
      const [, ...others] = surfaceSuggestions(DEFAULT_APP_THEME, 'light', key)
      for (const { color } of others) {
        const [l] = oklab(color)
        expect(l, `${key} ${color}`).toBeGreaterThanOrEqual(0.94)
        expect(l, `${key} ${color}`).toBeLessThanOrEqual(0.975)
      }
    }
  })

  it.each(['#ffff00', '#808080', '#ffffff', '#000000'])('always returns five distinct readable colours, even for the primary %s', primaryColor => {
    for (const mode of MODES) {
      for (const key of SURFACE_KEYS) {
        const suggestions = surfaceSuggestions({ ...DEFAULT_APP_THEME, primaryColor }, mode, key)
        expect(suggestions, `${mode} ${key}`).toHaveLength(5)
        expect(new Set(suggestions.map(s => s.color)).size).toBe(5)
        for (const { color } of suggestions) {
          expect(themeContrastWarnings({ ...withSurfaces({ [mode]: { [key]: color } }), primaryColor }), `${mode} ${key} ${color}`).toEqual([])
        }
      }
    }
  })

  it('starts from surfaceDefault, the fixed value of the surface in that mode', () => {
    expect(surfaceDefault('light', 'card')).toBe(LIGHT_PALETTE.card)
    expect(surfaceDefault('dark', 'accent')).toBe(DARK_PALETTE.accent)
    expect(surfaceSuggestions(DEFAULT_APP_THEME, 'dark', 'sidebar')[0].color).toBe(surfaceDefault('dark', 'sidebar'))
  })

  it('tints the last suggestion with the hue of the current primary colour', () => {
    const tint = (primaryColor: string) =>
      surfaceSuggestions({ ...DEFAULT_APP_THEME, primaryColor }, 'light', 'background').find(s => s.id === 'tint')!.color
    expect(tint('#059669')).not.toBe(tint('#db2777'))
  })
})

describe('primary colour per mode (DEC-10)', () => {
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
  const darkSurfaces = [DARK_PALETTE.background, DARK_PALETTE.card, DARK_PALETTE.popover, DARK_PALETTE.accent, DARK_PALETTE.sidebar, DARK_PALETTE['sidebar-accent']]
  const readableOnDark = (color: string) => darkSurfaces.every(s => ratio(color, s) >= 4.5)

  it('derives the dark primary from the light one while primaryDark is not set', () => {
    expect(themePrimary({ ...DEFAULT_APP_THEME, primaryDark: null })).toEqual(derivePrimary(DEFAULT_PRIMARY))
  })

  it('keeps a readable dark primary exactly as chosen, and leaves the light one alone', () => {
    const pair = themePrimary({ ...DEFAULT_APP_THEME, primaryDark: '#FBBF24' })
    expect(pair.dark).toEqual({ primary: '#fbbf24', foreground: primaryForeground('#fbbf24') })
    expect(pair.light.primary).toBe(DEFAULT_PRIMARY)
  })

  it('adjusts an unreadable dark primary, like the light one', () => {
    expect(readableOnDark('#1e3a8a')).toBe(false)
    const pair = themePrimary({ ...DEFAULT_APP_THEME, primaryDark: '#1e3a8a' })
    expect(pair.dark.primary).not.toBe('#1e3a8a')
    expect(readableOnDark(pair.dark.primary)).toBe(true)
  })

  it('warns about the dark primary when no variant of it reads on the dark surfaces', () => {
    // Uno sfondo scuro e una superficie bianca: nessun colore arriva a 4,5 su entrambi.
    const theme: AppTheme = { ...withSurfaces({ dark: { card: '#ffffff' } }), primaryDark: '#7a85f7' }
    expect(themeContrastWarnings(theme)).toContainEqual({ mode: 'dark', text: 'primary', surface: null, ratio: null })
    expect(themeContrastWarnings(theme)).not.toContainEqual(expect.objectContaining({ mode: 'light', text: 'primary' }))
  })

  it('writes the dark primary into html.dark only', () => {
    const css = themeCss({ ...DEFAULT_APP_THEME, primaryDark: '#fbbf24' })
    const [light, dark] = css.split('html.dark')
    expect(dark).toContain('--primary:#fbbf24;')
    expect(light).toContain(`--primary:${DEFAULT_PRIMARY};`)
  })

  it('ignores a dark primary that is not a colour', () => {
    expect(themeCss({ ...DEFAULT_APP_THEME, primaryDark: 'nope' })).toBe(themeCss(DEFAULT_APP_THEME))
  })

  it('suggests the automatic dark value first, then the presets made readable on the dark palette', () => {
    const suggestions = primaryDarkSuggestions(DEFAULT_APP_THEME)
    expect(suggestions).toHaveLength(5)
    expect(suggestions[0]).toEqual({ id: 'auto', color: derivePrimary(DEFAULT_PRIMARY)!.dark.primary })
    expect(new Set(suggestions.map(s => s.color)).size).toBe(5)
    for (const { color } of suggestions) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/)
      expect(readableOnDark(color), color).toBe(true)
    }
  })

  it('follows the light primary for the automatic suggestion', () => {
    const auto = (primaryColor: string) => primaryDarkSuggestions({ ...DEFAULT_APP_THEME, primaryColor })[0].color
    expect(auto('#059669')).toBe(derivePrimary('#059669')!.dark.primary)
    expect(auto('#123456')).not.toBe(auto('#db2777'))
  })

  it.each([DEFAULT_PRIMARY, ...PRIMARY_PRESETS.map(p => p.color), '#ffff00', '#808080'])(
    'always offers five distinct dark suggestions for the light primary %s, also with custom dark surfaces',
    primaryColor => {
      for (const surfaces of [{}, { card: '#334155', sidebar: '#0b1220' }]) {
        const list = primaryDarkSuggestions({ ...withSurfaces({ dark: surfaces }), primaryColor })
        expect(list).toHaveLength(5)
        expect(new Set(list.map(s => s.color)).size).toBe(5)
        expect(new Set(list.map(s => s.id)).size).toBe(5)
      }
    },
  )
})

describe('themeCss', () => {
  it('writes both modes with selectors that beat the :root fallback in globals.css', () => {
    // html:root e html.dark pesano (0,1,1), :root di globals.css (0,1,0): vincono qualunque sia
    // l'ordine in cui il browser incontra il <style> del layout e il foglio di globals.css.
    const css = themeCss(DEFAULT_APP_THEME)
    expect(css).toMatch(/^html:root\{--primary:#4f46e5;--primary-foreground:#ffffff;/)
    expect(css).toMatch(/html\.dark\{--primary:#[0-9a-f]{6};--primary-foreground:#[0-9a-f]{6};/)
    expect(css.indexOf('html:root')).toBeLessThan(css.indexOf('html.dark'))
    expect(css).toContain(`--card:${LIGHT_PALETTE.card}`)
    expect(css).toContain(`--sidebar:${DARK_PALETTE.sidebar}`)
  })

  it('appends a selector suffix for the live preview, which must outweigh the layout', () => {
    const css = themeCss(DEFAULT_APP_THEME, '[data-theme-mode]')
    expect(css).toMatch(/^html:root\[data-theme-mode\]\{/)
    expect(css).toContain('}html.dark[data-theme-mode]{')
  })

  it('writes the overridden surfaces of each mode into that mode only', () => {
    const css = themeCss(withSurfaces({
      light: { card: '#fafafa', accent: '#eeeeee' },
      dark: { background: '#000000', sidebar: '#0b1220' },
    }))
    const [light, dark] = css.split('html.dark')
    expect(light).toContain('--card:#fafafa;--popover:#fafafa')
    expect(light).toContain('--accent:#eeeeee;--sidebar-accent:#eeeeee')
    expect(light).toContain(`--background:${LIGHT_PALETTE.background}`)
    expect(dark).toContain('--background:#000000')
    expect(dark).toContain('--sidebar:#0b1220')
    expect(dark).toContain(`--card:${DARK_PALETTE.card}`)
  })

  it('falls back to the defaults for values that are not colours, and writes only hex', () => {
    const garbage = {
      primaryColor: 'nope',
      surfaces: { light: { card: 'red;}body{display:none' }, dark: { sidebar: 'url(x)' } },
    } as AppTheme
    const css = themeCss(garbage)
    expect(css).toBe(themeCss(DEFAULT_APP_THEME))
    for (const value of css.matchAll(/:([^;{}]+)[;}]/g)) {
      if (value[1].startsWith('root')) continue
      expect(value[1]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('falls back to the chosen colour when no readable primary exists for a mode', () => {
    const css = themeCss({ primaryColor: '#6366f1', surfaces: { light: { card: '#000000' }, dark: {} } })
    expect(css).toMatch(/^html:root\{--primary:#6366f1;/)
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
