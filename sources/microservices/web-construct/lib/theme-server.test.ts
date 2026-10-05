import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rows: vi.fn(), logError: vi.fn() }))

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  // Fuori da una richiesta di React `cache` non deduplica niente: qui serve una funzione nuda.
  cache: <T>(fn: T) => fn,
}))
vi.mock('@/lib/db', () => ({
  db: { select: () => ({ from: () => ({ limit: () => mocks.rows() }) }) },
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.logError }) }))

const { getAppTheme } = await import('./theme-server')
const { DEFAULT_APP_THEME } = await import('./theme-vars')

const row = {
  primaryColor: '#059669',
  backgroundLight: null, cardLight: '#fafafa', accentLight: null, sidebarLight: null,
  backgroundDark: '#000000', cardDark: null, accentDark: null, sidebarDark: '#0b1220',
}

describe('getAppTheme', () => {
  beforeEach(() => {
    mocks.rows.mockReset()
    mocks.logError.mockReset()
  })

  it('reads the primary colour and only the surfaces that were changed', async () => {
    mocks.rows.mockResolvedValue([row])
    expect(await getAppTheme()).toEqual({
      primaryColor: '#059669',
      surfaces: { light: { card: '#fafafa' }, dark: { background: '#000000', sidebar: '#0b1220' } },
    })
  })

  it('falls back to the defaults when the row is missing', async () => {
    mocks.rows.mockResolvedValue([])
    expect(await getAppTheme()).toEqual(DEFAULT_APP_THEME)
  })

  it('falls back to the defaults and logs when the database fails', async () => {
    mocks.rows.mockRejectedValue(new Error('column "card_light" does not exist'))
    expect(await getAppTheme()).toEqual(DEFAULT_APP_THEME)
    expect(mocks.logError).toHaveBeenCalledOnce()
  })
})
