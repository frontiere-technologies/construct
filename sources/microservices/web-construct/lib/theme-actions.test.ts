import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppTheme } from '@/lib/theme-vars'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  set: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/db', () => ({
  db: { update: () => ({ set: (values: unknown) => ({ returning: () => mocks.set(values) }) }) },
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.logError }) }))

const { saveAppTheme } = await import('./theme-actions')

const theme = (primaryColor: string, surfaces: Partial<AppTheme['surfaces']> = {}): AppTheme => ({
  primaryColor,
  surfaces: { light: {}, dark: {}, ...surfaces },
})

/** Una superficie scura nel modo chiaro: tutti i testi scuri si leggono male. */
const unreadable = theme('#4f46e5', { light: { card: '#1f2937' } })

const allNull = {
  primaryDark: null,
  backgroundLight: null, cardLight: null, accentLight: null, sidebarLight: null,
  backgroundDark: null, cardDark: null, accentDark: null, sidebarDark: null,
}

describe('saveAppTheme', () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset().mockResolvedValue({ userId: 'admin-1', roleIds: [1] })
    mocks.set.mockReset().mockResolvedValue([{ id: 1 }])
    mocks.logError.mockReset()
  })

  it('refuses anyone requireAdmin refuses', async () => {
    mocks.requireAdmin.mockRejectedValue(new Error('Unauthorized'))
    expect(await saveAppTheme(theme('#123456'))).toEqual({ saved: false, error: 'unauthorized' })
    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('logs a failure that is not a refusal, still answering unauthorized', async () => {
    mocks.requireAdmin.mockRejectedValue(new Error('connection refused'))
    expect(await saveAppTheme(theme('#123456'))).toEqual({ saved: false, error: 'unauthorized' })
    expect(mocks.logError).toHaveBeenCalledOnce()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it.each(['red', '#fff', '#12345g', ''])('refuses the primary colour %j', async value => {
    expect(await saveAppTheme(theme(value))).toEqual({ saved: false, error: 'invalid' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it.each(['red', '#fff', 'url(x)'])('refuses the surface %j', async value => {
    expect(await saveAppTheme(theme('#4f46e5', { dark: { sidebar: value } }))).toEqual({ saved: false, error: 'invalid' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('refuses a payload that is not a theme', async () => {
    expect(await saveAppTheme('#4f46e5' as unknown as AppTheme)).toEqual({ saved: false, error: 'invalid' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('stores every colour in lower case, and null for a surface left unchanged', async () => {
    const result = await saveAppTheme(theme('#ABCDEF', { light: { card: '#F8FAFC' }, dark: { sidebar: '#0B1220' } }))
    expect(result).toEqual({ saved: true, error: null })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      ...allNull,
      primaryColor: '#abcdef',
      cardLight: '#f8fafc',
      sidebarDark: '#0b1220',
    }))
  })

  it('stores the dark primary in lower case', async () => {
    expect(await saveAppTheme({ ...theme('#4f46e5'), primaryDark: '#FBBF24' })).toEqual({ saved: true, error: null })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ primaryColor: '#4f46e5', primaryDark: '#fbbf24' }))
  })

  it('clears the dark primary with null, so it is derived from the light one again', async () => {
    expect(await saveAppTheme({ ...theme('#4f46e5'), primaryDark: null })).toEqual({ saved: true, error: null })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ primaryDark: null }))
  })

  it.each(['red', '#fff', 'url(x)'])('refuses the dark primary %j', async value => {
    expect(await saveAppTheme({ ...theme('#4f46e5'), primaryDark: value })).toEqual({ saved: false, error: 'invalid' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('warns about a dark primary that no variant makes readable, and writes nothing', async () => {
    const result = await saveAppTheme({ ...theme('#4f46e5', { dark: { card: '#ffffff' } }), primaryDark: '#7a85f7' })
    expect(result).toMatchObject({ saved: false, error: null, warnings: expect.arrayContaining([
      { mode: 'dark', text: 'primary', surface: null, ratio: null },
    ]) })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('returns the warnings and writes nothing when the colours read badly', async () => {
    const result = await saveAppTheme(unreadable)
    expect(result.saved).toBe(false)
    expect(result.error).toBeNull()
    expect(result.saved === false && result.error === null && result.warnings.length).toBeGreaterThan(0)
    expect(result).toMatchObject({ warnings: expect.arrayContaining([
      expect.objectContaining({ mode: 'light', text: 'foreground', surface: 'card' }),
    ]) })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('writes the same colours once the admin acknowledges the warnings', async () => {
    expect(await saveAppTheme(unreadable, { acknowledgeWarnings: true })).toEqual({ saved: true, error: null })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ cardLight: '#1f2937' }))
  })

  it.each([
    ['null', null],
    ['the string "false"', { acknowledgeWarnings: 'false' }],
    ['the string "true"', { acknowledgeWarnings: 'true' }],
    ['a number', { acknowledgeWarnings: 1 }],
  ])('does not take %s as an acknowledgement, and does not throw', async (_name, options) => {
    const result = await saveAppTheme(unreadable, options as unknown as { acknowledgeWarnings?: boolean })
    expect(result).toMatchObject({ saved: false, error: null })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('saves a readable theme with null options', async () => {
    expect(await saveAppTheme(theme('#123456'), null as unknown as undefined)).toEqual({ saved: true, error: null })
  })

  it('reports a database failure instead of throwing', async () => {
    mocks.set.mockRejectedValue(new Error('boom'))
    expect(await saveAppTheme(theme('#123456'))).toEqual({ saved: false, error: 'failed' })
  })

  it('reports failure when no row was updated', async () => {
    mocks.set.mockResolvedValue([])
    expect(await saveAppTheme(theme('#123456'))).toEqual({ saved: false, error: 'failed' })
    expect(mocks.logError).toHaveBeenCalledOnce()
  })
})
