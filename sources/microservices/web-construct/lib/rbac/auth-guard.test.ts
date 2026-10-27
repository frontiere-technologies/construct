import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import type { Actor } from './actor'
import type { PermissionCode } from './permission-catalog'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActor: vi.fn(),
  resolveSupportActor: vi.fn(),
  resolvePlatformAdmin: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) }),
}))

vi.mock('@/lib/auth-session', () => ({ getSession: mocks.getSession }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }))
// Come `./actor`: il modulo vero apre la connessione al database. La decisione vera (attributo,
// indirizzo dedicato) è provata in platform-guard.integration.test.ts.
vi.mock('./platform-admin', () => ({ resolvePlatformAdmin: mocks.resolvePlatformAdmin }))
// Il tenant viene dalla sessione già letta (pezzo 4, §3.1). Il modulo vero importa la sessione e il
// database: qui una copia della stessa regola, senza connessioni.
vi.mock('@/lib/tenancy/request-tenant', async () => {
  const { tenantIdForTest } = await import('@/lib/tenancy/testing')
  return {
    tenantFromSession: (session: { user?: { tenantState?: string; tenantId?: number | null } }) =>
      (session.user?.tenantState === 'ready' || session.user?.tenantState === 'support') && typeof session.user.tenantId === 'number'
        ? tenantIdForTest(session.user.tenantId)
        : null,
    isSupportSession: (session: { user?: { tenantState?: string } }) => session.user?.tenantState === 'support',
  }
})
// Mock completo, non parziale: il modulo vero importa `@/lib/db`, e un test unitario non deve
// aprire una connessione. `auth-guard` da `./actor` usa solo `resolveActor` e il tipo `Actor`.
vi.mock('./actor', () => ({ resolveActor: mocks.resolveActor, resolveSupportActor: mocks.resolveSupportActor }))

const {
  requireAdministrator, requireAdministratorPage, requirePagePermission, requirePermission,
  requirePlatformAdmin, requirePlatformAdminPage,
} = await import('./auth-guard')

const READY_SESSION = { user: { id: 'u1', tenantState: 'ready', tenantId: defaultTestTenant() } }

function actor(codes: PermissionCode[], isAdmin = false): Actor {
  return { userId: 'u1', tenantId: defaultTestTenant(), roleIds: isAdmin ? [0, 1] : [0, 7], isAdmin, isPlatformAdmin: false, permissions: new Set(codes) }
}

describe('requirePermission', () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue(READY_SESSION)
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
    mocks.getSession.mockResolvedValue(null)
    await expect(requirePermission('read-menu')).rejects.toThrow('Unauthorized')
    expect(mocks.resolveActor).not.toHaveBeenCalled()
  })

  it('rejects a deactivated account', async () => {
    mocks.resolveActor.mockResolvedValue(null)
    await expect(requirePermission('read-menu')).rejects.toThrow('Unauthorized')
  })

  it('reads the actor in the tenant of the session', async () => {
    mocks.resolveActor.mockResolvedValue(actor(['read-menu']))
    mocks.getSession.mockResolvedValue({ user: { id: 'u1', tenantState: 'ready', tenantId: 7 } })
    await requirePermission('read-menu')
    expect(mocks.resolveActor).toHaveBeenCalledWith(7, 'u1')
  })

  it.each(['choose', 'none'])('rejects a session in state %s as unauthorized, not as an error, without asking the database', async state => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u1', tenantState: state, tenantId: null } })
    await expect(requirePermission('read-menu')).rejects.toThrow('Unauthorized')
    await expect(requireAdministrator()).rejects.toThrow('Unauthorized')
    expect(mocks.resolveActor).not.toHaveBeenCalled()
  })
})

describe('requirePagePermission', () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue(READY_SESSION)
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

  it('redirects a session without a chosen tenant instead of failing', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u1', tenantState: 'choose', tenantId: null } })
    await expect(requirePagePermission('read-menu')).rejects.toThrow('NEXT_REDIRECT /')
    await expect(requireAdministratorPage()).rejects.toThrow('NEXT_REDIRECT /')
    expect(mocks.resolveActor).not.toHaveBeenCalled()
  })
})

describe('requireAdministrator', () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue(READY_SESSION)
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

describe('requirePlatformAdmin', () => {
  const admin = { userId: 'u1', email: 'admin@example.test' }

  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue(READY_SESSION)
    mocks.resolvePlatformAdmin.mockReset()
    mocks.notFound.mockClear()
    mocks.redirect.mockClear()
  })

  it.each([
    { tenantState: 'ready', tenantId: defaultTestTenant() },
    { tenantState: 'choose', tenantId: null },
    { tenantState: 'none', tenantId: null },
  ])('asks the database about the person in state $tenantState, whatever the tenant', async tenant => {
    mocks.getSession.mockResolvedValue({ user: { id: 'u1', ...tenant, isPlatformAdmin: false } })
    mocks.resolvePlatformAdmin.mockResolvedValue(admin)
    // Il flag della sessione non conta: decide la lettura dal database.
    await expect(requirePlatformAdmin()).resolves.toBe(admin)
    await expect(requirePlatformAdminPage()).resolves.toBe(admin)
    expect(mocks.resolvePlatformAdmin).toHaveBeenCalledWith('u1')
  })

  it('rejects an action when the database does not confirm the attribute', async () => {
    mocks.resolvePlatformAdmin.mockResolvedValue(null)
    mocks.getSession.mockResolvedValue({ user: { id: 'u1', tenantState: 'none', tenantId: null, isPlatformAdmin: true } })
    await expect(requirePlatformAdmin()).rejects.toThrow('Unauthorized')
  })

  it('answers a page with not-found, not with a redirect', async () => {
    mocks.resolvePlatformAdmin.mockResolvedValue(null)
    await expect(requirePlatformAdminPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('rejects without a session, without asking the database', async () => {
    mocks.getSession.mockResolvedValue(null)
    await expect(requirePlatformAdmin()).rejects.toThrow('Unauthorized')
    await expect(requirePlatformAdminPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.resolvePlatformAdmin).not.toHaveBeenCalled()
  })
})

// Pezzo 5a, Task 9 (§3.2, MT5-DEC-12): in assistenza la persona non è membro del tenant, e l'attore
// lo dà il permesso riletto dal database, non l'appartenenza.
describe('the actor of a support session', () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue({ user: { id: 'u1', tenantState: 'support', tenantId: defaultTestTenant() } })
    mocks.resolveActor.mockReset()
    mocks.resolveSupportActor.mockReset()
  })

  it('reads the support actor of the supported tenant, never the membership actor', async () => {
    mocks.resolveSupportActor.mockResolvedValue({ ...actor(['manage-roles'], true), support: true })
    await expect(requirePermission('manage-roles')).resolves.toMatchObject({ support: true })
    expect(mocks.resolveSupportActor).toHaveBeenCalledWith(defaultTestTenant(), 'u1')
    expect(mocks.resolveActor).not.toHaveBeenCalled()
  })

  it('refuses when the support conditions no longer hold', async () => {
    mocks.resolveSupportActor.mockResolvedValue(null)
    await expect(requirePermission('read-menu')).rejects.toThrow('Unauthorized')
  })
})
