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

export function resolveThemeVars(config: ThemeConfig, isDark: boolean): Record<string, string> {
  const vars: Record<string, string> = {
    '--theme-primary': safeColor(config.primaryColor, defaultThemeConfig.primaryColor),
  }
  for (const token of PAIRED_TOKENS) {
    const key = isDark ? token.darkKey : token.lightKey
    vars[token.cssVar] = safeColor(config[key], defaultThemeConfig[key])
  }
  return vars
}
