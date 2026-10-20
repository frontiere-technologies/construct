import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  withGlobal: vi.fn(),
  selected: vi.fn(),
  joined: vi.fn(),
  rows: [] as unknown[],
}))

vi.mock('@/lib/db/tenant-db', () => ({ withGlobal: mocks.withGlobal }))

const { getUserPreferences } = await import('./user-preferences')

/** Un `tx` finto: registra le colonne scelte e il join, e restituisce le righe preparate dal test. */
function fakeTransaction() {
  return {
    select: (columns: unknown) => {
      mocks.selected(columns)
      return {
        from: () => ({
          leftJoin: (...args: unknown[]) => {
            mocks.joined(...args)
            return { where: () => ({ limit: async () => mocks.rows }) }
          },
        }),
      }
    },
  }
}

describe('getUserPreferences', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => typeof mock === 'function' && mock.mockReset())
    mocks.rows = []
    mocks.withGlobal.mockImplementation((callback: (tx: unknown) => unknown) => callback(fakeTransaction()))
  })

  it('reads language, theme and text scale with a single withGlobal', async () => {
    mocks.rows = [{ languageCode: 'it', themeMode: 'dark', textScale: 110 }]

    expect(await getUserPreferences('user-1')).toEqual({ languageCode: 'it', themeMode: 'dark', textScale: 110 })

    expect(mocks.withGlobal).toHaveBeenCalledTimes(1)
    expect(Object.keys(mocks.selected.mock.calls[0][0] as object).sort()).toEqual(['languageCode', 'textScale', 'themeMode'])
    expect(mocks.joined).toHaveBeenCalledTimes(1)
  })

  it('keeps a missing profile language as null', async () => {
    mocks.rows = [{ languageCode: null, themeMode: 'system', textScale: 100 }]

    expect(await getUserPreferences('user-1')).toEqual({ languageCode: null, themeMode: 'system', textScale: 100 })
  })

  it('returns null when the user is not found', async () => {
    expect(await getUserPreferences('missing')).toBeNull()
    expect(mocks.withGlobal).toHaveBeenCalledTimes(1)
  })
})
