const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v)

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
 * The label colour for anything filled with a primary colour: whichever of white
 * and the darkest foreground contrasts better.
 *
 * It does not guarantee 4.5:1 on its own, since a mid-tone colour can leave both
 * options under it. `derivePrimary` supplies that guarantee: it only returns a
 * primary whose label reaches `CONTRAST_FLOOR`, moving the lightness of the
 * chosen colour when it has to.
 */
export function primaryForeground(primary: string): string {
  const onWhite = contrastRatio('#ffffff', primary)
  const onDark = contrastRatio(DARK_LABEL, primary)
  return onWhite >= onDark ? '#ffffff' : DARK_LABEL
}

/** WCAG 2.1 AA per il testo normale. Il testo piccolo non ha una soglia piu' bassa. */
const CONTRAST_FLOOR = 4.5

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

export type PaletteMode = 'light' | 'dark'

/** Le due tavolozze fisse, per modo. */
export const FIXED_PALETTES: Record<PaletteMode, Record<PaletteToken, string>> = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
}

/**
 * Le quattro superfici che l'admin puo' cambiare, per modo (DEC-9, che riapre
 * la DEC-3 solo per queste). Testi e bordi restano quelli della tavolozza fissa.
 */
export type SurfaceKey = 'background' | 'card' | 'accent' | 'sidebar'

export const SURFACE_KEYS: readonly SurfaceKey[] = ['background', 'card', 'accent', 'sidebar']

/** Le variabili che ogni superficie veste: la superficie anche i popover, il passaggio anche la voce attiva. */
export const SURFACE_TOKENS: Record<SurfaceKey, readonly PaletteToken[]> = {
  background: ['background'],
  card: ['card', 'popover'],
  accent: ['accent', 'sidebar-accent'],
  sidebar: ['sidebar'],
}

/** Le superfici cambiate di un modo; una chiave assente vuol dire «il valore fisso». */
export type SurfaceOverrides = Partial<Record<SurfaceKey, string>>

export interface AppTheme {
  primaryColor: string
  surfaces: Record<PaletteMode, SurfaceOverrides>
}

/**
 * La tavolozza di un modo con le superfici cambiate al posto di quelle fisse.
 * Un valore che non e' `#rrggbb` si ignora: resta il fisso.
 */
export function effectivePalette(mode: PaletteMode, overrides: SurfaceOverrides = {}): Record<PaletteToken, string> {
  const palette = { ...FIXED_PALETTES[mode] }
  for (const key of SURFACE_KEYS) {
    const value = overrides[key]
    if (typeof value !== 'string' || !isHex(value)) continue
    for (const token of SURFACE_TOKENS[key]) palette[token] = value.toLowerCase()
  }
  return palette
}

/**
 * Le superfici su cui `--primary` compare. La soglia e' quella del testo (4,5)
 * e non quella dei componenti (3), perche' `--primary` veste anche testo: la
 * variante `link` di `components/ui/button.tsx`.
 */
const PRIMARY_SURFACES: PaletteToken[] = ['background', 'card', 'popover', 'accent', 'sidebar', 'sidebar-accent']

export const DEFAULT_PRIMARY = '#4f46e5'

export const DEFAULT_APP_THEME: AppTheme = { primaryColor: DEFAULT_PRIMARY, surfaces: { light: {}, dark: {} } }

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
 * Le varianti chiaro e scuro di un colore scelto (specifica §3), misurate sulle
 * tavolozze date — quelle fisse se non se ne passano altre, quelle con le
 * superfici dell'admin per il tema salvato. `null` per un valore che non e'
 * `#rrggbb`, o se un modo non ha nessuna variante leggibile.
 */
export function derivePrimary(
  seed: string,
  palettes: Record<PaletteMode, Record<PaletteToken, string>> = FIXED_PALETTES,
): DerivedPrimary | null {
  if (!isHex(seed)) return null
  const color = seed.toLowerCase()
  const light = fitPrimary(color, palettes.light, -1)
  const dark = fitPrimary(color, palettes.dark, 1)
  return light && dark ? { light, dark } : null
}

/** I testi che si misurano contro le superfici. Il colore principale ha una regola sua. */
export type TextToken =
  | 'foreground' | 'foreground-secondary' | 'muted-foreground' | 'foreground-faint'
  | 'sidebar-foreground' | 'sidebar-accent-foreground'

/**
 * Un testo che su una superficie scende sotto `CONTRAST_FLOOR`. Per il colore
 * principale (`text: 'primary'`) superficie e rapporto sono `null`: il problema
 * non e' una coppia, e' che nessuna variante si legge su tutte le superfici.
 */
export interface ContrastWarning {
  mode: PaletteMode
  text: TextToken | 'primary'
  surface: PaletteToken | null
  ratio: number | null
}

