import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tenantIdForTest } from '@/lib/tenancy/testing'

/**
 * Il layout protetto (specifica 2026-10-21, §3.2, MT4-DEC-5): l'elenco dei tenant serve solo al
 * selettore della barra. Se la sua lettura fallisce manca il selettore, non ogni pagina protetta.
 */
const mocks = vi.hoisted(() => ({
  listAvailableTenants: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('@/lib/auth-session', () => ({ getSession: async () => ({ user: { id: 'u1', roleIds: [1] } }) }))
vi.mock('@/lib/rbac/navigation-service', () => ({ getSidebarMenu: async () => [{ id: 1 }] }))
vi.mock('@/lib/i18n/server', () => ({ getActiveLanguage: async () => ({ code: 'it' }) }))
vi.mock('@/lib/i18n/language-service', () => ({ getDefaultLanguage: async () => ({ code: 'it' }) }))
vi.mock('@/lib/tenancy/host-tenants', () => ({ listAvailableTenants: mocks.listAvailableTenants }))
vi.mock('@/lib/tenancy/request-host', () => ({ readRequestHost: async () => 'localhost' }))
vi.mock('@/lib/tenancy/request-tenant', async () => {
  const { tenantIdForTest: toTenant } = await import('@/lib/tenancy/testing')
  return { resolveRequestTenant: async () => toTenant(7) }
})
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.logError, warn: vi.fn(), info: vi.fn() }) }))
vi.mock('@/components/Layout', () => ({ Layout: () => null }))

const { default: ProtectedLayout } = await import('./layout')

interface LayoutProps {
  menuItems: unknown[]
  tenantSwitcher?: { current: { id: number; name: string }; tenants: { id: number; name: string }[] }
}

async function renderLayout(): Promise<LayoutProps> {
  const element = await ProtectedLayout({ children: null })
  return (element as { props: LayoutProps }).props
}

beforeEach(() => {
  mocks.listAvailableTenants.mockReset()
  mocks.logError.mockReset()
})

describe('ProtectedLayout', () => {
  it('passes the current tenant and the list to the switcher', async () => {
    mocks.listAvailableTenants.mockResolvedValue([
      { tenantId: tenantIdForTest(7), name: 'Alfa', isAdmin: true },
      { tenantId: tenantIdForTest(9), name: 'Beta', isAdmin: false },
    ])

    const props = await renderLayout()

    expect(props.tenantSwitcher).toEqual({
      current: { id: 7, name: 'Alfa' },
      tenants: [{ id: 7, name: 'Alfa' }, { id: 9, name: 'Beta' }],
    })
  })

  it('renders the page without the switcher when the tenant list cannot be read, and logs it', async () => {
    mocks.listAvailableTenants.mockRejectedValue(new Error('connection lost'))

    const props = await renderLayout()

    expect(props.menuItems).toEqual([{ id: 1 }])
    expect(props.tenantSwitcher).toBeUndefined()
    expect(mocks.logError).toHaveBeenCalledTimes(1)
  })
})
