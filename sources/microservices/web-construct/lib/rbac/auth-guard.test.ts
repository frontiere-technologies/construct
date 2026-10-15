import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import type { Actor } from './actor'
import type { PermissionCode } from './permission-catalog'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActor: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) }),
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
// Il tenant della richiesta ora si legge dal database: un test unitario non lo apre.
vi.mock('@/lib/tenancy/request-tenant', async () => {
  const { defaultTestTenant } = await import('@/lib/tenancy/testing')
  return { resolveRequestTenant: async () => defaultTestTenant() }
})
// Mock completo, non parziale: il modulo vero importa `@/lib/db`, e un test unitario non deve
// aprire una connessione. `auth-guard` da `./actor` usa solo `resolveActor` e il tipo `Actor`.
vi.mock('./actor', () => ({ resolveActor: mocks.resolveActor }))

const { requireAdministrator, requireAdministratorPage, requirePagePermission, requirePermission } = await import('./auth-guard')

function actor(codes: PermissionCode[], isAdmin = false): Actor {
  return { userId: 'u1', tenantId: defaultTestTenant(), roleIds: isAdmin ? [0, 1] : [0, 7], isAdmin, permissions: new Set(codes) }
}

describe('requirePermission', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    mocks.resolveActor.mockReset()
    mocks.redirect.mockClear()
  })

  it('returns the actor when the permission is held', async () => {
    const reader = actor(['read-menu'])
    mocks.resolveActor.mockResolvedValue(reader)
    await expect(requirePermission('read-menu')).resolves.toBe(reader)
  })

  it('rejects when the permission is missing', async () => {
    mocks.resolveActor.mockResolvedValue(actor(['read-menu']))
    await expect(requirePermission('manage-menu')).rejects.toThrow('Unauthorized')
  })

  it('rejects without a session, without asking the database', async () => {
    mocks.auth.mockResolvedValue(null)
    await expect(requirePermission('read-menu')).rejects.toThrow('Unauthorized')
    expect(mocks.resolveActor).not.toHaveBeenCalled()
  })

  it('rejects a deactivated account', async () => {
    mocks.resolveActor.mockResolvedValue(null)
    await expect(requirePermission('read-menu')).rejects.toThrow('Unauthorized')
  })
})

describe('requirePagePermission', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    mocks.resolveActor.mockReset()
    mocks.redirect.mockClear()
  })

  it('sends a user without the permission back to the home page', async () => {
    mocks.resolveActor.mockResolvedValue(actor([]))
    await expect(requirePagePermission('read-menu')).rejects.toThrow('NEXT_REDIRECT /')
    expect(mocks.redirect).toHaveBeenCalledWith('/')
  })

  it('returns the actor when the permission is held', async () => {
    const reader = actor(['read-menu'])
    mocks.resolveActor.mockResolvedValue(reader)
    await expect(requirePagePermission('read-menu')).resolves.toBe(reader)
  })
})

describe('requireAdministrator', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    mocks.resolveActor.mockReset()
    mocks.redirect.mockClear()
  })

  it('rejects a user who holds every catalog code but is not the Administrator', async () => {
    mocks.resolveActor.mockResolvedValue(actor(['read-menu', 'manage-menu']))
    await expect(requireAdministrator()).rejects.toThrow('Unauthorized')
  })

  it('accepts the Administrator', async () => {
    const admin = actor([], true)
    mocks.resolveActor.mockResolvedValue(admin)
    await expect(requireAdministrator()).resolves.toBe(admin)
  })

  it('redirects from a page instead of throwing', async () => {
    mocks.resolveActor.mockResolvedValue(actor([]))
    await expect(requireAdministratorPage()).rejects.toThrow('NEXT_REDIRECT /')
  })
})
