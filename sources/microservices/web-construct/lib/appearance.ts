import { z } from 'zod'

/**
 * Le preferenze personali di aspetto (specifica §2.2, §2.3, §4). Nessuna
 * dipendenza server: lo importano il layout, le azioni e la pagina Impostazioni.
 */

export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export const TEXT_SCALES = [90, 100, 110, 120, 130] as const
export type TextScale = (typeof TEXT_SCALES)[number]

export interface Appearance {
  mode: ThemeMode
  scale: TextScale
}

export const DEFAULT_APPEARANCE: Appearance = { mode: 'system', scale: 100 }

/** Letto solo per i visitatori anonimi: per un utente autenticato vince il profilo (§2.3). */
export const APPEARANCE_COOKIE = 'construct_appearance'
export const APPEARANCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** La classe che `@custom-variant dark` in `app/globals.css` riconosce. */
export const DARK_CLASS = 'dark'

export const appearancePatchSchema = z.object({
  mode: z.enum(THEME_MODES).optional(),
  scale: z.literal(TEXT_SCALES).optional(),
}).strict()

export type AppearancePatch = z.infer<typeof appearancePatchSchema>

const isThemeMode = (v: string): v is ThemeMode => (THEME_MODES as readonly string[]).includes(v)
const isTextScale = (v: number): v is TextScale => (TEXT_SCALES as readonly number[]).includes(v)

/** `dark.110`: abbastanza corto per un cookie, nessun JSON da validare. */
export function serializeAppearance(appearance: Appearance): string {
  return `${appearance.mode}.${appearance.scale}`
}

export function parseAppearanceCookie(raw?: string | null): Appearance | null {
  const match = raw?.match(/^([a-z]+)\.(\d+)$/)
  if (!match) return null
  const scale = Number(match[2])
  return isThemeMode(match[1]) && isTextScale(scale) ? { mode: match[1], scale } : null
}

/** I vincoli del database garantiscono gia' i valori; questo e' il piano di riserva campo per campo. */
export function toAppearance(row: { themeMode: string; textScale: number }): Appearance {
  return {
    mode: isThemeMode(row.themeMode) ? row.themeMode : DEFAULT_APPEARANCE.mode,
    scale: isTextScale(row.textScale) ? row.textScale : DEFAULT_APPEARANCE.scale,
  }
}

/**
 * L'aspetto di un visitatore anonimo (specifica §2.3): il modo e' sempre
 * chiaro, perche' le pagine pubbliche (/login, /register, ...) sono disegnate
 * chiare e un modo scuro lascerebbe i campi scuri dentro la card bianca; dal
 * cookie si legge solo la scala del testo.
 */
export function anonymousAppearance(cookie: Appearance | null): Appearance {
  return { mode: 'light', scale: cookie?.scale ?? DEFAULT_APPEARANCE.scale }
}

/**
 * Mette o toglie la classe `dark` prima che la pagina compaia, leggendo
 * `data-theme-mode` su `<html>`. Sempre presente, non solo in modo `system`:
 * l'ascoltatore resta attivo anche se l'utente passa a `system` dalla pagina
 * Impostazioni senza ricaricare.
 *
 * La classe non la gestisce React (specifica §4): un `router.refresh()` la
 * toglierebbe a un utente in `system` con sistema operativo scuro.
 */
export const THEME_MODE_SCRIPT =
  `(function(){var d=document.documentElement,q=window.matchMedia('(prefers-color-scheme: dark)');` +
  `function a(){var m=d.getAttribute('data-theme-mode');d.classList.toggle('${DARK_CLASS}',m==='dark'||(m==='system'&&q.matches))}` +
  `a();q.addEventListener('change',a)})()`

/** Lo stesso effetto dello script, dal client, quando l'utente cambia una preferenza. */
export function applyAppearance(root: HTMLElement, appearance: Appearance, prefersDark: boolean): void {
  root.setAttribute('data-theme-mode', appearance.mode)
  root.classList.toggle(DARK_CLASS, appearance.mode === 'dark' || (appearance.mode === 'system' && prefersDark))
  root.style.fontSize = `${appearance.scale}%`
}

export function prefersDarkScheme(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
