import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from './system-roles'
import { chooseTenant, refreshTenant } from './tenant-actions'
import { defaultTestTenant, tenantIdForTest } from './testing'
import { updateTokenTenant } from './token-tenant'
import type { TenantId } from './tenant-id'

/**
 * La scelta del tenant e il cambio (specifica 2026-10-21, §3.1, §4 «Cambio», MT4-DEC-5, MT4-DEC-6,
 * MT4-DEC-16) sul database di prova. Fuori da una richiesta di Next: sessione, intestazioni,
 * `unstable_update` e `redirect` sono finti; elenco dei tenant e scrittura dell'ultimo usato sono
 * veri. Tre tenant nati dal modello: A con un indirizzo dedicato, C e D sull'indirizzo principale,
 * S sospeso. Spariscono in afterAll con le persone di prova.
 */
const mocks = vi.hoisted(() => ({
  session: null as unknown,
  headers: new Headers(),
  unstableUpdate: vi.fn(),
}))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('@/lib/auth', () => ({ unstable_update: mocks.unstableUpdate }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('next/navigation', () => ({
  // Come in Next, redirect lancia: qui con un messaggio che dice dove.
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) },
}))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))

const DEFAULT = defaultTestTenant()
let A: TenantId
let C: TenantId
let D: TenantId
let S: TenantId
let template: TenantId
let aHost: string
const createdTenants: TenantId[] = []
const createdUserIds: string[] = []

// Membro attivo del predefinito, di A, di C e di S; disattivato in D.
let person: string

async function createUser(): Promise<string> {
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({ email: `zzz_tenant_actions_${unique()}@example.test`, idUserStatus: 2 })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return row.id
}

