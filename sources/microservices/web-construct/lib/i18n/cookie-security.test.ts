import { describe, expect, it } from 'vitest'
import { shouldUseSecureCookies } from './cookie-security'

describe('language cookie security', () => {
  it('follows the externally configured HTTPS scheme', () => {
    expect(shouldUseSecureCookies('https://app.example.com', 'production')).toBe(true)
    expect(shouldUseSecureCookies('http://construct.local', 'production')).toBe(false)
  })

  it('fails safe when a production external URL is absent or malformed', () => {
    expect(shouldUseSecureCookies(undefined, 'production')).toBe(true)
    expect(shouldUseSecureCookies('not a URL', 'production')).toBe(true)
  })

  it('allows an unset URL in local development', () => {
    expect(shouldUseSecureCookies(undefined, 'development')).toBe(false)
  })
})
