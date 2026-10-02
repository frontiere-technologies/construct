import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  set: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/db', () => ({
  db: { update: () => ({ set: (values: unknown) => mocks.set(values) }) },
}))
vi.mock('@/lib/theme-vars', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/theme-vars')>()
  return { ...actual, derivePrimary: vi.fn(actual.derivePrimary) }
})

const { saveAppPrimaryColor } = await import('./theme-actions')
const { derivePrimary } = await import('@/lib/theme-vars')

describe('saveAppPrimaryColor', () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset().mockResolvedValue({ userId: 'admin-1', roleIds: [1] })
    mocks.set.mockReset().mockResolvedValue(undefined)
  })

  it('refuses anyone requireAdmin refuses', async () => {
    mocks.requireAdmin.mockRejectedValue(new Error('Unauthorized'))
    expect(await saveAppPrimaryColor('#123456')).toEqual({ error: 'unauthorized' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it.each(['red', '#fff', '#12345g', ''])('refuses %j', async value => {
    expect(await saveAppPrimaryColor(value)).toEqual({ error: 'invalid' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('refuses a colour with no readable variant', async () => {
    vi.mocked(derivePrimary).mockReturnValueOnce(null)
    expect(await saveAppPrimaryColor('#123456')).toEqual({ error: 'unreadable' })
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('stores the colour in lower case', async () => {
    expect(await saveAppPrimaryColor('#ABCDEF')).toEqual({ error: null })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ primaryColor: '#abcdef' }))
  })

  it('reports a database failure instead of throwing', async () => {
    mocks.set.mockRejectedValue(new Error('boom'))
    expect(await saveAppPrimaryColor('#123456')).toEqual({ error: 'failed' })
  })
})
