export type MenuPosition = 'top' | 'main' | 'bottom'
export type MenuItemType = 'link' | 'container'

export interface MenuItem {
  id: string
  label: string
  icon?: string
  route?: string
  type: MenuItemType
  parentId: string | null
  order: number
  visible: boolean
  active: boolean
  roles?: string[]
  target?: '_blank' | '_self'
  position: MenuPosition
  collapsible?: boolean
  defaultExpanded?: boolean
  system?: boolean
}

export interface ThemeConfig {
  primaryColor: string
  sidebarBgLight: string
  sidebarBgDark: string
  sidebarTextLight: string
  sidebarTextDark: string
  activeItemBgLight: string
  activeItemBgDark: string
  activeItemTextLight: string
  activeItemTextDark: string
  pageLight: string
  pageDark: string
  surfaceLight: string
  surfaceDark: string
  surfaceOverlayLight: string
  surfaceOverlayDark: string
  surfaceHoverLight: string
  surfaceHoverDark: string
  borderLight: string
  borderDark: string
  borderSubtleLight: string
  borderSubtleDark: string
  foregroundLight: string
  foregroundDark: string
  foregroundSecondaryLight: string
  foregroundSecondaryDark: string
  foregroundMutedLight: string
  foregroundMutedDark: string
  foregroundFaintLight: string
  foregroundFaintDark: string
}

export interface AppSettings {
  language: string
  theme: 'light' | 'dark'
  themeConfig: ThemeConfig
}

/**
 * Default palette.
 *
 * The four text levels are picked against the *worst* surface each theme
 * actually contains, not against plain white and black. In light that is
 * #f3f4f6 (surfaceHover and activeItemBg), not #ffffff — which is why three of
 * these values changed on 2026-08-21: measured on #f3f4f6, foregroundMutedLight
 * read 4.39:1 and foregroundFaintLight 2.31:1, and foregroundFaintDark read
 * 3.04:1 on #1f2937. All four levels now clear 4.5:1 on every surface of their
 * theme, with the contrast ladder still visible:
 *
 *   light  16.12 / 9.37 / 6.87 / 4.61      dark  14.68 / 9.96 / 5.78 / 4.63
 *
 * The last two steps are close because the 4.5:1 floor compresses the bottom of
 * any four-level grey scale. That is the floor doing its job, not an oversight.
 * `lib/theme-vars.test.ts` pins these numbers, so lowering one fails the suite.
 *
 * Full derivation: docs/reviews/2026-08-19-ui-primitives-and-theming.md
 */
export const defaultThemeConfig: ThemeConfig = {
  // indigo-600, not indigo-500. Measured during THEME-2 groundwork: on #6366f1
  // the best possible label colour reaches only 4.47:1 — neither white nor near
  // black clears 4.5:1 — so with the previous default no primary button could be
  // made accessible by any choice of foreground. One shade darker, white reads
  // 6.29:1. Same hue family, so the product's look is unchanged.
  primaryColor: '#4f46e5',
  sidebarBgLight: '#ffffff',
  sidebarBgDark: '#111827',
  sidebarTextLight: '#4b5563',
  sidebarTextDark: '#9ca3af',
  activeItemBgLight: '#f3f4f6',
  activeItemBgDark: '#1f2937',
  activeItemTextLight: '#111827',
  activeItemTextDark: '#ffffff',
  pageLight: '#f9fafb',
  pageDark: '#030712',
  surfaceLight: '#ffffff',
  surfaceDark: '#1f2937',
  surfaceOverlayLight: '#ffffff',
  surfaceOverlayDark: '#111827',
  surfaceHoverLight: '#f3f4f6',
  surfaceHoverDark: '#1f2937',
  borderLight: '#e5e7eb',
  borderDark: '#374151',
  borderSubtleLight: '#f3f4f6',
  borderSubtleDark: '#1f2937',
  foregroundLight: '#111827',
  foregroundDark: '#ffffff',
  foregroundSecondaryLight: '#374151',
  foregroundSecondaryDark: '#d1d5db',
  foregroundMutedLight: '#4b5563',
  foregroundMutedDark: '#9ca3af',
  foregroundFaintLight: '#666f7d',
  foregroundFaintDark: '#8b919c',
}

export const defaultSettings: AppSettings = {
  language: 'en',
  theme: 'light',
  themeConfig: defaultThemeConfig,
}

export function mergeThemeConfig(saved?: Partial<ThemeConfig> | null): ThemeConfig {
  return { ...defaultThemeConfig, ...saved }
}
