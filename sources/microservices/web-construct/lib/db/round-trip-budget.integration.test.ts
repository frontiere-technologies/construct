import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { answersBetween, countRoundTrips, type RecordedStatement, type TripEvent } from '@/lib/db/round-trips'
import { permission, role, rolePermission, tenantMembership, userRole, users } from '@/lib/db/schema'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant } from '@/lib/tenancy/testing'

/**
 * I tetti dei viaggi verso il database (specifica 2026-10-15, §3 e MTP-DEC-5). Il client dell'app
 * è sostituito da uno che registra ogni istruzione inviata: le funzioni misurate sono quelle vere,
 * con le loro withTenant/withGlobal. I tetti sono totali (piano, "Deviazione dalla specifica").
 */
const recorded = vi.hoisted(() => [] as { query: string; parameterCount: number }[])
/** Le stesse istruzioni, in ordine con le risposte del server: dice se due letture sono in coda insieme. */
const events = vi.hoisted(() => [] as TripEvent[])

vi.mock('@/lib/db/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db/client')>()
  const { database, close } = actual.createDatabase(process.env.TEST_DATABASE_URL ?? '', {
    max: 1,
    onQuery: (query, parameters) => {
      recorded.push({ query, parameterCount: parameters.length })
      events.push({ type: 'sent', query })
    },
    onAnswer: () => events.push({ type: 'answer' }),
  })
  return { ...actual, db: database, __closeCountingClient: close }
})

// Utenti e ruoli di prova condivisi dai tetti (anche dei compiti successivi): creati in beforeAll,
// fuori da ogni misura, e cancellati in afterAll (solo queste righe, per id).
let adminUserId: string
let readerUserId: string
/** L'id del ruolo TENANT_ADMIN del tenant predefinito, letto e mai scritto. */
let adminRoleId: number
let readerRoleId: number

async function measure(operation: () => Promise<unknown>) {
  recorded.length = 0
  events.length = 0
  await operation()
  const count = countRoundTrips(recorded as RecordedStatement[])
  // Un client che non registra darebbe 0 viaggi e ogni tetto passerebbe a vuoto.
  expect(count.statements, 'the counting client recorded nothing: onQuery is not wired').toBeGreaterThan(0)
  return count
}

/** Le due letture di allInTransaction partono in coda: la seconda prima di ogni risposta alla prima. */
function expectQueuedTogether(first: RegExp, second: RegExp) {
  // Senza risposte registrate answersBetween darebbe sempre 0 e il controllo passerebbe a vuoto.
  expect(events.some(event => event.type === 'answer'), 'the counting client saw no answer: onAnswer is not wired').toBe(true)
  expect(answersBetween(events, first, second), 'the two reads were sent one after the other, not queued together').toBe(0)
}

