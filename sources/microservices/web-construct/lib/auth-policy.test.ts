import { describe, expect, it } from 'vitest'
import {
  assertSafeAuthConfiguration,
  evaluateAuthorization,
  isActiveAccount,
  isTestCredentialsEnabled,
  verifyCredentialCandidate,
} from './auth-policy'

describe('authentication policy', () => {
  it('treats only status 2 as active', () => {
    expect(isActiveAccount(2)).toBe(true)
    expect(isActiveAccount(1)).toBe(false)
    expect(isActiveAccount(null)).toBe(false)
  })

  it('never enables test credentials in production', () => {
    expect(isTestCredentialsEnabled({
      NODE_ENV: 'production',
      AUTH_TEST_CREDENTIALS: 'true',
    })).toBe(false)
  })

  it('enables test credentials only when both server and public flags are set outside production', () => {
    expect(isTestCredentialsEnabled({
      NODE_ENV: 'test',
      AUTH_TEST_CREDENTIALS: 'true',
      NEXT_PUBLIC_AUTH_TEST_MODE: 'true',
    })).toBe(true)
    expect(isTestCredentialsEnabled({
      NODE_ENV: 'test',
      AUTH_TEST_CREDENTIALS: 'true',
      NEXT_PUBLIC_AUTH_TEST_MODE: 'false',
    })).toBe(false)
  })

  it('fails closed when either test-auth flag is configured in production', () => {
    expect(() => assertSafeAuthConfiguration({
      NODE_ENV: 'production',
      AUTH_TEST_CREDENTIALS: 'true',
    })).toThrow(/test authentication/i)
    expect(() => assertSafeAuthConfiguration({
      NODE_ENV: 'production',
      NEXT_PUBLIC_AUTH_TEST_MODE: 'true',
    })).toThrow(/test authentication/i)
  })

  it('removes all authority from a missing or deactivated account', () => {
    expect(evaluateAuthorization(null, [1])).toEqual({ accountActive: false, roleIds: [], isAdmin: false })
    expect(evaluateAuthorization(1, [1])).toEqual({ accountActive: false, roleIds: [], isAdmin: false })
    expect(evaluateAuthorization(2, [0, 1])).toEqual({ accountActive: true, roleIds: [0, 1], isAdmin: true })
  })

  it('returns the same false result for unknown, passwordless, deactivated, and wrong-password accounts', async () => {
    const compare = async (password: string, hash: string) => password === 'correct' && hash === 'real-hash'

    expect(await verifyCredentialCandidate(null, 'guess', compare)).toBe(false)
    expect(await verifyCredentialCandidate({ passwordHash: null, idUserStatus: 2 }, 'guess', compare)).toBe(false)
    expect(await verifyCredentialCandidate({ passwordHash: 'real-hash', idUserStatus: 1 }, 'correct', compare)).toBe(false)
    expect(await verifyCredentialCandidate({ passwordHash: 'real-hash', idUserStatus: 2 }, 'guess', compare)).toBe(false)
    expect(await verifyCredentialCandidate({ passwordHash: 'real-hash', idUserStatus: 2 }, 'correct', compare)).toBe(true)
  })
})
