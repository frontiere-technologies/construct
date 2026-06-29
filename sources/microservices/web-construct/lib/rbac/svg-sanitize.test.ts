import { describe, it, expect } from 'vitest'
import { sanitizeSvg } from './svg-sanitize'

describe('sanitizeSvg', () => {
  it('strips <script> from svg', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><path d="M0 0"/></svg>')
    expect(out).not.toContain('<script')
    expect(out).toContain('<path')
  })
  it('strips onload and other event handlers', () => {
    const out = sanitizeSvg('<svg onload="alert(1)" viewBox="0 0 24 24"></svg>')
    expect(out.toLowerCase()).not.toContain('onload')
  })
  it('strips foreignObject', () => {
    const out = sanitizeSvg('<svg><foreignObject><body>x</body></foreignObject></svg>')
    expect(out.toLowerCase()).not.toContain('foreignobject')
  })
  it('preserves clean svg markup', () => {
    const out = sanitizeSvg('<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>')
    expect(out).toContain('<svg')
    expect(out).toContain('<path')
  })
  it('passes through non-svg (lucide name) unchanged', () => {
    expect(sanitizeSvg('House')).toBe('House')
  })
  it('passes through empty/null/undefined as empty string-safe', () => {
    expect(sanitizeSvg('')).toBe('')
    expect(sanitizeSvg(null)).toBe('')
    expect(sanitizeSvg(undefined)).toBe('')
  })
})
