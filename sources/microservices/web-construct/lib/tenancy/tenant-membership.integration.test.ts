import { afterAll, beforeAll, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { role, tenant, tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds, type SystemRoleIds } from './system-roles'
import { defaultTestTenant, tenantIdForTest } from './testing'
import type { TenantId } from './tenant-id'

/**
 * Appartenenze per tenant e regola dell'ultimo amministratore per tenant (specifica 2026-10-20,
 * §2.1, §2.2, §2.5, MT2-DEC-12). Due tenant: il predefinito e un tenant B usa e getta, con i suoi
 * ruoli di sistema. Nel predefinito si scrivono solo utenti di prova e le loro appartenenze.
 */
const DEFAULT = defaultTestTenant()
const ROLE_TYPE_SYSTEM = 1

let B: TenantId
let defaultSystem: SystemRoleIds
let bRegistered: number
let bAdmin: number
const createdUserIds: string[] = []

// Amministratore di B: B ha sempre un amministratore attivo suo.
let bAdminUserId: string
// Membro attivo soltanto di B.
let onlyB: string
// Membro attivo del predefinito e di B, con il ruolo base in entrambi.
let memberOfBoth: string
// Amministratore attivo del predefinito, creato qui.
let defaultAdminUserId: string

async function createUser(): Promise<string> {
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({ email: `zzz_membership_${unique()}@example.test`, idUserStatus: 2 })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return row.id
}

/** I messaggi dell'errore e delle sue cause: Drizzle avvolge l'eccezione di Postgres. */
function messagesOf(error: unknown): string {
  const messages: string[] = []
  let current: unknown = error
  while (current && typeof current === 'object') {
    if ('message' in current) messages.push(String(current.message))
    current = 'cause' in current ? current.cause : undefined
  }
  return messages.join('\n')
}

async function expectDatabaseError(operation: Promise<unknown>, code: string): Promise<void> {
  let failure: unknown
  try {
    await operation
  } catch (error) {
    failure = error
  }
  expect(failure, `expected the database to refuse with ${code}`).toBeDefined()
  expect(messagesOf(failure)).toContain(code)
}

async function membershipIn(tenantId: TenantId, userId: string) {
  return withTenant(tenantId, tx => tx.select().from(tenantMembership).where(eq(tenantMembership.userId, userId)))
}

async function ensureDefaultMembership(tenantId: TenantId, userId: string): Promise<string | null> {
  const rows = await withTenant(tenantId, tx => tx.execute<{ status: string | null }>(
    sql`select public.ensure_default_membership(${userId}::uuid) as status`))
  return rows[0].status
}

describeIntegration('tenant memberships', () => {
  beforeAll(async () => {
    defaultSystem = await withTenant(DEFAULT, tx => getSystemRoleIds(tx))
    const [created] = await withOwner(tx => tx.insert(tenant)
      .values({ slug: `zzz-membership-${unique()}`.slice(0, 40), name: 'Membership B' })
      .returning({ id: tenant.id }))
    B = tenantIdForTest(created.id)

    bAdminUserId = await createUser()
    onlyB = await createUser()
    memberOfBoth = await createUser()
    defaultAdminUserId = await createUser()

    await withOwner(async tx => {
      const [registered] = await tx.insert(role).values({ description: 'B registered', idRoleType: ROLE_TYPE_SYSTEM, systemKey: 'REGISTERED' }).returning({ idRole: role.idRole })
      const [admin] = await tx.insert(role).values({ description: 'B admin', idRoleType: ROLE_TYPE_SYSTEM, systemKey: 'TENANT_ADMIN' }).returning({ idRole: role.idRole })
      bRegistered = registered.idRole
      bAdmin = admin.idRole
      await tx.insert(tenantMembership).values([
        { userId: bAdminUserId }, { userId: onlyB }, { userId: memberOfBoth },
      ])
      await tx.insert(userRole).values([
        { userId: bAdminUserId, idRole: bRegistered },
        { userId: bAdminUserId, idRole: bAdmin },
        { userId: onlyB, idRole: bRegistered },
        { userId: memberOfBoth, idRole: bRegistered },
      ])
    }, B)

    await withTenant(DEFAULT, async tx => {
      await tx.insert(tenantMembership).values([{ userId: memberOfBoth }, { userId: defaultAdminUserId }])
      await tx.insert(userRole).values([
        { userId: memberOfBoth, idRole: defaultSystem.registered },
        { userId: defaultAdminUserId, idRole: defaultSystem.registered },
        { userId: defaultAdminUserId, idRole: defaultSystem.tenantAdmin },
      ])
    })
    // DB remoto: tenant, quattro utenti e le righe dei due tenant in sequenza.
  }, 60_000)

  afterAll(async () => {
    // Passi indipendenti: uno che fallisce non lascia indietro gli altri. Appartenenze e ruoli
    // degli utenti di prova spariscono con gli utenti (ON DELETE CASCADE) in ogni tenant.
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    if (createdUserIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
    if (B !== undefined) {
      // Ogni delete nomina il tenant B: senza la sua policy un delete senza where toccherebbe anche il predefinito.
      await step(() => withOwner(async tx => {
        await tx.delete(tenantMembership).where(eq(tenantMembership.idTenant, B))
        await tx.delete(userRole).where(eq(userRole.idTenant, B))
        await tx.delete(role).where(eq(role.idTenant, B))
      }, B))
      await step(() => withOwner(tx => tx.delete(tenant).where(eq(tenant.id, B))))
    }
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  }, 30_000)

  it('a member of B is invisible and untouchable from the default tenant', async () => {
    expect(await withTenant(DEFAULT, tx => tx.select().from(tenantMembership).where(eq(tenantMembership.userId, onlyB)))).toEqual([])
    const updated = await withTenant(DEFAULT, tx => tx.update(tenantMembership).set({ status: 'deactivated' }).where(eq(tenantMembership.userId, onlyB)).returning())
    expect(updated).toEqual([])
    // Controllo contro un passaggio a vuoto: da B la riga c'è, ed è ancora attiva.
    expect((await membershipIn(B, onlyB)).map(row => row.status)).toEqual(['active'])
  })

  it('replace_user_roles_guarded refuses a non-member with not_a_member', async () => {
    await expectDatabaseError(
      withTenant(DEFAULT, tx => tx.execute(sql`select public.replace_user_roles_guarded(${onlyB}, '{}'::bigint[])`)),
      'not_a_member',
    )
    expect(await withTenant(DEFAULT, tx => tx.select().from(userRole).where(eq(userRole.userId, onlyB)))).toEqual([])
  })

  it('the last active admin of the default tenant cannot be deactivated even if B has admins', async () => {
    // Precondizione: B ha un amministratore attivo, che non deve salvare il predefinito.
    const [{ n }] = await withTenant(B, tx => tx.execute<{ n: string }>(sql`select app_private.count_active_admins()::text as n`))
    expect(Number(n)).toBeGreaterThan(0)
    // Nella stessa transazione gli altri amministratori del predefinito vengono disattivati, così
    // defaultAdminUserId resta l'ultimo; l'errore annulla tutto, e nessuna riga condivisa cambia.
    const leaveOnlyTheTestAdmin = sql`
      update public.tenant_membership set status = 'deactivated'
      where user_id <> ${defaultAdminUserId}
        and user_id in (select ur.user_id from public.user_role ur where ur.id_role = ${defaultSystem.tenantAdmin})`
    await expectDatabaseError(withTenant(DEFAULT, async tx => {
      await tx.execute(leaveOnlyTheTestAdmin)
      await tx.execute(sql`select public.set_membership_status_guarded(${defaultAdminUserId}, 'deactivated')`)
    }), 'last_active_administrator')
    await expectDatabaseError(withTenant(DEFAULT, async tx => {
      await tx.execute(leaveOnlyTheTestAdmin)
      await tx.execute(sql`select public.replace_user_roles_guarded(${defaultAdminUserId}, '{}'::bigint[])`)
    }), 'last_active_administrator')
    expect((await membershipIn(DEFAULT, defaultAdminUserId)).map(row => row.status)).toEqual(['active'])
  })

  it('deactivating a membership in the default tenant leaves B and users.id_user_status untouched', async () => {
    await withTenant(DEFAULT, tx => tx.execute(sql`select public.set_membership_status_guarded(${memberOfBoth}, 'deactivated')`))
    expect((await membershipIn(DEFAULT, memberOfBoth)).map(row => row.status)).toEqual(['deactivated'])
    expect((await membershipIn(B, memberOfBoth)).map(row => row.status)).toEqual(['active'])
    const [user] = await withGlobal(tx => tx.select({ status: users.idUserStatus }).from(users).where(eq(users.id, memberOfBoth)))
    expect(user.status).toBe(2)
  })

  it('set_membership_status_guarded rejects an unknown status with invalid_user_status', async () => {
    await expectDatabaseError(
      withTenant(DEFAULT, tx => tx.execute(sql`select public.set_membership_status_guarded(${defaultAdminUserId}, 'suspended')`)),
      'invalid_user_status',
    )
  })

  it('set_membership_status_guarded refuses a non-member with not_a_member', async () => {
    await expectDatabaseError(
      withTenant(DEFAULT, tx => tx.execute(sql`select public.set_membership_status_guarded(${onlyB}, 'active')`)),
      'not_a_member',
    )
  })

  it('deleting a membership removes its roles in that tenant', async () => {
    const userId = await createUser()
    await withTenant(DEFAULT, async tx => {
      await tx.insert(tenantMembership).values({ userId })
      await tx.insert(userRole).values({ userId, idRole: defaultSystem.registered })
    })
    await withOwner(async tx => {
      await tx.insert(tenantMembership).values({ userId })
      await tx.insert(userRole).values({ userId, idRole: bRegistered })
    }, B)

    await withTenant(DEFAULT, tx => tx.delete(tenantMembership).where(eq(tenantMembership.userId, userId)))

    expect(await withTenant(DEFAULT, tx => tx.select().from(userRole).where(eq(userRole.userId, userId)))).toEqual([])
    // I ruoli dell'altro tenant restano: la cascata vale per la coppia (tenant, persona).
    expect((await withTenant(B, tx => tx.select({ idRole: userRole.idRole }).from(userRole).where(eq(userRole.userId, userId)))))
      .toEqual([{ idRole: bRegistered }])
  })

  it('a role cannot be assigned without a membership in that tenant', async () => {
    const userId = await createUser()
    await expect(withTenant(DEFAULT, tx => tx.insert(userRole).values({ userId, idRole: defaultSystem.registered })))
      .rejects.toSatisfy(error => /user_role_membership_fkey/.test(messagesOf(error)))
  })

  it('ensure_default_membership creates an active membership for an unaffiliated user', async () => {
    const userId = await createUser()
    expect(await ensureDefaultMembership(DEFAULT, userId)).toBe('active')
    expect((await membershipIn(DEFAULT, userId)).map(row => row.status)).toEqual(['active'])
    // Una seconda chiamata non cambia nulla.
    expect(await ensureDefaultMembership(DEFAULT, userId)).toBe('active')
    expect(await membershipIn(DEFAULT, userId)).toHaveLength(1)
  })

  it('ensure_default_membership never reactivates a deactivated membership', async () => {
    const userId = await createUser()
    await withTenant(DEFAULT, tx => tx.insert(tenantMembership).values({ userId, status: 'deactivated' }))
    const [before] = await membershipIn(DEFAULT, userId)
    expect(await ensureDefaultMembership(DEFAULT, userId)).toBe('deactivated')
    const [after] = await membershipIn(DEFAULT, userId)
    expect(after).toEqual(before)
  })

  it('ensure_default_membership creates nothing for a member of B', async () => {
    expect(await ensureDefaultMembership(DEFAULT, onlyB)).toBeNull()
    expect(await membershipIn(DEFAULT, onlyB)).toEqual([])
  })

  it('ensure_default_membership creates nothing when the current tenant is not the default', async () => {
    const userId = await createUser()
    expect(await ensureDefaultMembership(B, userId)).toBeNull()
    expect(await membershipIn(B, userId)).toEqual([])
    expect(await membershipIn(DEFAULT, userId)).toEqual([])
  })

  it('ensure_default_membership leaves app.tenant_id as it found it', async () => {
    // Uscita anticipata: membro di un altro tenant, il giro sui tenant si ferma su B.
    const after = await withTenant(DEFAULT, async tx => {
      await tx.execute(sql`select public.ensure_default_membership(${onlyB}::uuid)`)
      return tx.execute<{ t: string }>(sql`select current_setting('app.tenant_id') as t`)
    })
    expect(after[0].t).toBe(String(DEFAULT))

    // Giro completo: nessun altro tenant, l'appartenenza nasce nel predefinito; la scrittura
    // successiva della stessa transazione resta nel predefinito.
    const userId = await createUser()
    const [{ t }] = await withTenant(DEFAULT, async tx => {
      await tx.execute(sql`select public.ensure_default_membership(${userId}::uuid)`)
      await tx.insert(userRole).values({ userId, idRole: defaultSystem.registered })
      return tx.execute<{ t: string }>(sql`select current_setting('app.tenant_id') as t`)
    })
    expect(t).toBe(String(DEFAULT))
    expect(await withTenant(DEFAULT, tx => tx.select({ idRole: userRole.idRole }).from(userRole)
      .where(and(eq(userRole.userId, userId), eq(userRole.idTenant, DEFAULT))))).toEqual([{ idRole: defaultSystem.registered }])
  })

  it('app_private.is_member_elsewhere sees other tenants and restores the context', async () => {
    const rows = await withTenant(DEFAULT, tx => tx.execute<{ b: boolean; nobody: boolean; t: string }>(sql`
      select app_private.is_member_elsewhere(${onlyB}::uuid) as b,
             app_private.is_member_elsewhere(${crypto.randomUUID()}::uuid) as nobody`))
    expect(rows[0]).toMatchObject({ b: true, nobody: false })
    const [{ t }] = await withTenant(B, async tx => {
      // Da B, il membro solo di B non è membro "altrove".
      const [{ elsewhere }] = await tx.execute<{ elsewhere: boolean }>(sql`select app_private.is_member_elsewhere(${onlyB}::uuid) as elsewhere`)
      expect(elsewhere).toBe(false)
      return tx.execute<{ t: string }>(sql`select current_setting('app.tenant_id') as t`)
    })
    expect(t).toBe(String(B))
  })
})
