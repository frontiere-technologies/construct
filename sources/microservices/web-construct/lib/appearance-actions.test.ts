import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  set: vi.fn(),
  returning: vi.fn(),
  cookieSet: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: mocks.cookieSet }) }))
vi.mock('@/lib/db', () => ({
  db: {
    update: () => ({
      set: (values: unknown) => {
        mocks.set(values)
        return { where: () => ({ returning: mocks.returning }) }
      },
    }),
  },
}))

const { saveAppearance } = await import('./appearance-actions')

describe('saveAppearance', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset())
    mocks.auth.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.returning.mockResolvedValue([{ themeMode: 'dark', textScale: 110 }])
  })

  it('refuses a request without a session', async () => {
    mocks.auth.mockResolvedValue(null)
    expect(await saveAppearance({ mode: 'dark' })).toEqual({ error: 'Not authenticated' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it.each([{ mode: 'sepia' }, { scale: 105 }, {}])('refuses %j without writing', async patch => {
    expect((await saveAppearance(patch as never)).error).toBe('Invalid appearance')
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('writes only the fields it was given', async () => {
    await saveAppearance({ mode: 'dark' })
    expect(mocks.set).toHaveBeenCalledWith({ themeMode: 'dark' })
  })

  it('returns the stored row and mirrors it into the cookie', async () => {
    const result = await saveAppearance({ scale: 110 })
    expect(result).toEqual({ error: null, appearance: { mode: 'dark', scale: 110 } })
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'construct_appearance', 'dark.110',
      expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'lax' }),
    )
  })

  it('reports a database failure instead of throwing', async () => {
    mocks.returning.mockRejectedValue(new Error('boom'))
    expect(await saveAppearance({ mode: 'light' })).toEqual({ error: 'Save failed' })
    expect(mocks.cookieSet).not.toHaveBeenCalled()
  })
})
