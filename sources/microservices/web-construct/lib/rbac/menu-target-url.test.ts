import { describe, expect, it } from 'vitest'
import { normalizeMenuTargetUrl } from './menu-target-url'

const origin = 'https://construct.example.test'

describe('effective menu target URL', () => {
  it.each([
    ['///construct.example.test/user-management', '//construct.example.test/user-management'],
    ['/a%2f..%2fuser-management', '/a%2f..%2fuser-management'],
    ['https://bücher.example/page', 'https://xn--bcher-kva.example/page'],
    ['https://%63onstruct.example.test/user-management', 'https://construct.example.test/user-management'],
    ['https://constr\tuct.example.test/user-management', 'https://construct.example.test/user-management'],
    ['https://outside.test/page?q=hello world#fragment', 'https://outside.test/page?q=hello%20world#fragment'],
    [String.raw`https:\\outside.test\page`, 'https://outside.test/page'],
    ['https://user:pass@outside.test/page', 'https://user:pass@outside.test/page'],
    ['user-management/?x=1#grid', '/user-management/?x=1#grid'],
    ['ftp://outside.test/page', '/ftp://outside.test/page'],
    ['mailto:person@example.test', '/mailto:person@example.test'],
    ['tel:+3900000', '/tel:+3900000'],
    ['http+unix://socket/path', 'http+unix://socket/path'],
  ])('preserves the previous rendered destination of %s', (raw, target) => {
    expect(normalizeMenuTargetUrl(raw, 2, origin)).toBe(target)
  })

  it('keeps relative destinations on the current tenant host', () => {
    expect(normalizeMenuTargetUrl('/profile?a=1#me', 3, origin)).toBe('/profile?a=1#me')
    expect(normalizeMenuTargetUrl('/profile?a=1#me', 3, '')).toBe('/profile?a=1#me')
  })

  it('preserves a real embedded URI without the sidebar prefix rule', () => {
    expect(normalizeMenuTargetUrl('ftp://outside.test/page', 1, origin)).toBe('ftp://outside.test/page')
  })

  it('ignores an unused legacy URL on a category', () => {
    expect(normalizeMenuTargetUrl('legacy-unused', null, origin)).toBeNull()
  })

  it('rejects a nonfunctional or executable target rather than guessing a core capability', () => {
    expect(() => normalizeMenuTargetUrl('http://', 2, origin)).toThrow()
    expect(() => normalizeMenuTargetUrl('javascript:alert(1)', 1, origin)).toThrow()
  })
})

it('keeps a root-relative double slash pathname on the current host', () => {
  expect(normalizeMenuTargetUrl('/a/..//user-management', 2, origin)).toBe('/.//user-management')
  expect(new URL(normalizeMenuTargetUrl('/a/..//user-management', 2, origin)!, origin).origin).toBe(origin)
})
