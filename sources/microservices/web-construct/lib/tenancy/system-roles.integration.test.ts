import { beforeEach, expect, it, vi } from 'vitest'
import { withTenant } from '@/lib/db/tenant-db'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from './system-roles'
import { resolveRequestTenant } from './request-tenant'
import { defaultTestTenant } from './testing'

// Fuori da una richiesta di Next: la sessione e le intestazioni sono finte, il database è vero.
const mocks = vi.hoisted(() => ({ session: null as unknown, headers: new Headers() }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  // Fuori da una richiesta di React `cache` non deduplica niente: qui serve una funzione nuda.
  cache: <T>(fn: T) => fn,
}))

describeIntegration('tenant context', () => {
  beforeEach(() => {
    mocks.session = null
    mocks.headers = new Headers({ host: 'localhost:3000' })
  })

  it('resolves the tenant of the address before sign-in from the tenant table', async () => {
    expect(await resolveRequestTenant()).toBe(defaultTestTenant())
  })

  it('resolves the tenant of the token when the session has one, and refuses a session without one', async () => {
    mocks.session = { user: { id: 'u1', tenantState: 'ready', tenantId: 42 } }
    expect(await resolveRequestTenant()).toBe(42)
    mocks.session = { user: { id: 'u1', tenantState: 'choose', tenantId: null } }
    await expect(resolveRequestTenant()).rejects.toThrow('tenant_not_selected')
  })

  it('finds the system roles of the tenant by key', async () => {
    expect(await withTenant(defaultTestTenant(), getSystemRoleIds)).toEqual({ registered: 0, tenantAdmin: 1 })
  })
})
