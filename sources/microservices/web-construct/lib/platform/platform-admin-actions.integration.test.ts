import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { passwordSetTokens, users } from '@/lib/db/schema'
import { withGlobal } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import { closePlatform, withPlatform } from '@/lib/platform/db'
import { addPlatformAdmin, removePlatformAdmin } from './platform-admin-actions'

/**
 * Nominare e togliere gli amministratori di piattaforma dalla console (specifica 2026-10-26,
 * MT5-DEC-2, MT5-DEC-23), con le stesse regole del comando `db.mjs platform-admin-add/remove`:
 * niente da fare = niente voce nel registro, un account disattivato non si nomina, l'ultimo
 * amministratore attivo non si toglie (con le righe bloccate, due richieste insieme non lo
 * aggirano). Finti sono solo i confini di Next e l'invio dell'email; la guardia, la porta di
 * piattaforma e il registro sono veri.
 */
const mocks = vi.hoisted(() => ({
  session: null as unknown,
  headers: new Headers(),
  sendInvite: vi.fn(),
}))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }) }))
vi.mock('@/lib/invitation-email', () => ({
  sendInvitationEmail: async () => ({ ok: true }),
  sendMainAddressInvitationEmail: mocks.sendInvite,
}))
vi.mock('@/lib/platform/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/platform/db')>()
  return { ...actual, withPlatform: vi.fn(actual.withPlatform) }
})
// Il registro vero, ma con la possibilità di farlo fallire una volta: la voce e la modifica stanno o cadono insieme.
const failNextAudit = vi.hoisted(() => ({ on: false }))
vi.mock('@/lib/audit/platform-audit', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/audit/platform-audit')>()
  return {
    ...actual,
    recordPlatformAudit: vi.fn(async (...args: Parameters<typeof actual.recordPlatformAudit>) => {
      if (failNextAudit.on) { failNextAudit.on = false; throw new Error('audit write failed') }
      return actual.recordPlatformAudit(...args)
    }),
  }
})

const MAIN_HOST = 'construct.example.test'
const PASSWORD_HASH = '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234'
const createdUserIds: string[] = []
/** Gli amministratori che c'erano prima: la prova li toglie e li rimette (vedi platform-admin-command). */
let preexisting: string[] = []
let actor: { id: string; email: string }

const RESTORE_FILE = join(tmpdir(), 'construct-platform-admin-actions-test-restore.json')
function readRestoreFile(): string[] {
  try { return JSON.parse(readFileSync(RESTORE_FILE, 'utf8')) as string[] } catch { return [] }
}
const idList = (ids: string[]) => sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)
async function restoreAdmins(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await withOwner(tx => tx.execute(sql`update public.users set is_platform_admin = true where id in (${idList(ids)})`))
}
async function clearAdmins(): Promise<void> {
  await withOwner(tx => tx.execute(sql`update public.users set is_platform_admin = false where is_platform_admin`))
}

const address = (label: string) => `zzz_pa_${label}_${unique()}@example.test`

async function createAccount(email: string, options: { password?: boolean; status?: number; admin?: boolean } = {}): Promise<string> {
  const [row] = await withOwner(tx => tx.insert(users).values({
    email, authProvider: 'credentials', idUserStatus: options.status ?? 2,
    passwordHash: options.password === false ? null : PASSWORD_HASH, isPlatformAdmin: options.admin ?? false,
  }).returning({ id: users.id }))
  createdUserIds.push(row.id)
  return row.id
}

async function userByEmail(email: string) {
  const [row] = await withGlobal(tx => tx.select({
    id: users.id, isPlatformAdmin: users.isPlatformAdmin, passwordHash: users.passwordHash, status: users.idUserStatus,
  }).from(users).where(eq(users.email, email)))
  return row
}

async function auditOf(objectId: string) {
  return withOwner(tx => tx.execute<{
    id_tenant: string | null; actor_user_id: string | null; actor_email: string | null; actor_kind: string
    operation: string; object_type: string | null; object_id: string | null; details: Record<string, unknown>
  }>(sql`select id_tenant, actor_user_id, actor_email, actor_kind, operation, object_type, object_id, details
         from public.platform_audit_event where object_id = ${objectId} order by id`))
}

