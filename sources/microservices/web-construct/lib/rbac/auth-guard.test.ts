import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveUserAuthorization: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('./auth-roles', () => ({ resolveUserAuthorization: mocks.resolveUserAuthorization }))

const { requireAdmin } = await import('./auth-guard')

describe('requireAdmin live authorization', () => {
  beforeEach(() => {
    mocks.auth.mockReset()
    mocks.resolveUserAuthorization.mockReset()
  })

  it('rejects a session whose stale JWT still claims administrator after demotion', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'user-1', roleIds: [0, 1], isAdmin: true } })
    mocks.resolveUserAuthorization.mockResolvedValue({ accountActive: true, roleIds: [0], isAdmin: false })
    await expect(requireAdmin()).rejects.toThrow('Unauthorized')
  })

  it('rejects a deactivated administrator', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'user-1', roleIds: [0, 1], isAdmin: true } })
    mocks.resolveUserAuthorization.mockResolvedValue({ accountActive: false, roleIds: [], isAdmin: false })
    await expect(requireAdmin()).rejects.toThrow('Unauthorized')
  })

  it('returns only the current database roles for an active administrator', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'user-1', roleIds: [0], isAdmin: false } })
    mocks.resolveUserAuthorization.mockResolvedValue({ accountActive: true, roleIds: [0, 1], isAdmin: true })
    await expect(requireAdmin()).resolves.toEqual({ userId: 'user-1', roleIds: [0, 1] })
  })
})
