import postgres from 'postgres'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import {
  appTheme, menuEntry, menuEntryTag, permission, role, roleFunctionality, rolePermission, tenant, userRole, users,
} from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'

// Qui i 42501 sono l'esito atteso: senza questo il logger dell'app li scriverebbe come errori.
vi.mock('@/lib/logger', () => {
  const noop = () => undefined
  return { createLogger: () => ({ error: noop, warn: noop, info: noop, debug: noop }) }
})

const ROLE_TYPE_SYSTEM = 1
const ROLE_TYPE_SERVICE = 2
const A = defaultTestTenant()
let B: TenantId
let bRoleId: number
let bEntryId: number
let bAdminUserId: string
let aUserId: string

/** L'errore di Postgres dentro quello di Drizzle (0.45 avvolge la causa). */
function pgError(error: unknown): { code?: string; message?: string } {
  const outer = error as { code?: string; message?: string; cause?: { code?: string; message?: string } }
  return outer.cause ?? outer
}

describeIntegration('tenant isolation in the database', () => {
  beforeAll(async () => {
    const slug = `zzz-iso-${unique()}`.slice(0, 40)
    const [created] = await withOwner(tx => tx.insert(tenant).values({ slug, name: 'Isolation B' }).returning({ id: tenant.id }))
    B = tenantIdForTest(created.id)

    const [bAdmin] = await withGlobal(tx => tx.insert(users).values({ email: `zzz_iso_b_${unique()}@example.test`, idUserStatus: 2 }).returning({ id: users.id }))
    bAdminUserId = bAdmin.id
    const [aUser] = await withGlobal(tx => tx.insert(users).values({ email: `zzz_iso_a_${unique()}@example.test`, idUserStatus: 2 }).returning({ id: users.id }))
    aUserId = aUser.id

    await withOwner(async tx => {
      const [registered] = await tx.insert(role).values({ description: 'B registered', idRoleType: ROLE_TYPE_SYSTEM, systemKey: 'REGISTERED' }).returning({ idRole: role.idRole })
      const [admin] = await tx.insert(role).values({ description: 'B admin', idRoleType: ROLE_TYPE_SYSTEM, systemKey: 'TENANT_ADMIN' }).returning({ idRole: role.idRole })
      const [service] = await tx.insert(role).values({ description: 'B service', idRoleType: ROLE_TYPE_SERVICE }).returning({ idRole: role.idRole })
      await tx.insert(userRole).values([
        { userId: bAdminUserId, idRole: registered.idRole },
        { userId: bAdminUserId, idRole: admin.idRole },
      ])
      const [entry] = await tx.insert(menuEntry).values({ name: 'B entry' }).returning({ idMenuEntry: menuEntry.idMenuEntry })
      await tx.insert(menuEntryTag).values({ idMenuEntry: entry.idMenuEntry, tagLan: 'it', tag: 'zzz-iso' })
      await tx.insert(roleFunctionality).values({ idRole: service.idRole, idMenuEntry: entry.idMenuEntry })
      const [grant] = await tx.select({ idPermission: permission.idPermission }).from(permission).limit(1)
      await tx.insert(rolePermission).values({ idRole: service.idRole, idPermission: grant.idPermission })
      await tx.insert(appTheme).values({ primaryColor: '#123456' })
      bRoleId = service.idRole
      bEntryId = entry.idMenuEntry
    }, B)
  })

  // Pulisce anche quando un caso o la preparazione sono falliti a metà: le cancellazioni a cascata
  // portano via tag, funzionalità e permessi di B insieme a ruoli e voci.
  afterAll(async () => {
    try {
      if (B !== undefined) {
        // Ogni delete nomina il tenant B: se la policy di una tabella mancasse (come nella prova di
        // «il test morde»), un delete senza where porterebbe via anche le righe di A.
        await withOwner(async tx => {
          await tx.delete(appTheme).where(eq(appTheme.idTenant, B))
          await tx.delete(menuEntry).where(eq(menuEntry.idTenant, B))
          await tx.delete(userRole).where(eq(userRole.idTenant, B))
          await tx.delete(role).where(eq(role.idTenant, B))
        }, B)
        await withOwner(tx => tx.delete(tenant).where(eq(tenant.id, B)))
      }
      const userIds = [bAdminUserId, aUserId].filter(Boolean)
      if (userIds.length > 0) await withGlobal(tx => tx.delete(users).where(inArray(users.id, userIds)))
    } finally {
      await closeOwner()
    }
  })

  it('shows tenant A only its own rows', async () => {
    const tenants = await withTenant(A, async tx => [
      ...(await tx.select({ t: role.idTenant }).from(role)),
      ...(await tx.select({ t: userRole.idTenant }).from(userRole)),
      ...(await tx.select({ t: rolePermission.idTenant }).from(rolePermission)),
      ...(await tx.select({ t: menuEntry.idTenant }).from(menuEntry)),
      ...(await tx.select({ t: menuEntryTag.idTenant }).from(menuEntryTag)),
      ...(await tx.select({ t: roleFunctionality.idTenant }).from(roleFunctionality)),
      ...(await tx.select({ t: appTheme.idTenant }).from(appTheme)),
    ])
    expect(tenants.length).toBeGreaterThan(0)
    expect(new Set(tenants.map(row => row.t))).toEqual(new Set([A]))
  })

  it('cannot update or delete a row of tenant B by id', async () => {
    const updated = await withTenant(A, tx => tx.update(role).set({ description: 'hijacked' }).where(eq(role.idRole, bRoleId)).returning())
    const deleted = await withTenant(A, tx => tx.delete(menuEntry).where(eq(menuEntry.idMenuEntry, bEntryId)).returning())
    expect(updated).toHaveLength(0)
    expect(deleted).toHaveLength(0)
    // La riga di B è intatta (lo si vede dal suo tenant).
    const [intact] = await withTenant(B, tx => tx.select({ description: role.description }).from(role).where(eq(role.idRole, bRoleId)))
    expect(intact.description).toBe('B service')
  })

  it('cannot insert a row into tenant B', async () => {
    await expect(withTenant(A, tx => tx.insert(role).values({ idTenant: B, description: 'smuggled', idRoleType: ROLE_TYPE_SERVICE })))
      .rejects.toSatisfy(error => /row-level security/.test(pgError(error).message ?? ''))
  })

  it('cannot point a row of tenant A at a row of tenant B', async () => {
    await expect(withTenant(A, tx => tx.insert(userRole).values({ userId: aUserId, idRole: bRoleId })))
      .rejects.toSatisfy(error => pgError(error).code === '23503')
  })

  it('refuses every tenant table without a tenant', async () => {
    for (const table of [role, userRole, rolePermission, menuEntry, menuEntryTag, roleFunctionality, appTheme]) {
      await expect(withGlobal(tx => tx.select().from(table).limit(1)))
        .rejects.toSatisfy(error => pgError(error).code === '42501')
    }
  })

  it('still reads global tables without a tenant', async () => {
    const rows = await withGlobal(tx => tx.select({ id: users.id }).from(users).where(eq(users.id, aUserId)))
    expect(rows).toHaveLength(1)
  })

  it('gives each global table its class: read-only ones refuse writes, writable ones accept them', async () => {
    // global_read: l'app ha solo select su permission e tenant.
    await expect(withGlobal(tx => tx.insert(permission).values({ name: 'zzz-iso-denied', kind: 'CATEGORY' })))
      .rejects.toSatisfy(error => pgError(error).code === '42501' && /permission denied/.test(pgError(error).message ?? ''))
    await expect(withGlobal(tx => tx.update(tenant).set({ name: 'hijacked' }).where(eq(tenant.id, A))))
      .rejects.toSatisfy(error => pgError(error).code === '42501' && /permission denied/.test(pgError(error).message ?? ''))
    // global_write: users si scrive; la riga di prova sparisce nella stessa transazione.
    const written = await withGlobal(async tx => {
      const [row] = await tx.insert(users).values({ email: `zzz_iso_w_${unique()}@example.test`, idUserStatus: 2 }).returning({ id: users.id })
      await tx.delete(users).where(eq(users.id, row.id))
      return row
    })
    expect(written.id).toBeTruthy()
  })

  it('leaves no tenant behind on a reused connection', async () => {
    const client = postgres(process.env.TEST_DATABASE_URL!, { prepare: false, max: 1 })
    try {
      await client.begin(async tx => { await tx`select set_config('app.tenant_id', ${String(A)}, true)` })
      await expect(client`select count(*) from public.role`).rejects.toSatisfy(
        (error: { code?: string }) => error.code === '42501')
    } finally {
      await client.end({ timeout: 5 })
    }
  })

  it('keeps the last active administrator per tenant', async () => {
    // A ha i propri amministratori: non salvano B.
    await expect(withTenant(B, tx => tx.execute(sql`select public.replace_user_roles_guarded(${bAdminUserId}, '{}'::bigint[])`)))
      .rejects.toSatisfy(error => /last_active_administrator/.test(pgError(error).message ?? ''))
  })

  it('does not make tenants wait on each other for the administrator lock', async () => {
    const holder = postgres(process.env.TEST_DATABASE_URL!, { prepare: false, max: 1 })
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const holding = holder.begin(async tx => {
      await tx`select set_config('app.tenant_id', ${String(A)}, true)`
      await tx`select pg_advisory_xact_lock(49374202, ${A}::integer)`
      await held
    })
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
      const started = Date.now()
      await withTenant(B, tx => tx.execute(sql`select public.set_user_status_guarded(${bAdminUserId}, 2)`))
      expect(Date.now() - started).toBeLessThan(2000)
    } finally {
      release()
      await holding
      await holder.end({ timeout: 5 })
    }
  })

  it('holds construct_owner to the boundary too', async () => {
    await expect(withOwner(tx => tx.select().from(role).limit(1)))
      .rejects.toSatisfy(error => pgError(error).code === '42501')
  })

  it('removes the memberships of a deleted user in every tenant', async () => {
    const [temp] = await withGlobal(tx => tx.insert(users).values({ email: `zzz_iso_tmp_${unique()}@example.test`, idUserStatus: 2 }).returning({ id: users.id }))
    try {
      await withOwner(tx => tx.insert(userRole).values({ userId: temp.id, idRole: bRoleId }), B)
    } finally {
      await withGlobal(tx => tx.delete(users).where(eq(users.id, temp.id)))
    }
    const left = await withOwner(tx => tx.select().from(userRole).where(eq(userRole.userId, temp.id)), B)
    expect(left).toHaveLength(0)
  })
})
