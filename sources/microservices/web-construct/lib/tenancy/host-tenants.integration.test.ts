import { afterAll, beforeAll, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { role, tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { listAvailableTenants, resolveHostTenant } from './host-tenants'
import { getSystemRoleIds } from './system-roles'
import { defaultTestTenant, tenantIdForTest } from './testing'
import type { TenantId } from './tenant-id'

/**
 * Tenant dell'indirizzo e tenant disponibili per la persona (specifica 2026-10-21, §2.4, MT4-DEC-1,
 * 2, 9, 10, 15; migrazione 0054). Tre tenant nati dal modello in beforeAll: A con un indirizzo
 * dedicato (al posto di `a.localhost`, un nome unico per esecuzione), C senza indirizzo e S sospeso,
 * anche lui senza indirizzo. Spariscono in afterAll con le persone di prova.
 */
const DEFAULT = defaultTestTenant()

let A: TenantId
let C: TenantId
let S: TenantId
let template: TenantId
let aHost: string
const createdTenants: TenantId[] = []
const createdUserIds: string[] = []

// Membro attivo del predefinito, di A, di C e di S; amministratore in C.
let memberOfAll: string
// Membro attivo soltanto di A.
let onlyA: string
// Appartenenza disattivata nel predefinito, attiva in C.
let deactivatedInDefault: string
// Appartenenza disattivata in A, nient'altro.
let deactivatedInA: string
// Account disattivato a livello globale, membro attivo di C.
let globallyDeactivated: string

async function createUser(idUserStatus = 2): Promise<string> {
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({ email: `zzz_host_tenants_${unique()}@example.test`, idUserStatus })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return row.id
}

async function createTenant(name: string): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-ht-${unique()}`.slice(0, 40)}, ${name})::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  return id
}

type Membership = { userId: string; status?: 'active' | 'deactivated'; admin?: boolean }

/** Appartenenze nel tenant indicato, con il ruolo base e, a richiesta, quello di amministratore. */
async function addMembers(tenantId: TenantId, members: Membership[]): Promise<void> {
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values(members.map(m => ({ userId: m.userId, status: m.status ?? 'active' })))
    await tx.insert(userRole).values(members.flatMap(m => [
      { userId: m.userId, idRole: system.registered },
      ...(m.admin ? [{ userId: m.userId, idRole: system.tenantAdmin }] : []),
    ]))
  })
}

async function hostTenantIds(host: string | null): Promise<number[]> {
  const rows = await withGlobal(tx => tx.execute<{ id: string }>(
    sql`select h.id::text as id from public.host_tenant_ids(${host}::text) as h(id) order by h.id`))
  return rows.map(row => Number(row.id))
}

async function hasDeactivatedOnHost(userId: string, host: string | null): Promise<boolean> {
  const [row] = await withGlobal(tx => tx.execute<{ result: boolean }>(
    sql`select public.has_deactivated_membership_on_host(${userId}::uuid, ${host}::text) as result`))
  return row.result
}

async function joinByRegistration(tx: TenantTx, userId: string): Promise<string | null> {
  const [row] = await tx.execute<{ status: string | null }>(
    sql`select public.join_by_registration(${userId}::uuid) as status`)
  return row.status
}

async function membershipStatus(tenantId: TenantId, userId: string): Promise<string[]> {
  const rows = await withTenant(tenantId, tx => tx.select({ status: tenantMembership.status })
    .from(tenantMembership).where(eq(tenantMembership.userId, userId)))
  return rows.map(row => row.status)
}

async function systemKeysOf(tenantId: TenantId, userId: string): Promise<string[]> {
  const rows = await withTenant(tenantId, tx => tx.select({ key: role.systemKey })
    .from(userRole)
    .innerJoin(role, and(eq(role.idTenant, userRole.idTenant), eq(role.idRole, userRole.idRole)))
    .where(eq(userRole.userId, userId)))
  return rows.map(row => row.key ?? '').sort()
}

async function setSelfRegistration(tenantId: TenantId, value: boolean): Promise<void> {
  await withTenant(tenantId, tx => tx.execute(sql`update public.tenant_settings set self_registration = ${value}`))
}

/** Il valore di app.tenant_id nella transazione; vuoto e assente valgono uguale (0046, current_tenant_id). */
const currentTenantSetting = sql`select coalesce(pg_catalog.current_setting('app.tenant_id', true), '') as value`

const rollback = new Error('rollback')

describeIntegration('host tenants and available tenants', () => {
  beforeAll(async () => {
    const [found] = await withGlobal(tx => tx.execute<{ id: string }>(
      sql`select id::text as id from public.tenant where is_template`))
    if (!found) throw new Error('template tenant missing: is migration 0050 applied?')
    template = tenantIdForTest(Number(found.id))

    A = await createTenant('ZZZ Alfa')
    C = await createTenant('ZZZ Charlie')
    S = await createTenant('ZZZ Sospeso')
    aHost = `zzz-a-${unique()}.localhost`
    await withOwner(async tx => {
      await tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${aHost}, ${A}, true)`)
      await tx.execute(sql`update public.tenant set status = 'suspended' where id = ${S}`)
    })

    memberOfAll = await createUser()
    onlyA = await createUser()
    deactivatedInDefault = await createUser()
    deactivatedInA = await createUser()
    globallyDeactivated = await createUser(1)

    await addMembers(DEFAULT, [
      { userId: memberOfAll },
      { userId: deactivatedInDefault, status: 'deactivated' },
    ])
    await addMembers(A, [
      { userId: memberOfAll },
      { userId: onlyA },
      { userId: deactivatedInA, status: 'deactivated' },
    ])
    await addMembers(C, [
      { userId: memberOfAll, admin: true },
      { userId: deactivatedInDefault },
      { userId: globallyDeactivated },
    ])
    await addMembers(S, [{ userId: memberOfAll }])
  }, 60_000)

  afterAll(async () => {
    // Passi indipendenti: uno che fallisce non lascia indietro gli altri. Appartenenze e ruoli
    // delle persone di prova spariscono con loro (ON DELETE CASCADE) in ogni tenant.
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    if (createdUserIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
    for (const id of createdTenants) await step(() => deleteTenantForTest(id))
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  }, 60_000)

  it('main address lists default and C but not A, template or suspended tenants', async () => {
    const onMain = await hostTenantIds(null)
    expect(onMain).toContain(DEFAULT)
    expect(onMain).toContain(C)
    for (const excluded of [A, template, S]) expect(onMain).not.toContain(excluded)

    // S è sospeso ma la persona vi è membro attivo: non compare lo stesso. Ordinati per nome.
    expect(await listAvailableTenants(memberOfAll, null)).toEqual([
      { tenantId: DEFAULT, name: 'Default', isAdmin: false },
      { tenantId: C, name: 'ZZZ Charlie', isAdmin: true },
    ])
    expect(await listAvailableTenants(onlyA, null)).toEqual([])
  })

  it('a.localhost lists only A', async () => {
    expect(await hostTenantIds(aHost)).toEqual([A])
    expect(await listAvailableTenants(memberOfAll, aHost)).toEqual([{ tenantId: A, name: 'ZZZ Alfa', isAdmin: false }])
    expect(await listAvailableTenants(onlyA, aHost)).toEqual([{ tenantId: A, name: 'ZZZ Alfa', isAdmin: false }])
    // Un indirizzo dedicato non ricade mai sull'indirizzo principale, anche senza tenant per la persona.
    expect(await listAvailableTenants(deactivatedInDefault, aHost)).toEqual([])
  })

  it('A.LOCALHOST and null host follow the same rules as a.localhost and the main address', async () => {
    const shouted = `${aHost.toUpperCase()}:3000`
    expect(await listAvailableTenants(memberOfAll, shouted)).toEqual(await listAvailableTenants(memberOfAll, aHost))
    expect(await listAvailableTenants(memberOfAll, `${aHost}.`)).toEqual(await listAvailableTenants(memberOfAll, aHost))
    // Anche la funzione SQL, chiamata direttamente, confronta l'indirizzo nella stessa forma.
    expect(await hostTenantIds(shouted)).toEqual([A])
    // Nullo, sconosciuto o non valido: l'indirizzo principale.
    const onMain = await listAvailableTenants(memberOfAll, null)
    expect(await listAvailableTenants(memberOfAll, 'LOCALHOST:3000')).toEqual(onMain)
    expect(await listAvailableTenants(memberOfAll, 'unknown.example')).toEqual(onMain)
    expect(await listAvailableTenants(memberOfAll, 'not a host')).toEqual(onMain)
    expect(await hostTenantIds('Unknown.Example:8080')).toEqual(await hostTenantIds(null))
  })

  it('a deactivated membership or a globally deactivated account is not available', async () => {
    // Disattivata nel predefinito, attiva in C: resta solo C.
    expect((await listAvailableTenants(deactivatedInDefault, null)).map(t => t.tenantId)).toEqual([C])
    expect(await listAvailableTenants(deactivatedInA, aHost)).toEqual([])
    // Account disattivato a livello globale: nessun tenant, anche con un'appartenenza attiva.
    expect(await listAvailableTenants(globallyDeactivated, null)).toEqual([])
  })

  it('available_tenants leaves app.tenant_id as it found it', async () => {
    // Dentro un tenant: dopo le funzioni la transazione lavora ancora nel tenant di partenza. Due
    // tenant di partenza, perché ogni ramo lascerebbe una traccia diversa: available_tenants finisce
    // la visita su C (l'ultimo per nome), has_deactivated_membership_on_host esce prima nel
    // predefinito (il primo per id). Da C quell'uscita anticipata non passa inosservata.
    for (const start of [DEFAULT, C]) await expectContextKept(start)

    // Senza tenant (withGlobal, come listAvailableTenants): dopo la chiamata ancora nessun tenant.
    const global = await withGlobal(async tx => {
      const [before] = await tx.execute<{ value: string }>(currentTenantSetting)
      await tx.execute(sql`select * from public.available_tenants(${memberOfAll}::uuid, null)`)
      await tx.execute(sql`select public.has_deactivated_membership_on_host(${deactivatedInDefault}::uuid, null)`)
      const [after] = await tx.execute<{ value: string }>(currentTenantSetting)
      return { before: before.value, after: after.value }
    })
    expect(global).toEqual({ before: '', after: '' })
  })

  async function expectContextKept(start: TenantId): Promise<void> {
    const seen = await withTenant(start, async tx => {
      const [before] = await tx.execute<{ value: string }>(currentTenantSetting)
      await tx.execute(sql`select * from public.available_tenants(${memberOfAll}::uuid, null)`)
      await tx.execute(sql`select * from public.available_tenants(${memberOfAll}::uuid, ${aHost})`)
      await tx.execute(sql`select * from public.available_tenants(${globallyDeactivated}::uuid, null)`)
      // Ramo con ritorno anticipato e ramo senza.
      await tx.execute(sql`select public.has_deactivated_membership_on_host(${deactivatedInDefault}::uuid, null)`)
      await tx.execute(sql`select public.has_deactivated_membership_on_host(${onlyA}::uuid, null)`)
      const [after] = await tx.execute<{ value: string }>(currentTenantSetting)
      // Le appartenenze visibili sono quelle del tenant di partenza, non dell'ultimo visitato:
      // memberOfAll è membro sia del predefinito sia di C, onlyA di nessuno dei due.
      const visible = await tx.select({ tenantId: tenantMembership.idTenant, userId: tenantMembership.userId })
        .from(tenantMembership)
        .where(inArray(tenantMembership.userId, [memberOfAll, onlyA]))
      return { before: before.value, after: after.value, visible }
    })
    expect(seen).toEqual({
      before: String(start),
      after: String(start),
      visible: [{ tenantId: start, userId: memberOfAll }],
    })
  }

  it('has_deactivated_membership_on_host is true only for a deactivated membership on that host', async () => {
    expect(await hasDeactivatedOnHost(deactivatedInDefault, null)).toBe(true)
    expect(await hasDeactivatedOnHost(deactivatedInDefault, aHost)).toBe(false)
    expect(await hasDeactivatedOnHost(deactivatedInA, aHost)).toBe(true)
    expect(await hasDeactivatedOnHost(deactivatedInA, `${aHost.toUpperCase()}:3000`)).toBe(true)
    expect(await hasDeactivatedOnHost(deactivatedInA, null)).toBe(false)
    expect(await hasDeactivatedOnHost(memberOfAll, null)).toBe(false)
    expect(await hasDeactivatedOnHost(memberOfAll, aHost)).toBe(false)
    // Lo stato globale dell'account non è un'appartenenza disattivata.
    expect(await hasDeactivatedOnHost(globallyDeactivated, null)).toBe(false)
  })

  it('join_by_registration creates membership and base role only when the tenant accepts it and the person belongs nowhere', async () => {
    const newcomer = await createUser()

    // A nasce dal modello con l'interruttore spento: niente appartenenza.
    expect(await withTenant(A, tx => joinByRegistration(tx, newcomer))).toBeNull()
    expect(await membershipStatus(A, newcomer)).toEqual([])

    await setSelfRegistration(A, true)
    try {
      // Una riga di impostazioni mancante vale come spento.
      let withoutSettings: string | null | undefined
      await expect(withTenant(A, async tx => {
        await tx.execute(sql`delete from public.tenant_settings`)
        withoutSettings = await joinByRegistration(tx, newcomer)
        throw rollback
      })).rejects.toBe(rollback)
      expect(withoutSettings).toBeNull()

      expect(await withTenant(A, tx => joinByRegistration(tx, newcomer))).toBe('active')
      expect(await membershipStatus(A, newcomer)).toEqual(['active'])
      expect(await systemKeysOf(A, newcomer)).toEqual(['REGISTERED'])
      // Una seconda chiamata ritorna lo stato che c'è, senza duplicare niente.
      expect(await withTenant(A, tx => joinByRegistration(tx, newcomer))).toBe('active')
      expect(await systemKeysOf(A, newcomer)).toEqual(['REGISTERED'])

      // Un'appartenenza disattivata non si riattiva: ritorna il suo stato.
      expect(await withTenant(A, tx => joinByRegistration(tx, deactivatedInA))).toBe('deactivated')
      expect(await membershipStatus(A, deactivatedInA)).toEqual(['deactivated'])
    } finally {
      await setSelfRegistration(A, false)
    }
  })

  it('join_by_registration does nothing for a member of another tenant', async () => {
    const memberOfC = await createUser()
    await addMembers(C, [{ userId: memberOfC }])
    await setSelfRegistration(A, true)
    try {
      expect(await withTenant(A, tx => joinByRegistration(tx, memberOfC))).toBeNull()
      expect(await membershipStatus(A, memberOfC)).toEqual([])
      expect(await systemKeysOf(A, memberOfC)).toEqual([])
      // Il tenant di partenza resta quello della transazione dopo la visita degli altri.
      const after = await withTenant(A, async tx => {
        await joinByRegistration(tx, memberOfC)
        const [row] = await tx.execute<{ value: string }>(currentTenantSetting)
        return row.value
      })
      expect(after).toBe(String(A))
    } finally {
      await setSelfRegistration(A, false)
    }
  })

  it('ensure_default_membership returns null when the default tenant refuses self registration', async () => {
    // Il predefinito è condiviso con chi usa il database di prova: l'interruttore si spegne solo in
    // una transazione che si annulla.
    const newcomer = await createUser()
    let seen: { newcomer: string | null; existing: string | null; rows: number } | undefined
    await expect(withTenant(DEFAULT, async tx => {
      await tx.execute(sql`update public.tenant_settings set self_registration = false`)
      const [created] = await tx.execute<{ status: string | null }>(
        sql`select public.ensure_default_membership(${newcomer}::uuid) as status`)
      // Chi è già membro continua a ricevere il suo stato: l'accesso non cambia per lui.
      const [existing] = await tx.execute<{ status: string | null }>(
        sql`select public.ensure_default_membership(${memberOfAll}::uuid) as status`)
      const rows = await tx.select().from(tenantMembership).where(eq(tenantMembership.userId, newcomer))
      seen = { newcomer: created.status, existing: existing.status, rows: rows.length }
      throw rollback
    })).rejects.toBe(rollback)
    expect(seen).toEqual({ newcomer: null, existing: 'active', rows: 0 })

    // Con l'interruttore acceso (il valore di partenza del predefinito) entra come oggi.
    const [row] = await withTenant(DEFAULT, tx => tx.execute<{ status: string | null }>(
      sql`select public.ensure_default_membership(${newcomer}::uuid) as status`))
    expect(row.status).toBe('active')
  })

  it("a suspended tenant's dedicated host gives an empty set, with no fallback to the main address", async () => {
    const sHost = `zzz-s-${unique()}.localhost`
    await withOwner(tx => tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${sHost}, ${S}, true)`))
    try {
      expect(await hostTenantIds(sHost)).toEqual([])
      // Controllo contro un passaggio a vuoto: l'indirizzo principale ha dei tenant.
      expect(await hostTenantIds(null)).toContain(DEFAULT)
      // memberOfAll è membro attivo di S e del predefinito: sull'indirizzo di S non trova niente.
      expect(await listAvailableTenants(memberOfAll, sHost)).toEqual([])
    } finally {
      await withOwner(tx => tx.execute(sql`delete from public.tenant_host where host = ${sHost}`))
    }
  })

  it('join_by_registration returns null for a suspended tenant and for the template, even with the switch on', async () => {
    const newcomer = await createUser()
    for (const target of [S, template]) {
      // L'interruttore si accende solo in una transazione che si annulla: il modello è condiviso.
      let joined: string | null | undefined
      let rows: number | undefined
      await expect(withTenant(target, async tx => {
        await tx.execute(sql`update public.tenant_settings set self_registration = true`)
        joined = await joinByRegistration(tx, newcomer)
        rows = (await tx.select().from(tenantMembership).where(eq(tenantMembership.userId, newcomer))).length
        throw rollback
      })).rejects.toBe(rollback)
      expect({ target, joined, rows }).toEqual({ target, joined: null, rows: 0 })
    }
  })

  it('resolveHostTenant returns A for a.localhost and default for unknown hosts', async () => {
    expect(await resolveHostTenant(aHost)).toBe(A)
    expect(await resolveHostTenant(`${aHost.toUpperCase()}:3000`)).toBe(A)
    expect(await resolveHostTenant('unknown.example')).toBe(DEFAULT)
    expect(await resolveHostTenant('localhost')).toBe(DEFAULT)
    expect(await resolveHostTenant(null)).toBe(DEFAULT)
    expect(await resolveHostTenant('not a host')).toBe(DEFAULT)
  })
})