/** Ogni testo con le superfici su cui compare. */
const TEXT_RULES: { text: TextToken; surfaces: PaletteToken[] }[] = [
  ...(['foreground', 'foreground-secondary', 'muted-foreground', 'foreground-faint'] as const).map(text => ({
    text, surfaces: ['background', 'card', 'popover', 'accent'] as PaletteToken[],
  })),
  { text: 'sidebar-foreground', surfaces: ['sidebar', 'sidebar-accent'] },
  { text: 'sidebar-accent-foreground', surfaces: ['sidebar-accent'] },
]

/** La superficie dell'admin che decide il colore di una variabile: serve a non ripetere un problema. */
const SURFACE_OF_TOKEN: Partial<Record<PaletteToken, SurfaceKey>> = Object.fromEntries(
  SURFACE_KEYS.flatMap(key => SURFACE_TOKENS[key].map(token => [token, key])),
)

/**
 * Dove il tema salvato si legge male (DEC-9). Non rifiuta niente: l'azione di
 * salvataggio mostra l'elenco e lascia decidere l'admin. Ogni problema compare
 * una volta per modo, testo e superficie dell'admin: una superficie scura veste
 * `--card` e `--popover`, ma e' un problema solo.
 */
export function themeContrastWarnings(theme: AppTheme): ContrastWarning[] {
  const warnings: ContrastWarning[] = []
  const palettes = { light: effectivePalette('light', theme.surfaces.light), dark: effectivePalette('dark', theme.surfaces.dark) }
  const seed = isHex(theme.primaryColor) ? theme.primaryColor.toLowerCase() : DEFAULT_PRIMARY
  for (const mode of ['light', 'dark'] as const) {
    const palette = palettes[mode]
    const seen = new Set<string>()
    for (const rule of TEXT_RULES) {
      for (const surface of rule.surfaces) {
        const ratio = contrastRatio(palette[rule.text], palette[surface])
        if (ratio >= CONTRAST_FLOOR) continue
        const key = `${rule.text}|${SURFACE_OF_TOKEN[surface] ?? surface}`
        if (seen.has(key)) continue
        seen.add(key)
        warnings.push({ mode, text: rule.text, surface, ratio })
      }
    }
    if (!fitPrimary(seed, palette, mode === 'light' ? -1 : 1)) {
      warnings.push({ mode, text: 'primary', surface: null, ratio: null })
    }
  }
  return warnings
}

/**
 * Il colore principale che il tema mostra davvero, per modo: la variante
 * leggibile sulle superfici del tema, oppure il colore scelto cosi' com'e' in
 * un modo che non ne ha nessuna (l'admin ha salvato dopo l'avviso). Un valore
 * che non e' `#rrggbb` ripiega sul predefinito.
 */
export function themePrimary(theme: AppTheme): DerivedPrimary {
  const seed = isHex(theme.primaryColor) ? theme.primaryColor.toLowerCase() : DEFAULT_PRIMARY
  const pair = (mode: PaletteMode) =>
    fitPrimary(seed, effectivePalette(mode, theme.surfaces?.[mode]), mode === 'light' ? -1 : 1)
    ?? { primary: seed, foreground: primaryForeground(seed) }
  return { light: pair('light'), dark: pair('dark') }
}

/** Le variabili che il tema scrive per ogni modo, nell'ordine in cui compaiono nel CSS. */
const THEME_CSS_TOKENS: PaletteToken[] = ['background', 'card', 'popover', 'accent', 'sidebar-accent', 'sidebar']

/**
 * Il CSS del tema: colore principale e superfici, per tutti e due i modi.
 *
 * Senza suffisso e' quello che `app/layout.tsx` scrive nel `<style>` della
 * pagina: `html:root` e `html.dark` pesano (0,1,1) e battono il `:root` di
 * `globals.css` (0,1,0) qualunque sia l'ordine dei due fogli. Con il suffisso
 * `[data-theme-mode]` e' l'anteprima della pagina admin, che pesa (0,2,1) e
 * batte a sua volta il layout.
 *
 * Esce solo `#rrggbb`: un valore che non lo e' ripiega sul predefinito. Se un
 * modo non ha un colore principale leggibile (l'admin ha salvato lo stesso,
 * dopo l'avviso) resta il colore scelto, cosi' com'e'.
 */
export function themeCss(theme: AppTheme, selectorSuffix = ''): string {
  const primary = themePrimary(theme)
  const block = (mode: PaletteMode) => {
    const palette = effectivePalette(mode, theme.surfaces?.[mode])
    const pair = primary[mode]
    const surfaces = THEME_CSS_TOKENS.map(token => `--${token}:${palette[token]}`).join(';')
    return `--primary:${pair.primary};--primary-foreground:${pair.foreground};${surfaces}`
  }
  return `html:root${selectorSuffix}{${block('light')}}html.dark${selectorSuffix}{${block('dark')}}`
}
