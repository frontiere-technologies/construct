import { describe, expect, it } from 'vitest'
import { clientIp, hashRateLimitIdentifier } from './auth-rate-limit'

describe('authentication rate-limit identifiers', () => {
  it('uses the first proxy-provided address and ignores attacker-appended hops', () => {
    const request = new Request('https://app.example/login', {
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.2' },
    })
    expect(clientIp(request)).toBe('203.0.113.10')
  })

  it('prefers the ingress-controlled real IP over a spoofed forwarded chain', () => {
    const request = new Request('https://app.example/login', {
      headers: {
        'x-real-ip': '198.51.100.20',
        'x-forwarded-for': '1.2.3.4, 198.51.100.20',
      },
    })
    expect(clientIp(request)).toBe('198.51.100.20')
  })

  it('falls back to a stable unknown bucket when no client address is available', () => {
    expect(clientIp(new Request('https://app.example/login'))).toBe('unknown')
  })

  it('stores only keyed hashes rather than raw IPs, emails, or reset tokens', () => {
    const first = hashRateLimitIdentifier('person@example.com', 'secret')
    expect(first).toBe(hashRateLimitIdentifier('person@example.com', 'secret'))
    expect(first).not.toContain('person@example.com')
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })
})
