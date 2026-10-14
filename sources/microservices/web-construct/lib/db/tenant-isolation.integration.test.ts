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

/** Il 42501 che dà il contesto mancante, non un privilegio revocato: lo dice il messaggio. */
function isMissingTenantContext(error: unknown): boolean {
  const pg = pgError(error)
  return pg.code === '42501' && /tenant context missing/.test(pg.message ?? '')
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** 'done' se la promessa finisce entro `ms`, altrimenti 'waiting' (la promessa resta in corso). */
function settledWithin(promise: Promise<unknown>, ms: number): Promise<'done' | 'waiting'> {
  return Promise.race([promise.then(() => 'done' as const, () => 'done' as const), delay(ms).then(() => 'waiting' as const)])
}

/** Quanti lock advisory dell'invariante (chiave 49374202) sono presi sul tenant dato. */
async function adminLocksHeld(tenantId: TenantId): Promise<number> {
  const rows = await withGlobal(tx => tx.execute(sql`
    select count(*)::int as n from pg_locks
    where locktype = 'advisory' and classid = 49374202 and objid::bigint = ${tenantId} and objsubid = 2 and granted`))
  return Number((rows as unknown as Array<{ n: number }>)[0].n)
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
    // Ogni passo è indipendente: se uno fallisce, i successivi girano comunque e le righe
    // «zzz» non restano. L'errore del primo passo fallito viene rilanciato alla fine.
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    if (B !== undefined) {
      // Ogni delete nomina il tenant B: se la policy di una tabella mancasse, un delete senza
      // where porterebbe via anche le righe di A.
      await step(() => withOwner(async tx => {
        await tx.delete(appTheme).where(eq(appTheme.idTenant, B))
        await tx.delete(menuEntry).where(eq(menuEntry.idTenant, B))
        await tx.delete(userRole).where(eq(userRole.idTenant, B))
        await tx.delete(role).where(eq(role.idTenant, B))
      }, B))
      await step(() => withOwner(tx => tx.delete(tenant).where(eq(tenant.id, B))))
    }
    const userIds = [bAdminUserId, aUserId].filter(Boolean)
    if (userIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, userIds))))
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
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
    // Le righe di B sono intatte (lo si vede dal suo tenant).
    const [intact] = await withTenant(B, tx => tx.select({ description: role.description }).from(role).where(eq(role.idRole, bRoleId)))
    expect(intact.description).toBe('B service')
    const entries = await withTenant(B, tx => tx.select({ id: menuEntry.idMenuEntry }).from(menuEntry).where(eq(menuEntry.idMenuEntry, bEntryId)))
    expect(entries).toHaveLength(1)
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
        .rejects.toSatisfy(isMissingTenantContext)
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
      await expect(client`select count(*) from public.role`).rejects.toSatisfy(isMissingTenantContext)
    } finally {
      await client.end({ timeout: 5 })
    }
  })

  it('keeps the last active administrator per tenant', async () => {
    // Precondizione: A ha amministratori attivi propri. Senza, il caso passerebbe anche con un
    // conteggio globale.
    const [{ n }] = await withTenant(A, tx => tx.select({ n: sql<number>`count(*)::int` })
      .from(users)
      .innerJoin(userRole, eq(userRole.userId, users.id))
      .innerJoin(role, eq(role.idRole, userRole.idRole))
      .where(sql`${role.systemKey} = 'TENANT_ADMIN' and ${users.idUserStatus} = 2`))
    expect(n).toBeGreaterThan(0)
    // B ha un solo amministratore, e quelli di A non lo salvano.
    await expect(withTenant(B, tx => tx.execute(sql`select public.replace_user_roles_guarded(${bAdminUserId}, '{}'::bigint[])`)))
      .rejects.toSatisfy(error => /last_active_administrator/.test(pgError(error).message ?? ''))
  })

  it('does not let the administrators of A and B save a third tenant', async () => {
    // Il caso simmetrico, senza toccare gli amministratori veri del tenant predefinito: un tenant C
    // usa e getta con un solo amministratore, mentre A e B ne hanno.
    const slug = `zzz-iso-c-${unique()}`.slice(0, 40)
    const [created] = await withOwner(tx => tx.insert(tenant).values({ slug, name: 'Isolation C' }).returning({ id: tenant.id }))
    const C = tenantIdForTest(created.id)
    let cAdminId: string | undefined
    try {
      const [cAdmin] = await withGlobal(tx => tx.insert(users).values({ email: `zzz_iso_c_${unique()}@example.test`, idUserStatus: 2 }).returning({ id: users.id }))
      cAdminId = cAdmin.id
      await withOwner(async tx => {
        const [registered] = await tx.insert(role).values({ description: 'C registered', idRoleType: ROLE_TYPE_SYSTEM, systemKey: 'REGISTERED' }).returning({ idRole: role.idRole })
        const [admin] = await tx.insert(role).values({ description: 'C admin', idRoleType: ROLE_TYPE_SYSTEM, systemKey: 'TENANT_ADMIN' }).returning({ idRole: role.idRole })
        await tx.insert(userRole).values([
          { userId: cAdmin.id, idRole: registered.idRole },
          { userId: cAdmin.id, idRole: admin.idRole },
        ])
      }, C)
      await expect(withTenant(C, tx => tx.execute(sql`select public.replace_user_roles_guarded(${cAdmin.id}, '{}'::bigint[])`)))
        .rejects.toSatisfy(error => /last_active_administrator/.test(pgError(error).message ?? ''))
    } finally {
      if (cAdminId !== undefined) await withGlobal(tx => tx.delete(users).where(eq(users.id, cAdminId!))).catch(() => undefined)
      await withOwner(async tx => {
        await tx.delete(userRole).where(eq(userRole.idTenant, C))
        await tx.delete(role).where(eq(role.idTenant, C))
      }, C).catch(() => undefined)
      await withOwner(tx => tx.delete(tenant).where(eq(tenant.id, C)))
    }
  }, 30_000)

  it('takes the administrator lock per tenant: A waits on A, B does not', async () => {
    // Il lock lo prende una chiamata vera: set_user_status_guarded su un utente che lascia vero
    // l'invariante (aUserId resta attivo, e A ha già un amministratore attivo).
    const holder = postgres(process.env.TEST_DATABASE_URL!, { prepare: false, max: 1 })
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const holding = holder.begin(async tx => {
      await tx`select set_config('app.tenant_id', ${String(A)}, true)`
      await tx`select public.set_user_status_guarded(${aUserId}, 2)`
      await held
    })
    holding.catch(() => undefined)
    let pendingA: Promise<unknown> | undefined
    try {
      // Si aspetta che il lock sia davvero preso: nessuno sleep a occhio.
      const deadline = Date.now() + 10_000
      while (await adminLocksHeld(A) === 0) {
        if (Date.now() > deadline) throw new Error('the holder never took the administrator lock of A')
        await delay(50)
      }
      // Controllo positivo: una seconda operazione di A aspetta il lock di A.
      pendingA = withTenant(A, tx => tx.execute(sql`select public.set_user_status_guarded(${aUserId}, 2)`))
      pendingA.catch(() => undefined)
      expect(await settledWithin(pendingA, 1500)).toBe('waiting')
      // Una di B, nello stesso momento, non aspetta.
      const forB = withTenant(B, tx => tx.execute(sql`select public.set_user_status_guarded(${bAdminUserId}, 2)`))
      expect(await settledWithin(forB, 8000)).toBe('done')
      await forB
    } finally {
      // Sempre: il titolare rilascia, e l'operazione di A in attesa finisce prima di chiudere.
      release()
      await holding.catch(() => undefined)
      if (pendingA) await pendingA.catch(() => undefined)
      await holder.end({ timeout: 5 })
    }
    // Una volta rilasciato, l'operazione di A in attesa è finita davvero, non è stata annullata.
    await expect(pendingA).resolves.toBeDefined()
  }, 30_000)

  it('holds construct_owner to the boundary too', async () => {
    await expect(withOwner(tx => tx.select().from(role).limit(1)))
      .rejects.toSatisfy(isMissingTenantContext)
  })

  it('removes the memberships of a deleted user in every tenant', async () => {
    const [temp] = await withGlobal(tx => tx.insert(users).values({ email: `zzz_iso_tmp_${unique()}@example.test`, idUserStatus: 2 }).returning({ id: users.id }))
    try {
      const [aRegistered] = await withTenant(A, tx => tx.select({ idRole: role.idRole }).from(role).where(eq(role.systemKey, 'REGISTERED')))
      await withTenant(A, tx => tx.insert(userRole).values({ userId: temp.id, idRole: aRegistered.idRole }))
      await withOwner(tx => tx.insert(userRole).values({ userId: temp.id, idRole: bRoleId }), B)
      // Le due appartenenze esistono, una per tenant, prima della cancellazione.
      expect(await withTenant(A, tx => tx.select().from(userRole).where(eq(userRole.userId, temp.id)))).toHaveLength(1)
      expect(await withTenant(B, tx => tx.select().from(userRole).where(eq(userRole.userId, temp.id)))).toHaveLength(1)
    } finally {
      await withGlobal(tx => tx.delete(users).where(eq(users.id, temp.id)))
    }
    expect(await withTenant(A, tx => tx.select().from(userRole).where(eq(userRole.userId, temp.id)))).toHaveLength(0)
    expect(await withTenant(B, tx => tx.select().from(userRole).where(eq(userRole.userId, temp.id)))).toHaveLength(0)
  })
})
