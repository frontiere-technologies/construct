import { describe, it, expect } from 'vitest'
import { mergeThemeConfig, defaultThemeConfig } from './menu'

describe('mergeThemeConfig', () => {
  it('returns the defaults when nothing is saved', () => {
    expect(mergeThemeConfig(undefined)).toEqual(defaultThemeConfig)
    expect(mergeThemeConfig(null)).toEqual(defaultThemeConfig)
  })

  it('fills in missing fields from defaults when a saved config predates newer fields', () => {
    const legacy = { primaryColor: '#123456', sidebarBgLight: '#abcdef' }
    const merged = mergeThemeConfig(legacy)
    expect(merged.primaryColor).toBe('#123456')
    expect(merged.sidebarBgLight).toBe('#abcdef')
    // Fields absent from the legacy saved config fall back to defaults — this is
    // the exact scenario that broke before context/UIContext.tsx's server-load
    // path was fixed to merge instead of raw-replacing.
    expect(merged.surfaceLight).toBe(defaultThemeConfig.surfaceLight)
    expect(merged.foregroundMutedDark).toBe(defaultThemeConfig.foregroundMutedDark)
  })

  it('lets a fully-populated saved config override every default field', () => {
    const full = { ...defaultThemeConfig, primaryColor: '#000000' }
    expect(mergeThemeConfig(full)).toEqual(full)
  })
})
