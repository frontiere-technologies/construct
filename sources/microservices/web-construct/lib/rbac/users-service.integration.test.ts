import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { role, tenant, tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds, type SystemRoleIds } from '@/lib/tenancy/system-roles'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'

/**
 * La pagina Utenti dalle appartenenze (specifica 2026-10-20, §3.2, MT2-DEC-5, MT2-DEC-6): l'elenco
 * mostra i membri del tenant, la disattivazione agisce sull'appartenenza e "aggiungi persona"
 * risponde sempre allo stesso modo. Due tenant: il predefinito e un tenant B usa e getta.
 */
const mailer = vi.hoisted(() => ({ sendEmail: vi.fn<(message: unknown) => Promise<void>>(async () => {}) }))
vi.mock('@/lib/mailer', () => mailer)

const guard = vi.hoisted(() => ({
  actor: { userId: 'test', roleIds: [0, 1], isAdmin: true, permissions: new Set<string>() },
}))
vi.mock('@/lib/rbac/auth-guard', async () => {
  const { defaultTestTenant } = await import('@/lib/tenancy/testing')
  const current = () => ({ ...guard.actor, tenantId: defaultTestTenant() })
  return {
    requirePermission: async () => current(),
    requireAdministrator: async () => current(),
  }
})

const { listUsers, countUsers } = await import('./users-service')
const { addUserByEmail, setUserStatus, updateUserRoles } = await import('./users-actions')

const DEFAULT = defaultTestTenant()
const ACTIVE = 2
const DEACTIVATED = 1
// Ogni email di prova comincia così: la ripulitura e i filtri dell'elenco si appoggiano al prefisso.
const PREFIX = `zzz_users_${unique()}`
const DOMAIN = 'esempio.it'

let B: TenantId
let system: SystemRoleIds
let adminUserId: string
let bSystem: { registered: number; tenantAdmin: number }

const emailOf = (label: string) => `${PREFIX}_${label}@${DOMAIN}`

async function createUser(label: string, options: { password?: boolean } = {}): Promise<string> {
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({
      email: emailOf(label),
      authProvider: 'credentials',
      idUserStatus: ACTIVE,
      passwordHash: options.password ? 'hash-di-prova' : null,
    })
    .returning({ id: users.id }))
  return row.id
}

/** Un membro del tenant predefinito con il ruolo base, attivo o disattivato. */
async function defaultMember(label: string, status: 'active' | 'deactivated' = 'active'): Promise<string> {
  const id = await createUser(label)
  await withTenant(DEFAULT, async tx => {
    await tx.insert(tenantMembership).values({ userId: id, status })
    await tx.insert(userRole).values({ userId: id, idRole: system.registered })
  })
  return id
}

/** Un membro soltanto di B. */
async function bMember(label: string): Promise<string> {
  const id = await createUser(label)
  await withOwner(async tx => {
    await tx.insert(tenantMembership).values({ userId: id })
    await tx.insert(userRole).values({ userId: id, idRole: bSystem.registered })
  }, B)
  return id
}

const membershipStatus = async (tenantId: TenantId, userId: string) =>
  (await withTenant(tenantId, tx => tx.select({ status: tenantMembership.status }).from(tenantMembership)
    .where(eq(tenantMembership.userId, userId))))[0]?.status

const globalStatus = async (userId: string) =>
  (await withGlobal(tx => tx.select({ s: users.idUserStatus }).from(users).where(eq(users.id, userId))))[0].s

const rolesInDefault = async (userId: string) =>
  (await withTenant(DEFAULT, tx => tx.select({ idRole: userRole.idRole }).from(userRole).where(eq(userRole.userId, userId))))
    .map(row => row.idRole).sort((a, b) => a - b)

const accountsWithEmail = async (email: string) =>
  withGlobal(tx => tx.select({ id: users.id }).from(users).where(eq(users.email, email)))

const listAll = (extra: Partial<Parameters<typeof listUsers>[1]> = {}) =>
  listUsers(DEFAULT, { page: 0, size: 100, emailSearch: PREFIX, ...extra })