describeIntegration('round-trip budget', () => {
  // La prima istruzione su una connessione nuova è la lettura dei tipi array di postgres.js (una
  // volta per connessione): fuori dal conto, altrimenti ogni misura ne porterebbe una in più.
  // Il client misurato ha una sola connessione (max: 1): quella scaldata è l'unica che si usa.
  beforeAll(async () => {
    const { withGlobal } = await import('@/lib/db/tenant-db')
    await withGlobal(async () => null)

    const { withTenant } = await import('@/lib/db/tenant-db')
    const { getSystemRoleIds } = await import('@/lib/tenancy/system-roles')
    const system = await withTenant(defaultTestTenant(), tx => getSystemRoleIds(tx))
    adminRoleId = system.tenantAdmin
    const created = await withGlobal(tx => tx.insert(users).values([
      { email: `zzz_budget_admin_${unique()}@example.test`, idUserStatus: 2 },
      { email: `zzz_budget_reader_${unique()}@example.test`, idUserStatus: 2 },
    ]).returning({ id: users.id, email: users.email }))
    adminUserId = created.find(row => row.email?.startsWith('zzz_budget_admin_'))!.id
    readerUserId = created.find(row => row.email?.startsWith('zzz_budget_reader_'))!.id
    await withTenant(defaultTestTenant(), async tx => {
      const [service] = await tx.insert(role)
        .values({ description: `zzz_budget_${unique()}`, idRoleType: 2 })
        .returning({ idRole: role.idRole })
      readerRoleId = service.idRole
      const [perm] = await tx.select({ idPermission: permission.idPermission }).from(permission).where(eq(permission.code, 'read-menu'))
      await tx.insert(rolePermission).values({ idRole: readerRoleId, idPermission: perm.idPermission })
      // I ruoli esistono solo con l'appartenenza al tenant (0048).
      await tx.insert(tenantMembership).values([{ userId: adminUserId }, { userId: readerUserId }])
      await tx.insert(userRole).values([
        { userId: adminUserId, idRole: system.registered },
        { userId: adminUserId, idRole: adminRoleId },
        { userId: readerUserId, idRole: readerRoleId },
      ])
    })
  }, 30_000)
  beforeEach(() => { recorded.length = 0; events.length = 0 })
  afterAll(async () => {
    // Ogni passo di pulizia è indipendente: uno che fallisce non lascia indietro gli altri.
    const { withTenant, withGlobal } = await import('@/lib/db/tenant-db')
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    // user_role e role_permission spariscono con il ruolo e con gli utenti (ON DELETE CASCADE).
    if (readerRoleId !== undefined) await step(() => withTenant(defaultTestTenant(), tx => tx.delete(role).where(eq(role.idRole, readerRoleId))))
    const userIds = [adminUserId, readerUserId].filter(Boolean)
    if (userIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, userIds))))
    const client = await import('@/lib/db/client') as unknown as { __closeCountingClient: () => Promise<void> }
    await step(() => client.__closeCountingClient())
    if (errors.length > 0) throw errors[0]
  })

  it('an empty withTenant costs at most 3 trips (BEGIN, set_config, COMMIT)', async () => {
    const { withTenant } = await import('@/lib/db/tenant-db')
    const count = await measure(() => withTenant(defaultTestTenant(), async () => null))
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(3)
  })

  it('one authorization read (the jwt callback) costs at most 5 trips', async () => {
    const { resolveUserAuthorization } = await import('@/lib/rbac/auth-roles')
    const count = await measure(() => resolveUserAuthorization(defaultTestTenant(), adminUserId))
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(5)
  })

  it.each(['admin', 'reader'] as const)('resolveActor for a %s costs at most 5 trips', async kind => {
    const { resolveActor } = await import('@/lib/rbac/actor')
    const count = await measure(() => resolveActor(defaultTestTenant(), kind === 'admin' ? adminUserId : readerUserId))
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(5)
  })

  it('the sidebar menu costs at most 6 trips', async () => {
    const { getSidebarMenu } = await import('@/lib/rbac/navigation-service')
    const count = await measure(() => getSidebarMenu(defaultTestTenant(), [adminRoleId], 'it', 'it'))
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(6)
    // Il tetto totale non vede se le due letture di allInTransaction sono in coda o in serie: qui sì.
    expectQueuedTogether(/from "menu_entry"/, /from "role_functionality"/)
  })

  it('the functionalities tree costs at most 5 trips', async () => {
    const { getNavigationSubtree } = await import('@/lib/rbac/functionalities-service')
    const count = await measure(() => getNavigationSubtree(defaultTestTenant()))
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(5)
    expectQueuedTogether(/from "menu_entry"/, /from "menu_entry_tag"/)
  })

  it('the user management page data costs at most 11 trips for an administrator', async () => {
    const { resolveActor } = await import('@/lib/rbac/actor')
    const { loadUserManagementPage } = await import('@/lib/rbac/user-management-loader')
    const actor = await resolveActor(defaultTestTenant(), adminUserId)
    let page: Awaited<ReturnType<typeof loadUserManagementPage>> | undefined
    const count = await measure(async () => { page = await loadUserManagementPage(actor!) })
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(11)
    // Stessi dati di prima, non solo meno viaggi: l'amministratore può assegnare il ruolo di prova.
    expect(page!.allRoles.map(r => r.id)).toEqual(expect.arrayContaining([adminRoleId, readerRoleId]))
    expect(page!.assignable).toContain(readerRoleId)
    // Il ruolo base è uno dei ruoli del tenant (l'id 0 è valido: è il ruolo base del tenant predefinito).
    expect(page!.allRoles.map(r => r.id)).toContain(page!.registeredRoleId)
  })
})
