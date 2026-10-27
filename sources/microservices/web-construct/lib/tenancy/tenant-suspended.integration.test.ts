import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { passwordSetTokens, tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from './system-roles'
import { hasInactiveMembershipOnHost } from './host-tenants'
import { tenantIdForTest } from './testing'
import { enterTenant, revalidateTokenTenant, updateTokenTenant } from './token-tenant'
import type { TenantId } from './tenant-id'

/**
 * Un tenant sospeso o archiviato (specifica 2026-10-26, MT5-DEC-7, MT5-DEC-8, MT5-DEC-25) contro il
 * database vero: chi ci lavora ne esce alla richiesta successiva; chi non ha altri tenant
 * sull'indirizzo vede il messaggio del tenant sospeso (motivo `suspended` nel token), chi ne ha
 * altri li usa normalmente; il tenant non manda inviti. Finti sono solo i confini di Next, la guardia
 * dei permessi (la sessione dell'amministratore del tenant) e l'invio dell'email.
 */
const mocks = vi.hoisted(() => ({
  actor: null as null | { userId: string; tenantId: number; roleIds: number[]; isAdmin: boolean; permissions: Set<string> },
  sendEmail: vi.fn(),
}))
vi.mock('@/lib/rbac/auth-guard', () => ({
  requirePermission: async () => {
    if (!mocks.actor) throw new Error('Unauthorized')
    return mocks.actor
  },
}))
vi.mock('@/lib/mailer', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }) }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost:3000' }) }))

const { addUserByEmail } = await import('@/lib/rbac/users-actions')
const { POST: sendInvite } = await import('@/app/api/admin/send-invite/route')

const createdTenants: TenantId[] = []
const createdUserIds: string[] = []
let previousAuthUrl: string | undefined

async function seedTenant(label: string, options: { host?: string; status?: 'active' | 'suspended' | 'archived' } = {}): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-ts-${label}-${unique()}`.slice(0, 40)}, ${`ZZZ ${label}`})::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  await withOwner(async tx => {
    if (options.host) await tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${options.host}, ${id}, true)`)
    if (options.status) await tx.execute(sql`update public.tenant set status = ${options.status} where id = ${id}`)
  })
  return id
}

async function seedPerson(label: string, memberships: Array<{ tenant: TenantId; admin?: boolean }>): Promise<string> {
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({ email: `zzz_ts_${label}_${unique()}@example.test`, idUserStatus: 2, authProvider: 'credentials', passwordHash: 'x' })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  for (const membership of memberships) {
    await withTenant(membership.tenant, async tx => {
      const system = await getSystemRoleIds(tx)
      await tx.insert(tenantMembership).values({ userId: row.id, status: 'active' })
      await tx.insert(userRole).values([
        { userId: row.id, idRole: system.registered },
        ...(membership.admin ? [{ userId: row.id, idRole: system.tenantAdmin }] : []),
      ])
    })
  }
  return row.id
}

const setStatus = (id: TenantId, status: 'active' | 'suspended' | 'archived') =>
  withOwner(tx => tx.execute(sql`update public.tenant set status = ${status} where id = ${id}`))

/** Il token di chi sta lavorando nel tenant, come lo scrive il callback jwt. */
const readyToken = (tenantId: TenantId, host: string | null) =>
  ({ tenantState: 'ready' as const, tenantId, tenantHost: host, tenantName: 'x', accountActive: true, roleIds: [], isPlatformAdmin: false })

beforeAll(() => {
  previousAuthUrl = process.env.AUTH_URL
  process.env.AUTH_URL = 'http://localhost:3000'
})

