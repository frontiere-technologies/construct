import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveThemeVars, primaryForeground } from './theme-vars'
import { defaultThemeConfig } from '@/types/menu'

describe('resolveThemeVars', () => {
  it('resolves light values when isDark is false', () => {
    const vars = resolveThemeVars(defaultThemeConfig, false)
    expect(vars['--primary']).toBe(defaultThemeConfig.primaryColor)
    expect(vars['--sidebar']).toBe(defaultThemeConfig.sidebarBgLight)
    expect(vars['--card']).toBe(defaultThemeConfig.surfaceLight)
    expect(vars['--muted-foreground']).toBe(defaultThemeConfig.foregroundMutedLight)
  })

  it('resolves dark values when isDark is true', () => {
    const vars = resolveThemeVars(defaultThemeConfig, true)
    expect(vars['--sidebar']).toBe(defaultThemeConfig.sidebarBgDark)
    expect(vars['--card']).toBe(defaultThemeConfig.surfaceDark)
    expect(vars['--muted-foreground']).toBe(defaultThemeConfig.foregroundMutedDark)
  })

  it('falls back to the default color when a saved value is not a valid hex', () => {
    const broken = { ...defaultThemeConfig, surfaceLight: 'not-a-color' }
    const vars = resolveThemeVars(broken, false)
    expect(vars['--card']).toBe(defaultThemeConfig.surfaceLight)
  })

  it('falls back to the default primary color when invalid', () => {
    const broken = { ...defaultThemeConfig, primaryColor: 'nope' }
    const vars = resolveThemeVars(broken, false)
    expect(vars['--primary']).toBe(defaultThemeConfig.primaryColor)
  })

  it('derives the primary label colour instead of assuming white', () => {
    // primaryColor is administrator-editable and only validated as six hex
    // digits, so a fixed white label is a promise the theme panel cannot keep.
    expect(primaryForeground('#4f46e5')).toBe('#ffffff')   // dark primary -> white label
    expect(primaryForeground('#fbbf24')).toBe('#111827')   // pale primary -> dark label
    expect(resolveThemeVars(defaultThemeConfig, false)['--primary-foreground']).toBe('#ffffff')
  })

  it('resolves all 16 CSS variables', () => {
    const vars = resolveThemeVars(defaultThemeConfig, false)
    expect(Object.keys(vars).sort()).toEqual([
      '--accent',
      '--background',
      '--border',
      '--border-subtle',
      '--card',
      '--foreground',
      '--foreground-faint',
      '--foreground-secondary',
      '--muted-foreground',
      '--popover',
      '--primary',
      '--primary-foreground',
      '--sidebar',
      '--sidebar-accent',
      '--sidebar-accent-foreground',
      '--sidebar-foreground',
    ])
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

  const c = defaultThemeConfig
  const lightSurfaces = [c.pageLight, c.surfaceLight, c.surfaceOverlayLight, c.surfaceHoverLight, c.sidebarBgLight, c.activeItemBgLight]
  const darkSurfaces = [c.pageDark, c.surfaceDark, c.surfaceOverlayDark, c.surfaceHoverDark, c.sidebarBgDark, c.activeItemBgDark]
  const worst = (color: string, surfaces: string[]) => Math.min(...surfaces.map(s => contrast(color, s)))

  it.each([
    ['foreground',           c.foregroundLight,          c.foregroundDark],
    ['foreground-secondary', c.foregroundSecondaryLight, c.foregroundSecondaryDark],
    ['foreground-muted',     c.foregroundMutedLight,     c.foregroundMutedDark],
    ['foreground-faint',     c.foregroundFaintLight,     c.foregroundFaintDark],
  ])('%s clears 4.5:1 on every surface of both themes', (_name, light, dark) => {
    expect(worst(light, lightSurfaces)).toBeGreaterThanOrEqual(4.5)
    expect(worst(dark, darkSurfaces)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the four text levels visibly distinct, not merely legal', () => {
    const ladder = [c.foregroundLight, c.foregroundSecondaryLight, c.foregroundMutedLight, c.foregroundFaintLight]
      .map(v => worst(v, lightSurfaces))
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeLessThan(ladder[i - 1])
  })

  it('keeps sidebar and active-item text legible on their own backgrounds', () => {
    // These pairs are exact rather than worst-case: each of these text colours
    // has one defined background, so there is nothing to take a minimum over.
    expect(contrast(c.sidebarTextLight, c.sidebarBgLight)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c.sidebarTextDark, c.sidebarBgDark)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c.sidebarTextLight, c.activeItemBgLight)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c.sidebarTextDark, c.activeItemBgDark)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c.activeItemTextLight, c.activeItemBgLight)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c.activeItemTextDark, c.activeItemBgDark)).toBeGreaterThanOrEqual(4.5)
  })

  it('ships a primary colour some label colour can actually sit on', () => {
    // #6366f1, the previous default, topped out at 4.47:1 with white — no choice
    // of label could make a primary button accessible.
    expect(contrast(primaryForeground(c.primaryColor), c.primaryColor)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the globals.css fallbacks in step with defaultThemeConfig', () => {
    // The :root block paints the first frame, before resolveThemeVars runs. When
    // the two disagree the app flashes a colour it never otherwise shows — which
    // is what the primary fallback did, at #2563eb against a #6366f1 default.
    const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
    const fallback = (name: string) => css.match(new RegExp(`\\n  --${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
    expect(fallback('primary')).toBe(c.primaryColor)
    expect(fallback('muted-foreground')).toBe(c.foregroundMutedLight)
    expect(fallback('foreground-faint')).toBe(c.foregroundFaintLight)
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
})
