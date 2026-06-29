import { describe, it, expect } from 'vitest'
import { isInlineSvg } from './icon-utils'

describe('isInlineSvg', () => {
  it('detects svg markup', () => {
    expect(isInlineSvg('<svg viewBox="0 0 24 24"></svg>')).toBe(true)
    expect(isInlineSvg('  <SVG></SVG>')).toBe(true)
  })
  it('treats lucide names as non-svg', () => {
    expect(isInlineSvg('Shield')).toBe(false)
    expect(isInlineSvg(undefined)).toBe(false)
    expect(isInlineSvg('')).toBe(false)
  })
})
