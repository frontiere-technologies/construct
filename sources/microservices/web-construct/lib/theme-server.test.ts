import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rows: vi.fn(), withTenant: vi.fn(), logError: vi.fn(), resolveRequestTenant: vi.fn() }))

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
vi.mock('@/lib/tenancy/request-tenant', () => ({ resolveRequestTenant: mocks.resolveRequestTenant }))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.logError }) }))

const { getAppTheme, getRequestAppTheme } = await import('./theme-server')
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
    mocks.resolveRequestTenant.mockReset()
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

// La pagina di accesso è anonima e deve disegnarsi anche quando il database non risponde: il
// tenant ora si legge dal database, quindi anche la sua risoluzione deve ripiegare sui predefiniti.
describe('getRequestAppTheme', () => {
  beforeEach(() => {
    mocks.rows.mockReset()
    mocks.withTenant.mockReset()
    mocks.logError.mockReset()
    mocks.resolveRequestTenant.mockReset()
  })

  it('reads the theme of the tenant of the request', async () => {
    mocks.resolveRequestTenant.mockResolvedValue(defaultTestTenant())
    mocks.rows.mockResolvedValue([row])
    expect((await getRequestAppTheme()).primaryColor).toBe('#059669')
    expect(mocks.withTenant).toHaveBeenCalledWith(defaultTestTenant())
  })

  it('falls back to the defaults and logs when the tenant cannot be resolved', async () => {
    mocks.resolveRequestTenant.mockRejectedValue(new Error('connection refused'))
    expect(await getRequestAppTheme()).toEqual(DEFAULT_APP_THEME)
    expect(mocks.logError).toHaveBeenCalledOnce()
    expect(mocks.withTenant).not.toHaveBeenCalled()
  })
})
