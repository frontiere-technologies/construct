import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rows: vi.fn(), withTenant: vi.fn(), logError: vi.fn() }))

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  // Fuori da una richiesta di React `cache` non deduplica niente: qui serve una funzione nuda.
  cache: <T>(fn: T) => fn,
}))
vi.mock('@/lib/db/tenant-db', () => ({
  withTenant: (tenantId: unknown, fn: (tx: unknown) => unknown) => {
    mocks.withTenant(tenantId)
    return fn({ select: () => ({ from: () => ({ limit: () => mocks.rows() }) }) })
  },
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.logError }) }))

const { getAppTheme } = await import('./theme-server')
const { DEFAULT_APP_THEME } = await import('./theme-vars')
const { defaultTestTenant } = await import('@/lib/tenancy/testing')

const row = {
  primaryColor: '#059669',
  primaryDark: '#34d399',
  backgroundLight: null, cardLight: '#fafafa', accentLight: null, sidebarLight: null,
  backgroundDark: '#000000', cardDark: null, accentDark: null, sidebarDark: '#0b1220',
}

describe('getAppTheme', () => {
  beforeEach(() => {
    mocks.rows.mockReset()
    mocks.withTenant.mockReset()
    mocks.logError.mockReset()
  })

  it('reads the primary colour and only the surfaces that were changed', async () => {
    mocks.rows.mockResolvedValue([row])
    expect(await getAppTheme(defaultTestTenant())).toEqual({
      primaryColor: '#059669',
      primaryDark: '#34d399',
      surfaces: { light: { card: '#fafafa' }, dark: { background: '#000000', sidebar: '#0b1220' } },
    })
  })

  it('reads inside the transaction of the tenant it was given', async () => {
    mocks.rows.mockResolvedValue([row])
    await getAppTheme(defaultTestTenant())
    expect(mocks.withTenant).toHaveBeenCalledWith(defaultTestTenant())
  })

  it('reads a missing dark primary as null: derived from the light one', async () => {
    mocks.rows.mockResolvedValue([{ ...row, primaryDark: null }])
    expect((await getAppTheme(defaultTestTenant())).primaryDark).toBeNull()
  })

  it('falls back to the defaults when the row is missing', async () => {
    mocks.rows.mockResolvedValue([])
    expect(await getAppTheme(defaultTestTenant())).toEqual(DEFAULT_APP_THEME)
  })

  it('falls back to the defaults and logs when the database fails', async () => {
    mocks.rows.mockRejectedValue(new Error('column "card_light" does not exist'))
    expect(await getAppTheme(defaultTestTenant())).toEqual(DEFAULT_APP_THEME)
    expect(mocks.logError).toHaveBeenCalledOnce()
  })
})