async function createTenant(name: string): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-ta-${unique()}`.slice(0, 40)}, ${name})::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  return id
}

async function addMember(tenantId: TenantId, userId: string, status: 'active' | 'deactivated' = 'active'): Promise<void> {
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId, status })
    await tx.insert(userRole).values({ userId, idRole: system.registered })
  })
}

async function lastTenantOf(userId: string): Promise<number | null> {
  const [row] = await withGlobal(tx => tx.select({ last: users.lastTenantId }).from(users).where(eq(users.id, userId)))
  return row?.last ?? null
}

async function setLastTenant(userId: string, tenantId: TenantId | null): Promise<void> {
  await withGlobal(tx => tx.update(users).set({ lastTenantId: tenantId }).where(eq(users.id, userId)))
}

function signedIn(userId: string, tenantState: 'ready' | 'choose' | 'none' = 'choose') {
  return { user: { id: userId, accountActive: true, tenantState, tenantId: null }, expires: '2099-01-01T00:00:00.000Z' }
}

describeIntegration('tenant choice and switch', () => {
  beforeAll(async () => {
    const [found] = await withGlobal(tx => tx.execute<{ id: string }>(
      sql`select id::text as id from public.tenant where is_template`))
    if (!found) throw new Error('template tenant missing: is migration 0050 applied?')
    template = tenantIdForTest(Number(found.id))

    A = await createTenant('ZZZ Alfa')
    C = await createTenant('ZZZ Charlie')
    D = await createTenant('ZZZ Delta')
    S = await createTenant('ZZZ Sospeso')
    aHost = `zzz-ta-${unique()}.localhost`
    await withOwner(async tx => {
      await tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${aHost}, ${A}, true)`)
      await tx.execute(sql`update public.tenant set status = 'suspended' where id = ${S}`)
    })

    person = await createUser()
    await addMember(DEFAULT, person)
    await addMember(A, person)
    await addMember(C, person)
    await addMember(D, person, 'deactivated')
    await addMember(S, person)
  }, 60_000)

  afterAll(async () => {
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    if (createdUserIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
    for (const id of createdTenants) await step(() => deleteTenantForTest(id))
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  }, 60_000)

  beforeEach(async () => {
    mocks.session = signedIn(person)
    mocks.headers = new Headers({ host: 'localhost:3000' })
    mocks.unstableUpdate.mockReset().mockResolvedValue(null)
    await setLastTenant(person, DEFAULT)
  })

  describe('chooseTenant', () => {
    it('chooseTenant to an available tenant updates last_tenant_id', async () => {
      await expect(chooseTenant(C)).rejects.toThrow('NEXT_REDIRECT:/')

      expect(await lastTenantOf(person)).toBe(C)
      // Il token si aggiorna con il solo id richiesto: il callback jwt lo ricontrolla da sé.
      expect(mocks.unstableUpdate).toHaveBeenCalledTimes(1)
      expect(mocks.unstableUpdate).toHaveBeenCalledWith({ user: { tenantId: C } })

      // Dalla barra laterale, con un tenant già scelto, vale lo stesso.
      mocks.session = signedIn(person, 'ready')
      await expect(chooseTenant(DEFAULT)).rejects.toThrow('NEXT_REDIRECT:/')
      expect(await lastTenantOf(person)).toBe(DEFAULT)
    }, 30_000)

    it('chooseTenant to a tenant on another host, deactivated, template or missing is refused and changes nothing', async () => {
      const refused: Array<[string, number]> = [
        ['on another host', A],
        ['deactivated membership', D],
        ['suspended tenant', S],
        ['template', template],
        ['missing', 2_000_000_000],
      ]
      for (const [, tenantId] of refused) {
        await expect(chooseTenant(tenantId)).rejects.toThrow('tenant_not_available')
      }
      // Un valore che non è un id non arriva nemmeno al database.
      for (const forged of [Number.NaN, 1.5, -1, '3' as unknown as number]) {
        await expect(chooseTenant(forged)).rejects.toThrow('tenant_not_available')
      }

      expect(await lastTenantOf(person)).toBe(DEFAULT)
      expect(mocks.unstableUpdate).not.toHaveBeenCalled()

      // Sull'indirizzo di A, invece, A è disponibile e C no.
      mocks.headers = new Headers({ host: `${aHost.toUpperCase()}:3000` })
      await expect(chooseTenant(C)).rejects.toThrow('tenant_not_available')
      await expect(chooseTenant(A)).rejects.toThrow('NEXT_REDIRECT:/')
      expect(await lastTenantOf(person)).toBe(A)
    }, 30_000)

    it('without a signed-in person nothing is read or written', async () => {
      mocks.session = null
      await expect(chooseTenant(C)).rejects.toThrow('Unauthorized')
      mocks.session = { user: { id: '', accountActive: false, tenantState: 'none' }, expires: '2099-01-01T00:00:00.000Z' }
      await expect(chooseTenant(C)).rejects.toThrow('Unauthorized')

      expect(await lastTenantOf(person)).toBe(DEFAULT)
      expect(mocks.unstableUpdate).not.toHaveBeenCalled()
    })
  })

  describe('refreshTenant', () => {
    it('asks the token to recompute the tenant and goes home, without writing last_tenant_id', async () => {
      mocks.session = signedIn(person, 'none')
      await expect(refreshTenant()).rejects.toThrow('NEXT_REDIRECT:/')

      expect(mocks.unstableUpdate).toHaveBeenCalledWith({})
      expect(await lastTenantOf(person)).toBe(DEFAULT)
    })
  })

  describe('session update in the jwt callback (POST /api/auth/session)', () => {
    const readyToken = (tenantId: number, host: string | null = 'localhost') => ({
      tenantId, tenantState: 'ready' as const, tenantHost: host, tenantName: 'Default', accountActive: true, roleIds: [0],
    })

    it('a forged update with a tenant not available on the address changes nothing', async () => {
      for (const tenantId of [A, D, S, template, 2_000_000_000]) {
        const token = await updateTokenTenant(person, readyToken(DEFAULT), 'localhost', { user: { tenantId } })
        expect(token).toMatchObject({ tenantId: DEFAULT, tenantState: 'ready', tenantHost: 'localhost' })
      }
      expect(await lastTenantOf(person)).toBe(DEFAULT)
    }, 30_000)

    it('an update with a tenant available on the address is accepted and does not write last_tenant_id', async () => {
      const token = await updateTokenTenant(person, readyToken(DEFAULT), 'localhost', { user: { tenantId: C } })

      expect(token).toMatchObject({ tenantId: C, tenantState: 'ready', tenantHost: 'localhost', tenantName: 'ZZZ Charlie', accountActive: true })
      expect(token.roleIds.length).toBeGreaterThan(0)
      expect(await lastTenantOf(person)).toBe(DEFAULT)
    }, 30_000)
  })
})
