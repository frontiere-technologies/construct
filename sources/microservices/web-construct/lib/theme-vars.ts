import { defaultThemeConfig, type ThemeConfig } from '@/types/menu'

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v)
const safeColor = (v: string, fallback: string) => (isHex(v) ? v : fallback)

interface PairedToken {
  cssVar: string
  lightKey: keyof ThemeConfig
  darkKey: keyof ThemeConfig
}

const PAIRED_TOKENS: PairedToken[] = [
  { cssVar: '--theme-sidebar-bg', lightKey: 'sidebarBgLight', darkKey: 'sidebarBgDark' },
  { cssVar: '--theme-sidebar-text', lightKey: 'sidebarTextLight', darkKey: 'sidebarTextDark' },
  { cssVar: '--theme-active-bg', lightKey: 'activeItemBgLight', darkKey: 'activeItemBgDark' },
  { cssVar: '--theme-active-text', lightKey: 'activeItemTextLight', darkKey: 'activeItemTextDark' },
  { cssVar: '--theme-page', lightKey: 'pageLight', darkKey: 'pageDark' },
  { cssVar: '--theme-surface', lightKey: 'surfaceLight', darkKey: 'surfaceDark' },
  { cssVar: '--theme-surface-overlay', lightKey: 'surfaceOverlayLight', darkKey: 'surfaceOverlayDark' },
  { cssVar: '--theme-surface-hover', lightKey: 'surfaceHoverLight', darkKey: 'surfaceHoverDark' },
  { cssVar: '--theme-border', lightKey: 'borderLight', darkKey: 'borderDark' },
  { cssVar: '--theme-border-subtle', lightKey: 'borderSubtleLight', darkKey: 'borderSubtleDark' },
  { cssVar: '--theme-foreground', lightKey: 'foregroundLight', darkKey: 'foregroundDark' },
  { cssVar: '--theme-foreground-secondary', lightKey: 'foregroundSecondaryLight', darkKey: 'foregroundSecondaryDark' },
  { cssVar: '--theme-foreground-muted', lightKey: 'foregroundMutedLight', darkKey: 'foregroundMutedDark' },
  { cssVar: '--theme-foreground-faint', lightKey: 'foregroundFaintLight', darkKey: 'foregroundFaintDark' },
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

export function resolveThemeVars(config: ThemeConfig, isDark: boolean): Record<string, string> {
  const primary = safeColor(config.primaryColor, defaultThemeConfig.primaryColor)
  const vars: Record<string, string> = {
    '--theme-primary': primary,
    '--theme-primary-foreground': primaryForeground(primary),
  }
  for (const token of PAIRED_TOKENS) {
    const key = isDark ? token.darkKey : token.lightKey
    vars[token.cssVar] = safeColor(config[key], defaultThemeConfig[key])
  }
  return vars
}
