import type { Session } from 'next-auth'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { recordTenantAudit } from '@/lib/audit/tenant-audit'
import { tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { countRoundTrips, type RecordedStatement } from '@/lib/db/round-trips'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { deleteLanguage } from '@/lib/i18n/language-actions'
import { deleteTranslationKey } from '@/lib/i18n/translation-actions'
import { startSupport } from '@/lib/platform/support-actions'
import { platformMenuEntry } from '@/lib/platform/platform-access'
import { requirePlatformAdmin, requirePlatformAdminPage, requireSupportExit } from '@/lib/rbac/auth-guard'
import { resolveUserAuthorization } from '@/lib/rbac/auth-roles'
import { hasDeactivatedMembershipOnHost, hasInactiveMembershipOnHost, listAvailableTenants, resolveHostTenant } from './host-tenants'
import { ensureDefaultMembership, joinTenantByRegistration } from './membership'
import { getSystemRoleIds } from './system-roles'
import { chooseTenant, refreshTenant } from './tenant-actions'
import { defaultTestTenant, tenantIdForTest } from './testing'
import type { TenantId } from './tenant-id'
import { enterTenant, isSignInRefusedOnHost, revalidateTokenTenant, updateTokenTenant, type TokenTenant } from './token-tenant'

const mocks = vi.hoisted(() => ({ session: null as unknown, headers: new Headers(), update: vi.fn() }))
const counting = vi.hoisted(() => ({ statements: [] as RecordedStatement[], close: null as (() => Promise<void>) | null }))
vi.mock('@/lib/db/client', async original => {
  const actual = await original<typeof import('@/lib/db/client')>()
  const client = actual.createDatabase(process.env.TEST_DATABASE_URL ?? '', {
    max: 1,
    onQuery: (query, parameters) => counting.statements.push({ query, parameterCount: parameters.length }),
  })
  counting.close = client.close
  return { ...actual, db: client.database }
})
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('@/lib/auth', () => ({ unstable_update: mocks.update }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) },
}))
vi.mock('react', async original => ({ ...(await original<typeof import('react')>()), cache: <T>(fn: T) => fn }))

const DEFAULT = defaultTestTenant()
let B: TenantId
let dedicatedHost: string
let member: string
let outsider: string
let platformAdmin: string
let withoutRole: string
const people: string[] = []
let beforeB: unknown
let boundaryBefore: unknown
let validSupportToken: TokenTenant
let allRowsBeforeB: unknown

async function createPerson(isPlatformAdmin = false): Promise<string> {
  const [row] = await withGlobal(tx => tx.insert(users).values({
    email: `zzz_single_${unique()}@example.test`, idUserStatus: 2,
  }).returning({ id: users.id }))
  people.push(row.id)
  if (isPlatformAdmin) await withOwner(tx => tx.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, row.id)))
  return row.id
}

async function rows(tenantId: TenantId) {
  return withTenant(tenantId, async tx => ({
    memberships: await tx.select().from(tenantMembership).where(inArray(tenantMembership.userId, people)).orderBy(tenantMembership.userId),
    roles: await tx.select().from(userRole).where(inArray(userRole.userId, people)).orderBy(userRole.userId, userRole.idRole),
  }))
}

async function allTenantRows(tenantId: TenantId) {
  return withOwner(async tx => {
    const tables = await tx.execute<{ name: string }>(sql`select table_name as name from app_private.table_class where class = 'tenant' order by table_name`)
    const snapshot: Record<string, unknown> = {}
    for (const { name } of tables) {
      const [row] = await tx.execute<{ rows: unknown }>(sql`select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) as rows from ${sql.identifier('public')}.${sql.identifier(name)} r where id_tenant = ${tenantId}`)
      snapshot[name] = row.rows
    }
    return snapshot
  }, tenantId)
}

async function boundary() {
  return withGlobal(async tx => ({
    identity: await tx.execute(sql`select current_user, pg_has_role(current_user, 'construct_runtime', 'member') as runtime,
      pg_has_role(current_user, 'construct_platform', 'member') as platform`),
    rls: await tx.execute(sql`select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('tenant_membership', 'user_role', 'role', 'navigation_item') order by c.relname`),
    policies: await tx.execute(sql`select tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'public' order by tablename, policyname`),
  }))
}