describeIntegration('users page from tenant memberships', () => {
  beforeAll(async () => {
    vi.stubEnv('AUTH_URL', 'http://localhost:3000')
    system = await withTenant(DEFAULT, tx => getSystemRoleIds(tx))
    const [created] = await withOwner(tx => tx.insert(tenant)
      .values({ slug: `zzz-users-${unique()}`.slice(0, 40), name: 'Users B' })
      .returning({ id: tenant.id }))
    B = tenantIdForTest(created.id)
    await withOwner(async tx => {
      const [registered] = await tx.insert(role).values({ description: 'B registered', idRoleType: 1, systemKey: 'REGISTERED' }).returning({ idRole: role.idRole })
      const [admin] = await tx.insert(role).values({ description: 'B admin', idRoleType: 1, systemKey: 'TENANT_ADMIN' }).returning({ idRole: role.idRole })
      bSystem = { registered: registered.idRole, tenantAdmin: admin.idRole }
    }, B)
    // Un amministratore attivo nel predefinito, perché le disattivazioni di prova non tocchino mai
    // l'ultimo amministratore vero del database.
    adminUserId = await createUser('admin')
    await withTenant(DEFAULT, async tx => {
      await tx.insert(tenantMembership).values({ userId: adminUserId })
      await tx.insert(userRole).values([
        { userId: adminUserId, idRole: system.registered },
        { userId: adminUserId, idRole: system.tenantAdmin },
      ])
    })
  }, 60_000)

  // L'attore è l'amministratore di prova: `requested_by` dell'invito è una chiave verso `users`.
  beforeEach(() => {
    guard.actor = { userId: adminUserId, roleIds: [0, 1], isAdmin: true, permissions: new Set() }
    mailer.sendEmail.mockReset()
    mailer.sendEmail.mockResolvedValue(undefined)
  })

  afterEach(() => {
    guard.actor = { userId: 'test', roleIds: [0, 1], isAdmin: true, permissions: new Set() }
  })

  afterAll(async () => {
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    // Appartenenze, ruoli e token spariscono con gli utenti (ON DELETE CASCADE).
    await step(() => withGlobal(tx => tx.delete(users).where(like(users.email, `${PREFIX}%`))))
    if (B !== undefined) {
      await step(() => withOwner(async tx => {
        await tx.delete(tenantMembership).where(eq(tenantMembership.idTenant, B))
        await tx.delete(userRole).where(eq(userRole.idTenant, B))
        await tx.delete(role).where(eq(role.idTenant, B))
      }, B))
      await step(() => withOwner(tx => tx.delete(tenant).where(eq(tenant.id, B))))
    }
    vi.unstubAllEnvs()
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  }, 30_000)

  it('lists only members of the current tenant, with the membership status', async () => {
    const active = await defaultMember('attivo')
    const deactivated = await defaultMember('disattivato', 'deactivated')
    const onlyB = await bMember('soloB')
    const noMembership = await createUser('senza')

    const { users: rows, total } = await listAll()
    const byId = new Map(rows.map(row => [row.id, row]))
    expect(byId.get(active)?.status.idUserStatus).toBe(ACTIVE)
    expect(byId.get(deactivated)?.status).toEqual({ idUserStatus: DEACTIVATED, description: 'Deactivated' })
    expect(byId.has(onlyB)).toBe(false)
    expect(byId.has(noMembership)).toBe(false)
    expect(byId.get(active)?.roles.map(r => r.id)).toEqual([system.registered])
    // Il totale conta le stesse righe che l'elenco mostra.
    expect(total).toBe(rows.length)
    expect(await countUsers(DEFAULT, { page: 0, size: 100, emailSearch: PREFIX })).toBe(total)
    // Dal tenant B si vede l'altro lato, non i membri del predefinito.
    const fromB = await listUsers(B, { page: 0, size: 100, emailSearch: PREFIX })
    expect(fromB.users.map(row => row.id)).toEqual([onlyB])
  })

  it('filters and sorts by the membership status', async () => {
    const active = await defaultMember('f_attivo')
    const deactivated = await defaultMember('f_disattivato', 'deactivated')

    const onlyDeactivated = await listAll({ statuses: [DEACTIVATED] })
    expect(onlyDeactivated.users.map(row => row.id)).toContain(deactivated)
    expect(onlyDeactivated.users.map(row => row.id)).not.toContain(active)
    expect(onlyDeactivated.users.every(row => row.status.idUserStatus === DEACTIVATED)).toBe(true)
    expect(onlyDeactivated.total).toBe(onlyDeactivated.users.length)

    const ascending = await listAll({ sort: 'status', direction: 'ASC' })
    const statuses = ascending.users.map(row => row.status.idUserStatus)
    expect(statuses).toEqual([...statuses].sort((a, b) => a - b))
    expect(statuses).toContain(DEACTIVATED)
    expect(statuses).toContain(ACTIVE)
  })

  it('setUserStatus deactivates the membership and leaves users.id_user_status at 2', async () => {
    const target = await defaultMember('da_disattivare')
    await setUserStatus(target, DEACTIVATED)
    expect(await membershipStatus(DEFAULT, target)).toBe('deactivated')
    expect(await globalStatus(target)).toBe(ACTIVE)

    await setUserStatus(target, ACTIVE)
    expect(await membershipStatus(DEFAULT, target)).toBe('active')
  })

  it('setUserStatus does not touch the same person in B', async () => {
    const both = await defaultMember('in_entrambi')
    await withOwner(tx => tx.insert(tenantMembership).values({ userId: both }), B)

    await setUserStatus(both, DEACTIVATED)
    expect(await membershipStatus(DEFAULT, both)).toBe('deactivated')
    expect(await membershipStatus(B, both)).toBe('active')
  })

  it('refuses a status change and a role change for a person who is not a member', async () => {
    const onlyB = await bMember('estraneo')
    await expect(setUserStatus(onlyB, DEACTIVATED)).rejects.toThrow('La persona non fa parte di questo tenant')
    await expect(updateUserRoles(onlyB, [system.registered])).rejects.toThrow('La persona non fa parte di questo tenant')
    expect(await membershipStatus(B, onlyB)).toBe('active')
  })

  it('addUserByEmail answers the same for an existing and an unknown email', async () => {
    const existing = await createUser('esistente', { password: true })
    const a = await addUserByEmail(emailOf('esistente'))
    const b = await addUserByEmail(`${PREFIX}_nuovo-${unique()}@${DOMAIN}`)
    expect(a).toEqual({ ok: true })
    expect(b).toEqual(a)
    expect(await membershipStatus(DEFAULT, existing)).toBe('active')
  })

  it('addUserByEmail gives the same answer for a person who belongs to another tenant', async () => {
    const onlyB = await bMember('altrove')
    const answer = await addUserByEmail(emailOf('altrove'))
    expect(answer).toEqual({ ok: true })
    // Per scelta dell'amministratore la persona entra nel tenant, e in B resta com'era.
    expect(await membershipStatus(DEFAULT, onlyB)).toBe('active')
    expect(await membershipStatus(B, onlyB)).toBe('active')
  })

  it('addUserByEmail creates the membership and the base role', async () => {
    const email = `${PREFIX}_creato@${DOMAIN}`
    await addUserByEmail(email)
    const [account] = await accountsWithEmail(email)
    expect(account).toBeDefined()
    expect(await membershipStatus(DEFAULT, account.id)).toBe('active')
    expect(await rolesInDefault(account.id)).toEqual([system.registered])
  })

  it('addUserByEmail finds the existing account whatever the case and spaces', async () => {
    const existing = await createUser('maiuscole', { password: true })
    await addUserByEmail(`  ${PREFIX.toUpperCase()}_Maiuscole@Esempio.IT `)
    // Nessun account nuovo: la ricerca ha trovato quello esistente.
    const accounts = await withGlobal(tx => tx.select({ id: users.id }).from(users).where(like(users.email, `${PREFIX}\\_maiuscole%`)))
    expect(accounts.map(a => a.id)).toEqual([existing])
    expect(await membershipStatus(DEFAULT, existing)).toBe('active')
    expect(await accountsWithEmail(`${PREFIX.toUpperCase()}_Maiuscole@Esempio.IT`)).toEqual([])
  })

  it('addUserByEmail leaves a deactivated member deactivated', async () => {
    const target = await defaultMember('resta_disattivato', 'deactivated')
    await withTenant(DEFAULT, tx => tx.delete(userRole).where(eq(userRole.userId, target)))
    await addUserByEmail(emailOf('resta_disattivato'))
    expect(await membershipStatus(DEFAULT, target)).toBe('deactivated')
    // Niente ruolo base aggiunto: l'appartenenza esisteva già.
    expect(await rolesInDefault(target)).toEqual([])
  })

  it('addUserByEmail sends an invitation only to an account without password', async () => {
    await createUser('con_password', { password: true })
    await addUserByEmail(emailOf('con_password'))
    expect(mailer.sendEmail).not.toHaveBeenCalled()

    await addUserByEmail(emailOf('senza_password'))
    expect(mailer.sendEmail).toHaveBeenCalledTimes(1)
    expect(mailer.sendEmail.mock.calls[0][0]).toMatchObject({ to: emailOf('senza_password') })
  })

  it('addUserByEmail does not surface a failed delivery (sendEmail rejects)', async () => {
    mailer.sendEmail.mockRejectedValue(new Error('smtp giù'))
    await expect(addUserByEmail(emailOf('mail_guasta'))).resolves.toEqual({ ok: true })
    const [account] = await accountsWithEmail(emailOf('mail_guasta'))
    expect(await membershipStatus(DEFAULT, account.id)).toBe('active')
  })

  it('addUserByEmail refuses an invalid email', async () => {
    await expect(addUserByEmail('non-una-email')).rejects.toThrow('Email non valida')
    await expect(addUserByEmail(`${'a'.repeat(250)}@${DOMAIN}`)).rejects.toThrow('Email non valida')
  })

  it('a person added by email can be given roles at once', async () => {
    const email = emailOf('con_ruoli')
    await addUserByEmail(email)
    const [account] = await accountsWithEmail(email)
    await updateUserRoles(account.id, [system.registered])
    expect(await rolesInDefault(account.id)).toEqual([system.registered])
  })
})