afterAll(async () => {
  const errors: unknown[] = []
  const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
  if (previousAuthUrl === undefined) delete process.env.AUTH_URL; else process.env.AUTH_URL = previousAuthUrl
  for (const id of createdTenants) await step(() => deleteTenantForTest(id))
  if (createdUserIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
  await step(() => closeOwner())
  if (errors.length > 0) throw errors[0]
}, 60_000)

beforeEach(() => { mocks.sendEmail.mockReset().mockResolvedValue(undefined); mocks.actor = null })

describeIntegration('a suspended or archived tenant, for the people in it', () => {
  it('suspending moves members out at the next request and shows the suspended message to single-tenant people', async () => {
    const only = await seedTenant('only')
    const person = await seedPerson('single', [{ tenant: only }])
    const token = readyToken(only, null)

    // Prima: lavora nel tenant, e la rivalidazione lo conferma.
    expect(await revalidateTokenTenant(person, token, null)).toMatchObject({ tenantState: 'ready', tenantId: only, tenantNoneReason: null })

    await setStatus(only, 'suspended')
    const after = await revalidateTokenTenant(person, token, null)
    expect(after).toMatchObject({ tenantState: 'none', tenantId: null, tenantNoneReason: 'suspended', roleIds: [] })
    // L'account è globale e resta attivo: la persona resta riconosciuta e arriva al messaggio.
    expect(after.accountActive).toBe(true)

    // Archiviato vale come sospeso (MT5-DEC-8).
    await setStatus(only, 'archived')
    expect(await revalidateTokenTenant(person, token, null)).toMatchObject({ tenantState: 'none', tenantNoneReason: 'suspended' })

    // Riattivato: «Riprova» (l'aggiornamento senza tenant) la riporta dentro.
    await setStatus(only, 'active')
    expect(await updateTokenTenant(person, { tenantState: 'none' }, null, {})).toMatchObject({ tenantState: 'ready', tenantId: only, tenantNoneReason: null })
  }, 60_000)

  it('the reason follows the person into the next requests while the message is shown, and goes away on a new entry', async () => {
    const only = await seedTenant('stay', { status: 'suspended' })
    const person = await seedPerson('stay', [{ tenant: only }])
    const first = await enterTenant(person, null, { current: null, firstEntry: false })
    expect(first).toMatchObject({ tenantState: 'none', tenantNoneReason: 'suspended' })
    // Le richieste dopo lasciano il motivo com'è: la pagina non cambia messaggio da sola.
    expect(await revalidateTokenTenant(person, { ...first }, null)).toMatchObject({ tenantState: 'none', tenantNoneReason: 'suspended' })
  }, 60_000)

  it('people who work in other tenants as well use them normally: no message, they choose', async () => {
    const suspended = await seedTenant('multi-a')
    const other = await seedTenant('multi-b')
    const third = await seedTenant('multi-c')
    const person = await seedPerson('multi', [{ tenant: suspended }, { tenant: other }, { tenant: third }])
    await setStatus(suspended, 'suspended')
    const after = await revalidateTokenTenant(person, readyToken(suspended, null), null)
    expect(after).toMatchObject({ tenantState: 'choose', tenantNoneReason: null })

    // Con un solo altro tenant, un ingresso nuovo (accesso) entra lì e non mostra il messaggio.
    const solo = await seedPerson('duo', [{ tenant: suspended }, { tenant: other }])
    expect(await enterTenant(solo, null, { current: null, firstEntry: false })).toMatchObject({ tenantState: 'ready', tenantId: other, tenantNoneReason: null })
  }, 60_000)

  it('people with no membership in a suspended tenant keep the generic message', async () => {
    const suspended = await seedTenant('nobody', { status: 'suspended' })
    const stranger = await seedPerson('stranger', [])
    expect(await enterTenant(stranger, null, { current: null, firstEntry: false })).toMatchObject({ tenantState: 'none', tenantNoneReason: null })
    // Un'appartenenza disattivata nel tenant sospeso non è un'appartenenza (la gestisce il messaggio generico).
    const deactivated = await seedPerson('deact', [{ tenant: suspended }])
    await withTenant(suspended, tx => tx.update(tenantMembership).set({ status: 'deactivated' }).where(eq(tenantMembership.userId, deactivated)))
    expect(await hasInactiveMembershipOnHost(deactivated, null)).toBe(false)
  }, 60_000)

  it('only the tenants of the address count: a suspended tenant elsewhere does not colour the message', async () => {
    const host = `zzz-ts-${unique()}.example.test`
    const dedicated = await seedTenant('dedicated', { host, status: 'suspended' })
    const person = await seedPerson('dedperson', [{ tenant: dedicated }])
    // Sul suo indirizzo: il messaggio del tenant sospeso.
    expect(await hasInactiveMembershipOnHost(person, host)).toBe(true)
    expect(await hasInactiveMembershipOnHost(person, host.toUpperCase())).toBe(true)
    expect(await enterTenant(person, host, { current: null, firstEntry: false })).toMatchObject({ tenantState: 'none', tenantNoneReason: 'suspended' })
    // Sull'indirizzo principale quel tenant non c'è: messaggio generico.
    expect(await hasInactiveMembershipOnHost(person, null)).toBe(false)
    expect(await enterTenant(person, null, { current: null, firstEntry: false })).toMatchObject({ tenantState: 'none', tenantNoneReason: null })
  }, 60_000)

  it('the template never counts', async () => {
    const person = await seedPerson('tpl', [])
    expect(await hasInactiveMembershipOnHost(person, null)).toBe(false)
  }, 30_000)
})

describeIntegration('the doors of a suspended or archived tenant: no invitations', () => {
  async function adminOf(tenantId: TenantId) {
    const userId = await seedPerson('door-admin', [{ tenant: tenantId, admin: true }])
    mocks.actor = { userId, tenantId, roleIds: [], isAdmin: true, permissions: new Set(['invite-users']) }
    return userId
  }
  const accountCount = async (email: string) => (await withGlobal(tx => tx.select({ id: users.id }).from(users).where(eq(users.email, email)))).length

  it.each(['suspended', 'archived'] as const)('addUserByEmail is refused in a %s tenant: no account, no token, no email', async status => {
    const id = await seedTenant(`door-${status}`)
    await adminOf(id)
    await setStatus(id, status)
    const email = `zzz_ts_new_${unique()}@example.test`
    await expect(addUserByEmail(email)).rejects.toThrow()
    expect(await accountCount(email)).toBe(0)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  }, 60_000)

  it('addUserByEmail still works in an active tenant', async () => {
    const id = await seedTenant('door-active')
    await adminOf(id)
    const email = `zzz_ts_ok_${unique()}@example.test`
    await expect(addUserByEmail(email)).resolves.toEqual({ ok: true })
    const [account] = await withGlobal(tx => tx.select({ id: users.id }).from(users).where(eq(users.email, email)))
    createdUserIds.push(account.id)
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
  }, 60_000)

  it.each(['suspended', 'archived'] as const)('the send-invite route is refused in a %s tenant and creates no token', async status => {
    const id = await seedTenant(`route-${status}`)
    await adminOf(id)
    const waiting = await withGlobal(tx => tx.insert(users)
      .values({ email: `zzz_ts_wait_${unique()}@example.test`, idUserStatus: 2, authProvider: 'credentials' }).returning({ id: users.id }))
    createdUserIds.push(waiting[0].id)
    await withTenant(id, async tx => {
      const system = await getSystemRoleIds(tx)
      await tx.insert(tenantMembership).values({ userId: waiting[0].id, status: 'active' })
      await tx.insert(userRole).values({ userId: waiting[0].id, idRole: system.registered })
    })
    await setStatus(id, status)

    const response = await sendInvite(new NextRequest('http://localhost:3000/api/admin/send-invite', {
      method: 'POST', body: JSON.stringify({ userId: waiting[0].id }),
    }))
    expect(response.status).toBe(409)
    expect(await withGlobal(tx => tx.select({ id: passwordSetTokens.id }).from(passwordSetTokens).where(eq(passwordSetTokens.userId, waiting[0].id)))).toEqual([])
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  }, 60_000)
})
