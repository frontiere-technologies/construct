import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMultiTenantEnabled, readTenancyMode } from './tenancy-mode'

afterEach(() => vi.unstubAllEnvs())

describe('installation tenancy mode', () => {
  it('defaults to multi and reads the private server variable', () => {
    vi.stubEnv('CONSTRUCT_TENANCY_MODE', undefined)
    expect(readTenancyMode()).toBe('multi')
    expect(isMultiTenantEnabled()).toBe(true)
    vi.stubEnv('CONSTRUCT_TENANCY_MODE', 'single')
    expect(readTenancyMode()).toBe('single')
    expect(isMultiTenantEnabled()).toBe(false)
    vi.stubEnv('CONSTRUCT_TENANCY_MODE', 'multi')
    expect(isMultiTenantEnabled()).toBe(true)
  })

  it.each(['singel', '', 'SINGLE', ' single '])('rejects unknown mode %j explicitly', mode => {
    vi.stubEnv('CONSTRUCT_TENANCY_MODE', mode)
    expect(() => readTenancyMode()).toThrow('CONSTRUCT_TENANCY_MODE')
  })
})
