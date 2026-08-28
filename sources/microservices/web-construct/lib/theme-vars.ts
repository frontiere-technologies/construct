import { defaultThemeConfig, type ThemeConfig } from '@/types/menu'

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v)
const safeColor = (v: string, fallback: string) => (isHex(v) ? v : fallback)

interface PairedToken {
  cssVar: string
  lightKey: keyof ThemeConfig
  darkKey: keyof ThemeConfig
}

/**
 * Il confine fra i due vocabolari del progetto.
 *
 * A sinistra i nomi shadcn, che sono gli unici che un componente scrive mai. A
 * destra i campi di ThemeConfig, che sono uno schema di dati: vivono sul
 * database, li modifica Admin -> Tema e nessuno li scrive in una className.
 * Rinominarli per farli somigliare ai token costerebbe una migration
 * distruttiva sulle configurazioni gia' salvate in cambio di niente.
 */
const PAIRED_TOKENS: PairedToken[] = [
  { cssVar: '--sidebar', lightKey: 'sidebarBgLight', darkKey: 'sidebarBgDark' },
  { cssVar: '--sidebar-foreground', lightKey: 'sidebarTextLight', darkKey: 'sidebarTextDark' },
  { cssVar: '--sidebar-accent', lightKey: 'activeItemBgLight', darkKey: 'activeItemBgDark' },
  { cssVar: '--sidebar-accent-foreground', lightKey: 'activeItemTextLight', darkKey: 'activeItemTextDark' },
  { cssVar: '--background', lightKey: 'pageLight', darkKey: 'pageDark' },
  { cssVar: '--card', lightKey: 'surfaceLight', darkKey: 'surfaceDark' },
  { cssVar: '--popover', lightKey: 'surfaceOverlayLight', darkKey: 'surfaceOverlayDark' },
  { cssVar: '--accent', lightKey: 'surfaceHoverLight', darkKey: 'surfaceHoverDark' },
  { cssVar: '--border', lightKey: 'borderLight', darkKey: 'borderDark' },
  { cssVar: '--border-subtle', lightKey: 'borderSubtleLight', darkKey: 'borderSubtleDark' },
  { cssVar: '--foreground', lightKey: 'foregroundLight', darkKey: 'foregroundDark' },
  { cssVar: '--foreground-secondary', lightKey: 'foregroundSecondaryLight', darkKey: 'foregroundSecondaryDark' },
  { cssVar: '--muted-foreground', lightKey: 'foregroundMutedLight', darkKey: 'foregroundMutedDark' },
  { cssVar: '--foreground-faint', lightKey: 'foregroundFaintLight', darkKey: 'foregroundFaintDark' },
]

/** WCAG 2.1 relative luminance. */
function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255)
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The label colour for anything filled with the primary colour.
 *
 * Derived rather than authored, because `primaryColor` is administrator-editable
 * and the only validation is `safeColor`, which checks six hex digits and
 * nothing else. A fixed white label is a promise the panel cannot keep: pick a
 * pale primary and the label disappears. Choosing whichever of white and the
 * darkest foreground contrasts better is the strongest guarantee available
 * without rejecting the administrator's colour.
 *
 * It is not a total guarantee, and that limit is real: a mid-tone primary can
 * leave both options under 4.5:1. The shipped default was one — #6366f1 topped
 * out at 4.47:1 — which is why the default moved to #4f46e5 (6.29:1). Surfacing
 * a warning in Admin -> Theme when a chosen colour cannot reach 4.5:1 is the
 * natural follow-up; it is not part of this change.
 */
export function primaryForeground(primary: string): string {
  const onWhite = contrastRatio('#ffffff', primary)
  const onDark = contrastRatio(defaultThemeConfig.foregroundLight, primary)
  return onWhite >= onDark ? '#ffffff' : defaultThemeConfig.foregroundLight
}

/** WCAG 2.1 AA per il testo normale. Il testo piccolo non ha una soglia piu' bassa. */
const CONTRAST_FLOOR = 4.5

/**
 * Le superfici che un testo puo' trovarsi sotto, tema per tema. Un livello di
 * testo si misura contro la *peggiore* delle proprie, non contro il bianco: e'
 * misurando su #ffffff che foregroundMutedLight passo' la revisione stando a
 * 4,39:1 su una superficie reale.
 */
