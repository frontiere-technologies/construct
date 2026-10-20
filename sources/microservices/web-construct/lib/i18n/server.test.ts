import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageDto } from './types'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUserPreferences: vi.fn(),
  logError: vi.fn(),
  listLanguages: vi.fn(),
  cookieValues: {} as Record<string, string>,
  acceptLanguage: null as string | null,
}))

vi.mock('@/lib/auth-session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/user-preferences', () => ({ getUserPreferences: mocks.getUserPreferences }))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.logError, warn: vi.fn() }) }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name in mocks.cookieValues ? { value: mocks.cookieValues[name] } : undefined) }),
  headers: async () => ({ get: () => mocks.acceptLanguage }),
}))
vi.mock('./language-service', () => ({ listLanguages: mocks.listLanguages }))
vi.mock('./dictionary-service', () => ({
  getDictionaryBundle: async () => ({ dict: {}, defaultDict: {} }),
}))

const { getI18n } = await import('./server')

const language = (id: number, code: string, isDefault = false): LanguageDto => ({
  id, code, locale: `${code}-${code.toUpperCase()}`, name: code, nativeName: code, isActive: true, isDefault,
})
const languages = [language(1, 'it', true), language(2, 'en'), language(3, 'de')]

describe('getI18n', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => typeof mock === 'function' && mock.mockReset())
    mocks.cookieValues = {}
    mocks.acceptLanguage = null
    mocks.listLanguages.mockResolvedValue(languages)
  })

  it('without a session does not read the preferences', async () => {
    mocks.getSession.mockResolvedValue(null)
    mocks.cookieValues = { construct_lang: 'en' }

    expect((await getI18n()).language.code).toBe('en')
    expect(mocks.getUserPreferences).not.toHaveBeenCalled()
  })

  it('with a session and a usable session choice does not need the profile', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.getUserPreferences.mockResolvedValue({ languageCode: 'de', themeMode: 'system', textScale: 100 })
    mocks.cookieValues = { construct_lang_session: 'en' }

    expect((await getI18n()).language.code).toBe('en')
    expect(mocks.getUserPreferences).not.toHaveBeenCalled()
  })

  it('with a session and no usable session choice takes the profile language', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.getUserPreferences.mockResolvedValue({ languageCode: 'de', themeMode: 'system', textScale: 100 })
    mocks.cookieValues = { construct_lang_session: 'xx' }

    expect((await getI18n()).language.code).toBe('de')
    expect(mocks.getUserPreferences).toHaveBeenCalledWith('user-1')
  })

  it('falls through to the other sources when the preferences cannot be read', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    const failure = new Error('boom')
    mocks.getUserPreferences.mockRejectedValue(failure)
    mocks.cookieValues = { construct_lang: 'en' }

    expect((await getI18n()).language.code).toBe('en')
    expect(mocks.logError).toHaveBeenCalledWith({ err: failure }, 'failed to read the user language preference')
  })

  // Nei route handler React cache() non memorizza: ogni getSession() in più è una transazione
  // del callback jwt di Auth.js. Una sola lettura per chiamata, su ogni percorso.
  describe('reads the session once per call', () => {
    it('anonymous', async () => {
      mocks.getSession.mockResolvedValue(null)
      await getI18n()
      expect(mocks.getSession).toHaveBeenCalledTimes(1)
    })

    it('with a usable session choice', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
      mocks.cookieValues = { construct_lang_session: 'en' }
      await getI18n()
      expect(mocks.getSession).toHaveBeenCalledTimes(1)
    })

    it('when the profile is needed', async () => {
      mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
      mocks.getUserPreferences.mockResolvedValue({ languageCode: 'de', themeMode: 'system', textScale: 100 })
      mocks.cookieValues = { construct_lang_session: 'xx' }
      await getI18n()
      expect(mocks.getSession).toHaveBeenCalledTimes(1)
    })
  })
})