function signedIn(userId: string): Session {
  return {
    user: {
      id: userId, accountActive: true, isPlatformAdmin: true, tenantState: 'ready', tenantId: DEFAULT,
      roleIds: [], provider: 'credentials', tenantName: 'Default', tenantNoneReason: null,
      supportUntil: null, supportReason: null,
    },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

function token(tenantId: TenantId, tenantState: 'ready' | 'support' = 'ready') {
  return { tenantId, tenantState, tenantHost: 'localhost', roleIds: [999], accountActive: true, isPlatformAdmin: true }
}

describeIntegration('single organization installation', () => {
  beforeAll(async () => {
    vi.stubEnv('CONSTRUCT_TENANCY_MODE', 'multi')
    const [row] = await withOwner(tx => tx.execute<{ id: string }>(sql`select app_private.create_tenant_from_template(${`zzz-single-${unique()}`}, 'ZZZ Single B')::text as id`))
    B = tenantIdForTest(Number(row.id))
    dedicatedHost = `zzz-single-${unique()}.localhost`
    await withOwner(tx => tx.execute(sql`insert into public.tenant_host(host, id_tenant, is_primary) values (${dedicatedHost}, ${B}, true)`))
    member = await createPerson()
    outsider = await createPerson()
    platformAdmin = await createPerson(true)
    withoutRole = await createPerson()
    await withTenant(DEFAULT, async tx => {
      const system = await getSystemRoleIds(tx)
      await tx.insert(tenantMembership).values([{ userId: member }, { userId: withoutRole }])
      await tx.insert(userRole).values({ userId: member, idRole: system.registered })
    })
    await withTenant(B, async tx => {
      const system = await getSystemRoleIds(tx)
      await tx.insert(tenantMembership).values([{ userId: member }, { userId: outsider, status: 'deactivated' }])
      await tx.insert(userRole).values({ userId: member, idRole: system.registered })
    })
    await withOwner(tx => tx.execute(sql`update public.tenant_settings set support_until = now() + interval '1 hour',
      support_granted_at = now(), support_granted_by = ${member}::uuid where id_tenant = ${B}`), B)
    await withTenant(B, tx => recordTenantAudit(tx, { userId: platformAdmin, email: 'platform@example.test', kind: 'platform' }, {
      operation: 'support.enter', objectType: 'tenant', objectId: B, details: { reason: 'T07 valid existing support' },
    }))
    validSupportToken = await revalidateTokenTenant(platformAdmin, token(B, 'support'), 'localhost')
    expect(validSupportToken.tenantState).toBe('support')
    expect((await revalidateTokenTenant(member, { ...token(B), tenantHost: dedicatedHost }, dedicatedHost)).tenantState).toBe('ready')
    beforeB = await rows(B)
    allRowsBeforeB = await allTenantRows(B)
    boundaryBefore = await boundary()
  }, 30_000)

  beforeEach(() => {
    vi.stubEnv('CONSTRUCT_TENANCY_MODE', 'single')
    vi.stubEnv('AUTH_URL', 'http://localhost:3000')
    mocks.headers = new Headers({ host: 'localhost:3000' })
    mocks.session = signedIn(platformAdmin)
    mocks.update.mockReset().mockImplementation(async (payload: unknown) => {
      const session = mocks.session as { user: { id: string } & Partial<TokenTenant> }
      return { user: await updateTokenTenant(session.user.id, session.user, mocks.headers.get('host')?.split(':')[0] ?? null, payload) }
    })
  })
  afterEach(() => vi.unstubAllEnvs())
  afterAll(async () => {
    vi.unstubAllEnvs()
    if (people.length) await withGlobal(tx => tx.delete(users).where(inArray(users.id, people)))
    if (B) await deleteTenantForTest(B)
    await closeOwner()
    await counting.close?.()
  }, 30_000)

  it('offers only default on the canonical host, ignoring last tenant B', async () => {
    await withGlobal(tx => tx.update(users).set({ lastTenantId: B }).where(eq(users.id, member)))
    expect((await listAvailableTenants(member, 'localhost')).map(t => t.tenantId)).toEqual([DEFAULT])
    expect((await enterTenant(member, 'localhost', { current: B, firstEntry: true })).tenantId).toBe(DEFAULT)
  })

  it('revalidates ready single within five trips without enumerating tenants or looking up default separately', async () => {
    counting.statements.length = 0
    const result = await revalidateTokenTenant(member, token(DEFAULT), 'localhost')
    expect(result).toMatchObject({ tenantId: DEFAULT, tenantState: 'ready', accountActive: true })
    const count = countRoundTrips(counting.statements)
    expect(count.statements).toBeGreaterThan(0)
    process.stdout.write(`[single-budget] ready: ${count.roundTrips} trips, ${count.statements} statements\n`)
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(5)
    expect(count.queries.join('\n')).not.toMatch(/available_tenants|host_tenant_ids|select coalesce\(/)

    for (const [previous, host] of [[token(B), 'localhost'], [token(DEFAULT), dedicatedHost]] as const) {
      counting.statements.length = 0
      expect(await revalidateTokenTenant(member, previous, host)).toMatchObject({ tenantId: null, tenantState: 'none', roleIds: [] })
      expect(countRoundTrips(counting.statements).queries.join('\n')).not.toMatch(/available_tenants|host_tenant_ids|select coalesce\(/)
    }
  })

  it('resolves public pages to default but refuses tenant access on dedicated, unknown or absent hosts', async () => {
    for (const host of [dedicatedHost, 'unknown.example', null]) {
      expect(await resolveHostTenant(host)).toBe(DEFAULT)
      expect(await listAvailableTenants(member, host)).toEqual([])
      expect((await enterTenant(member, host, { current: B, firstEntry: true })).tenantState).toBe('none')
    }
    expect((await listAvailableTenants(member, 'LOCALHOST.:3000')).map(t => t.tenantId)).toEqual([DEFAULT])
  })

  it('ignores deactivated or suspended memberships outside default when explaining a refusal', async () => {
    await withOwner(async tx => {
      await tx.execute(sql`delete from public.tenant_host where id_tenant = ${B}`)
      await tx.execute(sql`update public.tenant set status = 'suspended' where id = ${B}`)
    })
    try {
      expect(await hasDeactivatedMembershipOnHost(outsider, 'localhost')).toBe(false)
      expect(await isSignInRefusedOnHost(outsider, 'localhost')).toBe(false)
      expect(await hasInactiveMembershipOnHost(member, 'localhost')).toBe(false)
    } finally {
      await withOwner(async tx => {
        await tx.execute(sql`update public.tenant set status = 'active' where id = ${B}`)
        await tx.execute(sql`insert into public.tenant_host(host, id_tenant, is_primary) values (${dedicatedHost}, ${B}, true)`)
      })
    }
  })

  it('strips authority from old B and support tokens and ignores forged session updates', async () => {
    for (const [userId, previous] of [[member, token(B)], [platformAdmin, validSupportToken]] as const) {
      const result = await revalidateTokenTenant(userId, previous, 'localhost')
      expect(result).toMatchObject({ tenantId: null, tenantState: 'none', roleIds: [], isPlatformAdmin: false })
    }
    for (const payload of [{ user: { tenantId: B } }, { user: { supportTenantId: B } }]) {
      const result = await updateTokenTenant(member, token(DEFAULT), 'localhost', payload)
      expect(result.tenantId).toBe(DEFAULT)
      expect(result.tenantState).toBe('ready')
    }
  })

  it('creates no membership or role on sign in, registration, or direct authorization', async () => {
    const before = await rows(DEFAULT)
    for (const userId of [outsider, platformAdmin, withoutRole]) {
      const result = await enterTenant(userId, 'localhost', { current: null, firstEntry: true })
      expect(result.isPlatformAdmin).toBe(false)
      expect(result.roleIds).toEqual([])
      if (userId !== withoutRole) expect(result.tenantId).toBeNull()
      await withTenant(DEFAULT, tx => ensureDefaultMembership(tx, userId))
      expect(await joinTenantByRegistration(userId, DEFAULT)).toBeNull()
      expect((await resolveUserAuthorization(DEFAULT, userId, true)).roleIds).toEqual([])
    }
    expect(await rows(DEFAULT)).toEqual(before)
  })

  it('closes direct platform and selector doors including the common global-catalog guard', async () => {
    await expect(requirePlatformAdmin()).rejects.toThrow('Unauthorized')
    await expect(requireSupportExit()).rejects.toThrow('Unauthorized')
    await expect(deleteLanguage(999999)).rejects.toThrow('Unauthorized')
    await expect(deleteTranslationKey(999999)).rejects.toThrow('Unauthorized')
    await expect(startSupport(B, 'Single must close support')).rejects.toThrow('Unauthorized')
    await expect(requirePlatformAdminPage()).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(chooseTenant(DEFAULT)).rejects.toThrow('tenant_selection_disabled')
    expect(await platformMenuEntry(signedIn(platformAdmin))).toBeNull()
  })

  it('keeps retry available without choosing B, support, or a dedicated host', async () => {
    for (const [userId, previous, host] of [
      [member, token(B), 'localhost'],
      [platformAdmin, validSupportToken, 'localhost'],
      [member, token(DEFAULT), dedicatedHost],
    ] as const) {
      mocks.session = { user: { id: userId, ...previous } }
      mocks.headers = new Headers({ host })
      const before = await rows(DEFAULT)
      expect(await refreshTenant()).toBe('none')
      expect(await rows(DEFAULT)).toEqual(before)
    }
  })

  it('retry admits a person explicitly added to default in the meantime without assigning a role', async () => {
    mocks.session = { user: { id: outsider, tenantState: 'none', tenantId: null, accountActive: true } }
    expect(await refreshTenant()).toBe('none')
    await withTenant(DEFAULT, tx => tx.insert(tenantMembership).values({ userId: outsider }))
    try {
      const before = await rows(DEFAULT)
      expect(await refreshTenant()).toBe('ready')
      expect(await rows(DEFAULT)).toEqual(before)
    } finally {
      await withTenant(DEFAULT, tx => tx.delete(tenantMembership).where(eq(tenantMembership.userId, outsider)))
    }
  })

  it('returns to multi without changing B data, RLS policies or connection privileges', async () => {
    vi.stubEnv('CONSTRUCT_TENANCY_MODE', 'multi')
    expect((await listAvailableTenants(member, dedicatedHost)).map(t => t.tenantId)).toEqual([B])
    expect((await enterTenant(member, dedicatedHost, { current: B, firstEntry: false })).tenantId).toBe(B)
    expect(await rows(B)).toEqual(beforeB)
    expect(await allTenantRows(B)).toEqual(allRowsBeforeB)
    const currentBoundary = await boundary()
    expect(currentBoundary).toEqual(boundaryBefore)
    expect(currentBoundary.identity[0]).toMatchObject({ runtime: true, platform: false })
    expect(currentBoundary.rls.every(row => row.relrowsecurity === true && row.relforcerowsecurity === true)).toBe(true)
  })
})
