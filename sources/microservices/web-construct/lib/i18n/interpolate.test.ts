import { describe, it, expect } from 'vitest'
import { interpolate } from './interpolate'

describe('interpolate', () => {
  it('substitutes a named parameter', () => {
    expect(interpolate('Benvenuto, {{name}}', { name: 'Mario' }, 'it-IT')).toBe('Benvenuto, Mario')
  })
  it('substitutes the same parameter more than once', () => {
    expect(interpolate('{{a}}-{{a}}', { a: 'x' }, 'it-IT')).toBe('x-x')
  })
  it('tolerates whitespace inside the braces', () => {
    expect(interpolate('Ciao {{ name }}', { name: 'Ada' }, 'it-IT')).toBe('Ciao Ada')
  })
  it('leaves an unknown placeholder untouched so it is visibly wrong, never silently wrong', () => {
    expect(interpolate('Ciao {{name}}', {}, 'it-IT')).toBe('Ciao {{name}}')
    expect(interpolate('Ciao {{name}}', undefined, 'it-IT')).toBe('Ciao {{name}}')
  })
  it('renders an explicit null or undefined parameter as an empty string', () => {
    expect(interpolate('[{{a}}]', { a: null }, 'it-IT')).toBe('[]')
    expect(interpolate('[{{a}}]', { a: undefined }, 'it-IT')).toBe('[]')
  })
  it('formats numbers with the active locale', () => {
    expect(interpolate('{{n}}', { n: 1234.5 }, 'it-IT')).toBe('1.234,5')
    expect(interpolate('{{n}}', { n: 1234.5 }, 'en-US')).toBe('1,234.5')
  })
  it('formats dates with the active locale', () => {
    const d = new Date(Date.UTC(2026, 6, 28))
    expect(interpolate('{{d}}', { d }, 'it-IT')).toBe('28/07/2026')
    expect(interpolate('{{d}}', { d }, 'en-US')).toBe('07/28/2026')
  })
  it('returns the template unchanged when it has no placeholders', () => {
    expect(interpolate('Salva', { name: 'x' }, 'it-IT')).toBe('Salva')
  })
  it('does not HTML-escape or strip a value — the value is inserted verbatim as text', () => {
    expect(interpolate('{{v}}', { v: '<script>alert(1)</script>' }, 'it-IT'))
      .toBe('<script>alert(1)</script>')
  })
  it('is single-pass: a placeholder inside a substituted value is never expanded', () => {
    expect(interpolate('{{a}}', { a: '{{b}}', b: 'pwned' }, 'it-IT')).toBe('{{b}}')
  })
})
