import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { eq, like, sql } from 'drizzle-orm'
import { role, tenant, tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import { enterTenant, revalidateTokenTenant } from '@/lib/tenancy/token-tenant'
import { selectAuthorizationSnapshot } from './auth-roles'
import { USER_STATUS_ACTIVE, USER_STATUS_DEACTIVATED } from './types'

/**
 * Le guardie della piattaforma contro il database vero (specifica 2026-10-26, §3.1, MT5-DEC-1,
 * MT5-DEC-3). Finti sono solo i confini di Next e di Auth.js: la sessione, le intestazioni e
 * `notFound`. L'attributo si scrive come proprietario (un trigger lo nega al ruolo dell'app) e
 * le guardie lo rileggono dal database con la connessione normale dell'app.
 */
const mocks = vi.hoisted(() => ({
  session: null as unknown,
  headers: new Headers(),
}))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('next/navigation', async importOriginal => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) },
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}))

const { requirePlatformAdmin, requirePlatformAdminPage } = await import('./auth-guard')

const PREFIX = 'zzz_platform_guard_'
const MAIN_HOST = 'construct.example.test'

type TenantStateName = 'ready' | 'choose' | 'none'

function sessionOf(userId: string, tenantState: TenantStateName, isPlatformAdmin = true) {
  return {
    user: {
      id: userId,
      accountActive: true,
      tenantState,
      tenantId: tenantState === 'ready' ? defaultTestTenant() : null,
      isPlatformAdmin,
    },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

function onHost(host: string): void {
  mocks.headers = new Headers({ host })
}

async function createPerson(options: { platformAdmin: boolean; status?: number; tenantAdmin?: boolean }): Promise<{ id: string; email: string }> {
  const email = `${PREFIX}${unique()}@example.test`
  // Il flag lo scrive solo il proprietario: un trigger lo nega al ruolo dell'app.
  const [created] = await withOwner(tx => tx.insert(users)
    .values({ email, idUserStatus: options.status ?? USER_STATUS_ACTIVE, isPlatformAdmin: options.platformAdmin })
    .returning({ id: users.id }))
  if (options.tenantAdmin) {
    await withTenant(defaultTestTenant(), async tx => {
      const [admin] = await tx.select({ idRole: role.idRole }).from(role).where(eq(role.systemKey, 'TENANT_ADMIN'))
      await tx.insert(tenantMembership).values({ userId: created.id })
      await tx.insert(userRole).values({ userId: created.id, idRole: admin.idRole })
    })
  }
  return { id: created.id, email }
}

beforeEach(() => {
  mocks.session = null
  onHost(MAIN_HOST)
})

afterEach(async () => {
  await withGlobal(tx => tx.delete(users).where(like(users.email, `${PREFIX}%`)))
})

afterAll(closeOwner)

describeIntegration('platform admin guards', () => {
  it('requirePlatformAdmin refuses a tenant admin who is not platform admin', async () => {
    const person = await createPerson({ platformAdmin: false, tenantAdmin: true })
    mocks.session = sessionOf(person.id, 'ready', false)
    await expect(requirePlatformAdmin()).rejects.toThrow('Unauthorized')
    await expect(requirePlatformAdminPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('requirePlatformAdmin refuses without a session, a deactivated account and a flag only the token claims', async () => {
    await expect(requirePlatformAdmin()).rejects.toThrow('Unauthorized')
    await expect(requirePlatformAdminPage()).rejects.toThrow('NEXT_NOT_FOUND')

    const deactivated = await createPerson({ platformAdmin: true, status: USER_STATUS_DEACTIVATED })
    mocks.session = sessionOf(deactivated.id, 'none')
    await expect(requirePlatformAdmin()).rejects.toThrow('Unauthorized')

    // Il token dice ancora "amministratore", ma nel database non lo è più: conta il database.
    const demoted = await createPerson({ platformAdmin: true })
    await withOwner(tx => tx.update(users).set({ isPlatformAdmin: false }).where(eq(users.id, demoted.id)))
    mocks.session = sessionOf(demoted.id, 'none', true)
    await expect(requirePlatformAdmin()).rejects.toThrow('Unauthorized')
    await expect(requirePlatformAdminPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('requirePlatformAdmin works in state none, choose and ready on the main address', async () => {
    const person = await createPerson({ platformAdmin: true })
    for (const state of ['none', 'choose', 'ready'] as const) {
      mocks.session = sessionOf(person.id, state)
      expect(await requirePlatformAdmin()).toEqual({ userId: person.id, email: person.email })
      expect(await requirePlatformAdminPage()).toEqual({ userId: person.id, email: person.email })
    }
    // Un indirizzo che il registro non conosce vale come l'indirizzo principale.
    onHost('unknown.example.test')
    mocks.session = sessionOf(person.id, 'none')
    expect(await requirePlatformAdmin()).toEqual({ userId: person.id, email: person.email })
  })

  it('requirePlatformAdmin refuses on a dedicated host', async () => {
    const person = await createPerson({ platformAdmin: true })
    const dedicated = `zzz-guard-${unique()}.example.test`
    const [created] = await withOwner(tx => tx.insert(tenant)
      .values({ slug: `zzz-guard-${unique()}`.slice(0, 40), name: 'Guard dedicated' }).returning({ id: tenant.id }))
    const dedicatedTenant = tenantIdForTest(created.id)
    try {
      await withOwner(tx => tx.execute(sql`
        insert into public.tenant_host (host, id_tenant, is_primary) values (${dedicated}, ${dedicatedTenant}, true)`))
      onHost(dedicated)
      for (const state of ['none', 'choose', 'ready'] as const) {
        mocks.session = sessionOf(person.id, state)
        await expect(requirePlatformAdmin()).rejects.toThrow('Unauthorized')
        await expect(requirePlatformAdminPage()).rejects.toThrow('NEXT_NOT_FOUND')
      }
      // Sull'indirizzo principale la stessa persona passa.
      onHost(MAIN_HOST)
      expect(await requirePlatformAdmin()).toEqual({ userId: person.id, email: person.email })
    } finally {
      await deleteTenantForTest(dedicatedTenant)
    }
  }, 30_000)
})

describeIntegration('platform admin attribute in the authorization read', () => {
  it('reads the attribute in the authorization snapshot', async () => {
    const platform = await createPerson({ platformAdmin: true })
    const plain = await createPerson({ platformAdmin: false })
    const read = (userId: string) => withTenant(defaultTestTenant(), tx => selectAuthorizationSnapshot(tx, userId))
    expect((await read(platform.id)).isPlatformAdmin).toBe(true)
    expect((await read(plain.id)).isPlatformAdmin).toBe(false)
    expect((await read(crypto.randomUUID())).isPlatformAdmin).toBe(false)
  })

  it('puts a platform admin with no membership in state none, with the flag in the token', async () => {
    const person = await createPerson({ platformAdmin: true })
    const token = await enterTenant(person.id, null, { current: null, firstEntry: true })
    expect(token).toMatchObject({ tenantState: 'none', tenantId: null, accountActive: true, isPlatformAdmin: true })
    // Le richieste successive tengono la persona in `none`, ancora con il flag.
    expect(await revalidateTokenTenant(person.id, token, null)).toMatchObject({ tenantState: 'none', isPlatformAdmin: true })
  })

  it('carries the flag in a ready token only for a platform admin who is also a member', async () => {
    const member = await createPerson({ platformAdmin: true, tenantAdmin: true })
    const plain = await createPerson({ platformAdmin: false, tenantAdmin: true })
    for (const [person, expected] of [[member, true], [plain, false]] as const) {
      const entered = await enterTenant(person.id, null, { current: null, firstEntry: true })
      expect(entered).toMatchObject({ tenantState: 'ready', isPlatformAdmin: expected })
      expect(await revalidateTokenTenant(person.id, entered, null)).toMatchObject({ tenantState: 'ready', isPlatformAdmin: expected })
    }
    // Una persona che perde l'attributo lo perde dal token alla richiesta successiva.
    const entered = await enterTenant(member.id, null, { current: null, firstEntry: true })
    await withOwner(tx => tx.update(users).set({ isPlatformAdmin: false }).where(eq(users.id, member.id)))
    expect(await revalidateTokenTenant(member.id, entered, null)).toMatchObject({ tenantState: 'ready', isPlatformAdmin: false })
  })
})