const SURFACE_KEYS: { light: (keyof ThemeConfig)[]; dark: (keyof ThemeConfig)[] } = {
  light: ['pageLight', 'surfaceLight', 'surfaceOverlayLight', 'surfaceHoverLight', 'sidebarBgLight', 'activeItemBgLight'],
  dark: ['pageDark', 'surfaceDark', 'surfaceOverlayDark', 'surfaceHoverDark', 'sidebarBgDark', 'activeItemBgDark'],
}

/** I quattro livelli di testo, che vanno provati su ogni superficie del loro tema. */
const FOREGROUND_KEYS: { light: keyof ThemeConfig; dark: keyof ThemeConfig }[] = [
  { light: 'foregroundLight', dark: 'foregroundDark' },
  { light: 'foregroundSecondaryLight', dark: 'foregroundSecondaryDark' },
  { light: 'foregroundMutedLight', dark: 'foregroundMutedDark' },
  { light: 'foregroundFaintLight', dark: 'foregroundFaintDark' },
]

/**
 * I testi con un fondo definito: qui non c'e' un minimo da prendere, i fondi
 * possibili sono quelli elencati e nessun altro.
 */
const EXACT_PAIRS: { text: keyof ThemeConfig; backgrounds: (keyof ThemeConfig)[] }[] = [
  { text: 'sidebarTextLight', backgrounds: ['sidebarBgLight', 'activeItemBgLight'] },
  { text: 'sidebarTextDark', backgrounds: ['sidebarBgDark', 'activeItemBgDark'] },
  { text: 'activeItemTextLight', backgrounds: ['activeItemBgLight'] },
  { text: 'activeItemTextDark', backgrounds: ['activeItemBgDark'] },
]

export interface ContrastViolation {
  key: keyof ThemeConfig
  ratio: number
  floor: number
}

/**
 * I colori di una configurazione che non arrivano alla soglia di contrasto.
 *
 * `lib/theme-vars.test.ts` fissa lo stesso pavimento su `defaultThemeConfig`,
 * cioe' sui valori spediti. Questa funzione lo applica a cio' che Admin -> Tema
 * scrive nel database, che e' l'unico posto dove il pavimento puo' cedere: il
 * valore salvato vince sul predefinito, e veste testo piccolo — `text-xs` in
 * `app/(protected)/error.tsx`, `text-[10px]` in `components/AdminTheme.tsx`, il
 * testo degli input disabilitati in `components/ui/input.tsx`.
 *
 * Si misura sui valori *efficaci*, quelli che `resolveThemeVars` produrrebbe:
 * un valore che non e' un hex a sei cifre non viene mai reso, quindi non e' una
 * violazione, e' un predefinito.
 *
 * Fuori perimetro di proposito: `primaryColor`. E' un colore di marchio, e il
 * progetto ne deriva l'etichetta meno peggio con `primaryForeground()` invece
 * di rifiutare la scelta di chi lo sceglie.
 */
export function themeContrastViolations(config: ThemeConfig): ContrastViolation[] {
  const effective = (key: keyof ThemeConfig) => safeColor(config[key], defaultThemeConfig[key])
  const violations: ContrastViolation[] = []

  const record = (key: keyof ThemeConfig, ratio: number) => {
    if (ratio < CONTRAST_FLOOR) violations.push({ key, ratio, floor: CONTRAST_FLOOR })
  }

  for (const level of FOREGROUND_KEYS) {
    for (const theme of ['light', 'dark'] as const) {
      const text = effective(level[theme])
      const worst = Math.min(...SURFACE_KEYS[theme].map(key => contrastRatio(text, effective(key))))
      record(level[theme], worst)
    }
  }

  for (const pair of EXACT_PAIRS) {
    const text = effective(pair.text)
    const worst = Math.min(...pair.backgrounds.map(key => contrastRatio(text, effective(key))))
    record(pair.text, worst)
  }

  return violations
}

export function resolveThemeVars(config: ThemeConfig, isDark: boolean): Record<string, string> {
  const primary = safeColor(config.primaryColor, defaultThemeConfig.primaryColor)
  const vars: Record<string, string> = {
    '--primary': primary,
    '--primary-foreground': primaryForeground(primary),
  }
  for (const token of PAIRED_TOKENS) {
    const key = isDark ? token.darkKey : token.lightKey
    vars[token.cssVar] = safeColor(config[key], defaultThemeConfig[key])
  }
  return vars
}
