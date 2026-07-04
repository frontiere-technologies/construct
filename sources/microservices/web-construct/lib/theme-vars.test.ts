import { describe, it, expect } from 'vitest'
import { resolveThemeVars } from './theme-vars'
import { defaultThemeConfig } from '@/types/menu'

describe('resolveThemeVars', () => {
  it('resolves light values when isDark is false', () => {
    const vars = resolveThemeVars(defaultThemeConfig, false)
    expect(vars['--theme-primary']).toBe(defaultThemeConfig.primaryColor)
    expect(vars['--theme-sidebar-bg']).toBe(defaultThemeConfig.sidebarBgLight)
    expect(vars['--theme-surface']).toBe(defaultThemeConfig.surfaceLight)
    expect(vars['--theme-foreground-muted']).toBe(defaultThemeConfig.foregroundMutedLight)
  })

  it('resolves dark values when isDark is true', () => {
    const vars = resolveThemeVars(defaultThemeConfig, true)
    expect(vars['--theme-sidebar-bg']).toBe(defaultThemeConfig.sidebarBgDark)
    expect(vars['--theme-surface']).toBe(defaultThemeConfig.surfaceDark)
    expect(vars['--theme-foreground-muted']).toBe(defaultThemeConfig.foregroundMutedDark)
  })

  it('falls back to the default color when a saved value is not a valid hex', () => {
    const broken = { ...defaultThemeConfig, surfaceLight: 'not-a-color' }
    const vars = resolveThemeVars(broken, false)
    expect(vars['--theme-surface']).toBe(defaultThemeConfig.surfaceLight)
  })

  it('falls back to the default primary color when invalid', () => {
    const broken = { ...defaultThemeConfig, primaryColor: 'nope' }
    const vars = resolveThemeVars(broken, false)
    expect(vars['--theme-primary']).toBe(defaultThemeConfig.primaryColor)
  })

  it('resolves all 15 CSS variables', () => {
    const vars = resolveThemeVars(defaultThemeConfig, false)
    expect(Object.keys(vars).sort()).toEqual([
      '--theme-active-bg',
      '--theme-active-text',
      '--theme-border',
      '--theme-border-subtle',
      '--theme-foreground',
      '--theme-foreground-faint',
      '--theme-foreground-muted',
      '--theme-foreground-secondary',
      '--theme-page',
      '--theme-primary',
      '--theme-sidebar-bg',
      '--theme-sidebar-text',
      '--theme-surface',
      '--theme-surface-hover',
      '--theme-surface-overlay',
    ])
  })
})