async function flagged(): Promise<string[]> {
  const rows = await withGlobal(tx => tx.select({ id: users.id }).from(users).where(eq(users.isPlatformAdmin, true)))
  return rows.map(row => row.id).sort()
}

function signInAs(person: { id: string; email: string }) {
  mocks.session = {
    user: { id: person.id, email: person.email, accountActive: true, tenantState: 'none', tenantId: null, isPlatformAdmin: true },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

beforeAll(async () => {
  await restoreAdmins(readRestoreFile())
  preexisting = await flagged()
  writeFileSync(RESTORE_FILE, JSON.stringify(preexisting))
  // Amministratori noti: gli altri si rimettono in afterAll.
  await clearAdmins()
}, 30_000)

afterAll(async () => {
  const errors: unknown[] = []
  try {
    await withOwner(async tx => {
      if (createdUserIds.length > 0) {
        await tx.execute(sql`delete from public.platform_audit_event where object_id in (${sql.join(createdUserIds.map(id => sql`${id}`), sql`, `)})`)
        await tx.execute(sql`update public.users set is_platform_admin = false where id in (${idList(createdUserIds)})`)
      }
    })
    await restoreAdmins(preexisting)
    rmSync(RESTORE_FILE, { force: true })
  } catch (error) { errors.push(error) }
  if (createdUserIds.length > 0) {
    try { await withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))) } catch (error) { errors.push(error) }
  }
  try { await closePlatform() } catch (error) { errors.push(error) }
  try { await closeOwner() } catch (error) { errors.push(error) }
  if (errors.length > 0) throw errors[0]
}, 30_000)

beforeEach(async () => {
  mocks.headers = new Headers({ host: MAIN_HOST })
  mocks.sendInvite.mockReset()
  mocks.sendInvite.mockResolvedValue({ ok: true })
  vi.mocked(withPlatform).mockClear()
  failNextAudit.on = false
  // Ogni prova parte con un solo amministratore attivo: chi agisce.
  await clearAdmins()
  actor = { id: await createAccount(address('actor'), { admin: true }), email: '' }
  actor.email = (await withGlobal(tx => tx.select({ e: users.email }).from(users).where(eq(users.id, actor.id))))[0].e!
  signInAs(actor)
})

