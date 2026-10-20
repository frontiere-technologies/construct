import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUserPreferences: vi.fn(),
  cookieGet: vi.fn(),
}))

vi.mock('@/lib/auth-session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/user-preferences', () => ({ getUserPreferences: mocks.getUserPreferences }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookieGet }) }))

const { getAppearance } = await import('./appearance-server')

describe('getAppearance', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset())
    mocks.cookieGet.mockReturnValue(undefined)
  })

  it('without a session does not read the preferences and falls back to the cookie', async () => {
    mocks.getSession.mockResolvedValue(null)
    mocks.cookieGet.mockReturnValue({ value: 'dark.120' })

    const appearance = await getAppearance()

    expect(mocks.getUserPreferences).not.toHaveBeenCalled()
    expect(mocks.cookieGet).toHaveBeenCalled()
    // Un visitatore anonimo ha sempre il modo chiaro: dal cookie si legge solo la scala.
    expect(appearance).toEqual({ mode: 'light', scale: 120 })
  })

  it('with a session takes the appearance from the user preferences', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.getUserPreferences.mockResolvedValue({ languageCode: 'it', themeMode: 'dark', textScale: 110 })

    expect(await getAppearance()).toEqual({ mode: 'dark', scale: 110 })
    expect(mocks.getUserPreferences).toHaveBeenCalledWith('user-1')
    expect(mocks.cookieGet).not.toHaveBeenCalled()
  })

  it('falls back to the cookie when the user row is missing or the read fails', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.getUserPreferences.mockResolvedValueOnce(null)
    await getAppearance()
    expect(mocks.cookieGet).toHaveBeenCalledTimes(1)

    mocks.getUserPreferences.mockRejectedValueOnce(new Error('boom'))
    await getAppearance()
    expect(mocks.cookieGet).toHaveBeenCalledTimes(2)
  })
})
