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

/** La scritta scura sul colore principale: il testo principale del modo chiaro. */
const DARK_LABEL = '#111827'

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
  const onDark = contrastRatio(DARK_LABEL, primary)
  return onWhite >= onDark ? '#ffffff' : DARK_LABEL
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

/**
 * La tavolozza fissa (DEC-3): sfondi, bordi, testi e sidebar non si configurano
 * piu'. Sono i predefiniti di prima, gia' verificati per il contrasto da
 * `lib/theme-vars.test.ts`, e devono coincidere con `:root` e `.dark` di
 * `app/globals.css` — lo stesso file di test confronta le due copie.
 */
export type PaletteToken =
  | 'background' | 'card' | 'popover' | 'accent' | 'border' | 'border-subtle'
  | 'foreground' | 'foreground-secondary' | 'muted-foreground' | 'foreground-faint'
  | 'sidebar' | 'sidebar-foreground' | 'sidebar-accent' | 'sidebar-accent-foreground'

export const LIGHT_PALETTE: Record<PaletteToken, string> = {
  'background': '#f9fafb',
  'card': '#ffffff',
  'popover': '#ffffff',
  'accent': '#f3f4f6',
  'border': '#e5e7eb',
  'border-subtle': '#f3f4f6',
  'foreground': '#111827',
  'foreground-secondary': '#374151',
  'muted-foreground': '#4b5563',
  'foreground-faint': '#666f7d',
  'sidebar': '#ffffff',
  'sidebar-foreground': '#4b5563',
  'sidebar-accent': '#f3f4f6',
  'sidebar-accent-foreground': '#111827',
}

export const DARK_PALETTE: Record<PaletteToken, string> = {
  'background': '#030712',
  'card': '#1f2937',
  'popover': '#111827',
  'accent': '#1f2937',
  'border': '#374151',
  'border-subtle': '#1f2937',
  'foreground': '#ffffff',
  'foreground-secondary': '#d1d5db',
  'muted-foreground': '#9ca3af',
  'foreground-faint': '#8b919c',
  'sidebar': '#111827',
  'sidebar-foreground': '#9ca3af',
  'sidebar-accent': '#1f2937',
  'sidebar-accent-foreground': '#ffffff',
}

/**
 * Le superfici su cui `--primary` compare. La soglia e' quella del testo (4,5)
 * e non quella dei componenti (3), perche' `--primary` veste anche testo: la
 * variante `link` di `components/ui/button.tsx`.
 */
const PRIMARY_SURFACES: PaletteToken[] = ['background', 'card', 'popover', 'accent', 'sidebar', 'sidebar-accent']

export const DEFAULT_PRIMARY = '#4f46e5'

export const PRIMARY_PRESETS = [
  { id: 'indigo', color: '#4f46e5' },
  { id: 'green', color: '#059669' },
  { id: 'pink', color: '#db2777' },
  { id: 'orange', color: '#ea580c' },
  { id: 'sky', color: '#0284c7' },
] as const

export interface PrimaryPair {
  primary: string
  foreground: string
}

export interface DerivedPrimary {
  light: PrimaryPair
  dark: PrimaryPair
}

/** OKLCH, con la tinta in radianti: serve solo dentro questo modulo. */
interface Oklch {
  l: number
  c: number
  h: number
}

const srgbToLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const linearToSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

/** sRGB -> OKLab -> OKLCH, con le matrici di Björn Ottosson. */
function hexToOklch(hex: string): Oklch {
  const n = parseInt(hex.slice(1), 16)
  const r = srgbToLinear((n >> 16) & 255)
  const g = srgbToLinear((n >> 8) & 255)
  const b = srgbToLinear(n & 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) }
}

/** I tre canali sRGB lineari, non tagliati: fuori da [0, 1] il colore non e' rappresentabile. */
function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos(h)
  const B = c * Math.sin(h)
  const l3 = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m3 = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s3 = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ]
}

const inGamut = (rgb: number[]) => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4)

/**
 * OKLCH -> hex. Se il colore cade fuori da sRGB si riduce la saturazione, non la
 * luminosita': la luminosita' e' cio' che il chiamante sta regolando.
 */
function oklchToHex(color: Oklch): string {
  let chroma = color.c
  let rgb = oklchToLinearRgb(color)
  for (let i = 0; i < 60 && !inGamut(rgb); i++) {
    chroma *= 0.9
    rgb = oklchToLinearRgb({ ...color, c: chroma })
  }
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)
  return `#${rgb.map(v => byte(v).toString(16).padStart(2, '0')).join('')}`
}

function readableOn(primary: string, palette: Record<PaletteToken, string>): boolean {
  return PRIMARY_SURFACES.every(token => contrastRatio(primary, palette[token]) >= CONTRAST_FLOOR)
    && contrastRatio(primaryForeground(primary), primary) >= CONTRAST_FLOOR
}

const LIGHTNESS_STEP = 0.01

/**
 * Il colore scelto, se gia' si legge; altrimenti la stessa tinta e saturazione a
 * luminosita' via via piu' bassa (chiaro, `direction = -1`) o piu' alta (scuro,
 * `+1`), fermandosi al primo valore che si legge. Agli estremi c'e' sempre il
 * nero o il bianco, che si leggono entrambi: `null` resta un caso di difesa.
 */
function fitPrimary(seed: string, palette: Record<PaletteToken, string>, direction: -1 | 1): PrimaryPair | null {
  if (readableOn(seed, palette)) return { primary: seed, foreground: primaryForeground(seed) }
  const start = hexToOklch(seed)
  for (let step = 1; step <= 1 / LIGHTNESS_STEP; step++) {
    const l = Math.min(1, Math.max(0, start.l + direction * step * LIGHTNESS_STEP))
    const candidate = oklchToHex({ ...start, l })
    if (readableOn(candidate, palette)) return { primary: candidate, foreground: primaryForeground(candidate) }
    if (l === 0 || l === 1) break
  }
  return null
}

/**
 * Le varianti chiaro e scuro di un colore scelto (specifica §3). `null` per un
 * valore che non e' `#rrggbb`, o se un modo non ha nessuna variante leggibile.
 */
export function derivePrimary(seed: string): DerivedPrimary | null {
  if (!isHex(seed)) return null
  const color = seed.toLowerCase()
  const light = fitPrimary(color, LIGHT_PALETTE, -1)
  const dark = fitPrimary(color, DARK_PALETTE, 1)
  return light && dark ? { light, dark } : null
}

/**
 * Il CSS che `app/layout.tsx` scrive nel `<style>` della pagina. I selettori
 * `html:root` e `html.dark` pesano (0,1,1) e battono il `:root` di
 * `globals.css` (0,1,0) qualunque sia l'ordine dei due fogli nel documento.
 */
export function primaryCss(seed: string): string {
  const derived = derivePrimary(seed) ?? derivePrimary(DEFAULT_PRIMARY)!
  const block = (pair: PrimaryPair) => `--primary:${pair.primary};--primary-foreground:${pair.foreground}`
  return `html:root{${block(derived.light)}}html.dark{${block(derived.dark)}}`
}
