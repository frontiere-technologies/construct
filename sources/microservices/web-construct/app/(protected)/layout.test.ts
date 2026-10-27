import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tenantIdForTest } from '@/lib/tenancy/testing'

/**
 * Il layout protetto (specifica 2026-10-21, §3.2, MT4-DEC-5): l'elenco dei tenant serve solo al
 * selettore della barra. Se la sua lettura fallisce manca il selettore, non ogni pagina protetta.
 */
const mocks = vi.hoisted(() => ({
  listAvailableTenants: vi.fn(),
  logError: vi.fn(),
  session: { user: { id: 'u1', roleIds: [1] } } as {
    user: { id: string; roleIds: number[]; isPlatformAdmin?: boolean; tenantState?: string; tenantName?: string | null; supportUntil?: string | null }
  },
  resolvePlatformAdmin: vi.fn(),
}))

vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
// La voce "Piattaforma" (MT5-DEC-3): l'indizio del token non basta, l'attributo si rilegge dal database.
vi.mock('@/lib/rbac/platform-admin', () => ({ resolvePlatformAdmin: mocks.resolvePlatformAdmin }))
vi.mock('@/lib/rbac/navigation-service', () => ({ getSidebarMenu: async () => [{ id: 1 }] }))
vi.mock('@/lib/i18n/server', () => ({
  getActiveLanguage: async () => ({ code: 'it' }),
  getI18n: async () => ({ t: (key: string) => `«${key}»` }),
}))
vi.mock('@/lib/i18n/language-service', () => ({ getDefaultLanguage: async () => ({ code: 'it' }) }))
vi.mock('@/lib/tenancy/host-tenants', () => ({ listAvailableTenants: mocks.listAvailableTenants }))
vi.mock('@/lib/tenancy/request-host', () => ({ readRequestHost: async () => 'localhost' }))
vi.mock('@/lib/tenancy/request-tenant', async () => {
  const { tenantIdForTest: toTenant } = await import('@/lib/tenancy/testing')
  return { resolveRequestTenant: async () => toTenant(7) }
})
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: mocks.logError, warn: vi.fn(), info: vi.fn() }) }))
vi.mock('@/components/Layout', () => ({ Layout: () => null }))
vi.mock('@/components/tenancy/SupportBanner', () => ({ SupportBanner: () => null }))

const { default: ProtectedLayout } = await import('./layout')

interface LayoutProps {
  menuItems: unknown[]
  banner?: { props: { tenantName: string; until: string | null } }
  tenantSwitcher?: { current: { id: number; name: string }; tenants: { id: number; name: string }[] }
}

async function renderLayout(): Promise<LayoutProps> {
  const element = await ProtectedLayout({ children: null })
  return (element as { props: LayoutProps }).props
}

beforeEach(() => {
  mocks.listAvailableTenants.mockReset()
  mocks.logError.mockReset()
  mocks.resolvePlatformAdmin.mockReset()
  mocks.session = { user: { id: 'u1', roleIds: [1] } }
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

  it('adds no Platform entry, and reads nothing for it, for a person whose token does not claim the attribute', async () => {
    mocks.listAvailableTenants.mockResolvedValue([])
    const props = await renderLayout()
    expect(props.menuItems).toEqual([{ id: 1 }])
    expect(mocks.resolvePlatformAdmin).not.toHaveBeenCalled()
  })

  it('adds the Platform entry when the token claims the attribute and the database confirms it', async () => {
    mocks.listAvailableTenants.mockResolvedValue([])
    mocks.session = { user: { id: 'u1', roleIds: [1], isPlatformAdmin: true } }
    mocks.resolvePlatformAdmin.mockResolvedValue({ userId: 'u1', email: 'p@example.test' })

    const props = await renderLayout()

    expect(mocks.resolvePlatformAdmin).toHaveBeenCalledWith('u1')
    expect(props.menuItems).toHaveLength(2)
    expect(props.menuItems[1]).toMatchObject({ label: '«platform.nav.section»', route: '/platform', parentId: null })
  })

  it('does not trust the token: no entry when the database says the person is not an administrator here', async () => {
    mocks.listAvailableTenants.mockResolvedValue([])
    mocks.session = { user: { id: 'u1', roleIds: [1], isPlatformAdmin: true } }
    // Attributo tolto nel frattempo, oppure un indirizzo dedicato: la guardia risponde nulla in entrambi i casi.
    mocks.resolvePlatformAdmin.mockResolvedValue(null)

    const props = await renderLayout()

    expect(props.menuItems).toEqual([{ id: 1 }])
  })

  it('renders the page without the entry, and logs, when the check itself fails', async () => {
    mocks.listAvailableTenants.mockResolvedValue([])
    mocks.session = { user: { id: 'u1', roleIds: [1], isPlatformAdmin: true } }
    mocks.resolvePlatformAdmin.mockRejectedValue(new Error('connection lost'))

    const props = await renderLayout()

    expect(props.menuItems).toEqual([{ id: 1 }])
    expect(mocks.logError).toHaveBeenCalledTimes(1)
  })

  // Pezzo 5a, Task 9: in assistenza la fascia è sempre visibile, con tenant e scadenza (MT5-DEC-10).
  it('renders the support banner in support state, with the tenant and the expiry', async () => {
    mocks.listAvailableTenants.mockResolvedValue([])
    mocks.session = { user: { id: 'u1', roleIds: [1], tenantState: 'support', tenantName: 'Acme', supportUntil: '2026-10-27T12:00:00.000Z' } }

    const props = await renderLayout()

    expect(props.banner?.props).toEqual({ tenantName: 'Acme', until: '2026-10-27T12:00:00.000Z' })
    // Il tenant in assistenza non è fra quelli della persona: nessun selettore che porti altrove.
    expect(props.tenantSwitcher).toBeUndefined()
  })

  it('renders no banner outside support', async () => {
    mocks.listAvailableTenants.mockResolvedValue([])
    mocks.session = { user: { id: 'u1', roleIds: [1], tenantState: 'ready' } }
    expect((await renderLayout()).banner).toBeUndefined()
  })
})