describeIntegration('addPlatformAdmin', () => {
  it('creates a new account, flags it, writes the audit row and emails an invitation to the main address', async () => {
    const email = address('new')
    const result = await addPlatformAdmin(email)
    expect(result).toEqual({ ok: true, invited: true })

    const account = await userByEmail(email)
    createdUserIds.push(account.id)
    expect(account).toMatchObject({ isPlatformAdmin: true, passwordHash: null, status: 2 })

    // L'invito è un token d'invito vero, e l'email parte una volta sola, verso l'indirizzo della persona.
    const tokens = await withGlobal(tx => tx.select().from(passwordSetTokens).where(eq(passwordSetTokens.userId, account.id)))
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ purpose: 'invitation', usedAt: null, requestedBy: actor.id })
    expect(mocks.sendInvite).toHaveBeenCalledTimes(1)
    expect(mocks.sendInvite.mock.calls[0][0]).toMatchObject({ email, userId: account.id, rawToken: tokens[0].token })

    const audit = await auditOf(account.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      id_tenant: null, actor_user_id: actor.id, actor_email: actor.email, actor_kind: 'platform',
      operation: 'platform.admin.add', object_type: 'user', object_id: account.id,
    })
    expect(audit[0].details).toMatchObject({ email, accountCreated: true })
    // Né il token né il link entrano nel registro (MT5-RISK-4).
    expect(JSON.stringify(audit[0])).not.toContain(tokens[0].token)
  }, 30_000)

  it('flags an existing account that already has a password, with no invitation', async () => {
    const email = address('known')
    const id = await createAccount(email)
    expect(await addPlatformAdmin(`  ${email.toUpperCase()} `)).toEqual({ ok: true, invited: false })
    expect(await userByEmail(email)).toMatchObject({ id, isPlatformAdmin: true })
    expect(mocks.sendInvite).not.toHaveBeenCalled()
    expect(await withGlobal(tx => tx.select({ id: passwordSetTokens.id }).from(passwordSetTokens).where(eq(passwordSetTokens.userId, id)))).toEqual([])
    expect((await auditOf(id)).map(row => [row.operation, row.details])).toEqual([
      ['platform.admin.add', { email, accountCreated: false, invited: false }],
    ])
  }, 30_000)

  it('invites an existing account that never set a password', async () => {
    const email = address('nopass')
    const id = await createAccount(email, { password: false })
    expect(await addPlatformAdmin(email)).toEqual({ ok: true, invited: true })
    expect(mocks.sendInvite).toHaveBeenCalledTimes(1)
    expect(mocks.sendInvite.mock.calls[0][0]).toMatchObject({ userId: id, email })
    expect((await auditOf(id))[0].details).toMatchObject({ accountCreated: false, invited: true })
  }, 30_000)

  it('keeps the person an administrator when the email cannot be sent, and says no invitation went out', async () => {
    mocks.sendInvite.mockResolvedValue({ ok: false, code: 'email_delivery_failed' })
    const email = address('mailfail')
    // Un risultato a parte: la console deve dire che l'invito non è partito e come recuperare.
    expect(await addPlatformAdmin(email)).toEqual({ ok: true, invited: false, inviteFailed: true })
    const account = await userByEmail(email)
    createdUserIds.push(account.id)
    expect(account.isPlatformAdmin).toBe(true)
    // La voce c'è lo stesso: la modifica è avvenuta.
    expect(await auditOf(account.id)).toHaveLength(1)
  }, 30_000)

  it('says the same when the email sender throws', async () => {
    mocks.sendInvite.mockRejectedValue(new Error('smtp down'))
    const email = address('mailthrow')
    expect(await addPlatformAdmin(email)).toEqual({ ok: true, invited: false, inviteFailed: true })
    createdUserIds.push((await userByEmail(email)).id)
  }, 30_000)

  it('does nothing and writes nothing for an account that already is an administrator', async () => {
    const email = address('already')
    const id = await createAccount(email, { admin: true })
    expect(await addPlatformAdmin(email)).toEqual({ ok: true, invited: false })
    expect(await auditOf(id)).toEqual([])
    expect(mocks.sendInvite).not.toHaveBeenCalled()
  }, 30_000)

  it('refuses a globally deactivated account and changes nothing', async () => {
    const email = address('off')
    const id = await createAccount(email, { status: 1 })
    await expect(addPlatformAdmin(email)).rejects.toThrow()
    expect((await userByEmail(email)).isPlatformAdmin).toBe(false)
    expect(await auditOf(id)).toEqual([])
    expect(mocks.sendInvite).not.toHaveBeenCalled()
  }, 30_000)

  it('refuses something that is not an email before touching the database', async () => {
    await expect(addPlatformAdmin('non-una-email')).rejects.toThrow('Email non valida')
    await expect(addPlatformAdmin(undefined as unknown as string)).rejects.toThrow('Email non valida')
    expect(withPlatform).not.toHaveBeenCalled()
  })

  it('leaves neither the account nor the flag nor the token when the audit row cannot be written', async () => {
    const email = address('rollback')
    failNextAudit.on = true
    await expect(addPlatformAdmin(email)).rejects.toThrow('audit write failed')
    expect(await userByEmail(email)).toBeUndefined()
    expect(mocks.sendInvite).not.toHaveBeenCalled()
  }, 30_000)

  it.each([
    ['a person who is not a platform admin', () => { mocks.session = { user: { id: crypto.randomUUID(), accountActive: true, tenantState: 'ready', isPlatformAdmin: true }, expires: '2099-01-01T00:00:00.000Z' } }],
    ['nobody signed in', () => { mocks.session = null }],
  ])('refuses %s, opens no platform transaction and writes nothing', async (_label, arrange) => {
    arrange()
    const email = address('refused')
    await expect(addPlatformAdmin(email)).rejects.toThrow('Unauthorized')
    expect(withPlatform).not.toHaveBeenCalled()
    expect(await userByEmail(email)).toBeUndefined()
  }, 30_000)

  it('refuses an administrator who writes from a dedicated address', async () => {
    const [created] = await withOwner(tx => tx.execute<{ id: string }>(
      sql`select app_private.create_tenant_from_template(${`zzz-pa-${unique()}`.slice(0, 40)}, 'ZZZ dedicato')::text as id`))
    const tenantId = tenantIdForTest(Number(created.id))
    const host = `zzz-pa-${unique()}.example.test`
    try {
      await withOwner(tx => tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${host}, ${tenantId}, true)`))
      mocks.headers = new Headers({ host })
      const email = address('dedicated')
      await expect(addPlatformAdmin(email)).rejects.toThrow('Unauthorized')
      expect(withPlatform).not.toHaveBeenCalled()
      expect(await userByEmail(email)).toBeUndefined()
    } finally {
      await deleteTenantForTest(tenantId)
    }
  }, 30_000)
})

describeIntegration('removePlatformAdmin', () => {
  it('removes an administrator while another active one remains, and records it', async () => {
    const email = address('leaving')
    const id = await createAccount(email, { admin: true })
    expect(await removePlatformAdmin(id)).toEqual({ ok: true })
    expect((await userByEmail(email)).isPlatformAdmin).toBe(false)
    const audit = await auditOf(id)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      id_tenant: null, actor_user_id: actor.id, actor_email: actor.email, actor_kind: 'platform',
      operation: 'platform.admin.remove', object_type: 'user', object_id: id,
    })
    expect(audit[0].details).toEqual({ email })
    expect(await flagged()).toEqual([actor.id])
  }, 30_000)

  it('lets an administrator remove themself while another active one remains', async () => {
    const otherId = await createAccount(address('other'), { admin: true })
    expect(await removePlatformAdmin(actor.id)).toEqual({ ok: true })
    expect(await flagged()).toEqual([otherId])
  }, 30_000)

  it('refuses to remove the last active administrator, even if deactivated ones are still flagged', async () => {
    const offId = await createAccount(address('flaggedoff'), { admin: true, status: 1 })
    await expect(removePlatformAdmin(actor.id)).rejects.toThrow()
    expect(await flagged()).toEqual([actor.id, offId].sort())
    expect(await auditOf(actor.id)).toEqual([])
  }, 30_000)

  it('does nothing and writes nothing for an account that is not an administrator, or does not exist', async () => {
    const plainId = await createAccount(address('plain'))
    expect(await removePlatformAdmin(plainId)).toEqual({ ok: true })
    expect(await removePlatformAdmin(crypto.randomUUID())).toEqual({ ok: true })
    expect(await auditOf(plainId)).toEqual([])
    expect(await flagged()).toEqual([actor.id])
  }, 30_000)

  it('refuses something that is not a user id before touching the database', async () => {
    await expect(removePlatformAdmin('not-a-uuid')).rejects.toThrow()
    expect(withPlatform).not.toHaveBeenCalled()
  })

  it('two requests at once cannot leave the platform without an administrator', async () => {
    const secondId = await createAccount(address('second'), { admin: true })
    // Due amministratori attivi, e ognuno toglie l'altro nello stesso momento.
    const [a, b] = await Promise.allSettled([removePlatformAdmin(secondId), removePlatformAdmin(actor.id)])
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected'])
    expect(await flagged()).toHaveLength(1)
    const removed = (await auditOf(secondId)).concat(await auditOf(actor.id)).filter(row => row.operation === 'platform.admin.remove')
    expect(removed).toHaveLength(1)
  }, 60_000)

  it('leaves the flag when the audit row cannot be written', async () => {
    const id = await createAccount(address('rollbackremove'), { admin: true })
    failNextAudit.on = true
    await expect(removePlatformAdmin(id)).rejects.toThrow('audit write failed')
    expect(await flagged()).toEqual([actor.id, id].sort())
  }, 30_000)

  it.each([
    ['a person who is not a platform admin', () => { mocks.session = { user: { id: crypto.randomUUID(), accountActive: true, tenantState: 'ready', isPlatformAdmin: true }, expires: '2099-01-01T00:00:00.000Z' } }],
    ['nobody signed in', () => { mocks.session = null }],
  ])('refuses %s, opens no platform transaction and removes nobody', async (_label, arrange) => {
    const id = await createAccount(address('safe'), { admin: true })
    arrange()
    await expect(removePlatformAdmin(id)).rejects.toThrow('Unauthorized')
    expect(withPlatform).not.toHaveBeenCalled()
    expect((await flagged()).includes(id)).toBe(true)
  }, 30_000)
})
