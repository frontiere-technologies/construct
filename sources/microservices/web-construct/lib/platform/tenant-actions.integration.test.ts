import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { passwordSetTokens, tenant, tenantHost, tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { closePlatform, withPlatform } from '@/lib/platform/db'
import {
  addTenantAdmin, addTenantHost, createTenant, removeTenantHost, resendTenantInvite, setPrimaryHost, setTenantStatus,
} from './tenant-actions'
import { getTenantForPlatform, listTenantsForPlatform } from './tenant-service'

/**
 * Le azioni della console sul ciclo di vita di un tenant (specifica 2026-10-26, MT5-DEC-5, 6, 7, 8,
 * 9, 20, 25) contro il database vero: creare un tenant con la sua email d'invito, cambiare lo stato,
 * gestire indirizzi e amministratori. Finti sono solo i confini di Next (sessione, intestazioni) e
 * l'invio vero dell'email (`sendEmail`): l'invito, la guardia, la porta di piattaforma e i due
 * registri sono veri, così come il link che finisce nell'email.
 */
const mocks = vi.hoisted(() => ({
  session: null as unknown,
  headers: new Headers(),
  sendEmail: vi.fn(),
}))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => mocks.session }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }) }))
vi.mock('@/lib/mailer', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/platform/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/platform/db')>()
  return { ...actual, withPlatform: vi.fn(actual.withPlatform) }
})
// Il registro vero, ma con la possibilità di farlo fallire una volta: la modifica e la voce stanno o cadono insieme.
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
const createdTenants: TenantId[] = []
const createdUserIds: string[] = []
let previousAuthUrl: string | undefined

type Person = { id: string; email: string }
let platformAdmin: Person

const slugOf = (label: string) => `zzz-tl-${label}-${unique()}`.slice(0, 40)
const hostOf = (label: string) => `zzz-tl-${label}-${unique()}.example.test`
const emailOf = (label: string) => `zzz_tl_${label}_${unique()}@example.test`

async function createAccount(email: string, options: { password?: boolean; status?: number; platformAdmin?: boolean } = {}): Promise<Person> {
  const [row] = await withOwner(tx => tx.insert(users).values({
    email, authProvider: 'credentials', idUserStatus: options.status ?? 2,
    passwordHash: options.password === false ? null : PASSWORD_HASH, isPlatformAdmin: options.platformAdmin ?? false,
  }).returning({ id: users.id }))
  createdUserIds.push(row.id)
  return { id: row.id, email }
}

function signInAs(person: Person) {
  mocks.session = {
    user: { id: person.id, email: person.email, accountActive: true, tenantState: 'none', tenantId: null, isPlatformAdmin: true },
    expires: '2099-01-01T00:00:00.000Z',
  }
}

/** Un tenant fatto dal fixture (non dall'azione), per le prove sugli altri comandi. */
async function seedTenant(label: string, options: { status?: 'active' | 'suspended' | 'archived' } = {}): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${slugOf(label)}, ${`ZZZ ${label}`})::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  if (options.status && options.status !== 'active') {
    await withOwner(tx => tx.execute(sql`update public.tenant set status = ${options.status} where id = ${id}`))
  }
  return id
}

/** Un'amministratrice del tenant messa dal fixture, con o senza password. */
async function seedAdmin(tenantId: TenantId, label: string, options: { password?: boolean } = {}): Promise<Person> {
  const person = await createAccount(emailOf(label), { password: options.password })
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId: person.id, status: 'active' })
    await tx.insert(userRole).values([
      { userId: person.id, idRole: system.registered }, { userId: person.id, idRole: system.tenantAdmin },
    ])
  })
  return person
}

async function seedMember(tenantId: TenantId, label: string): Promise<Person> {
  const person = await createAccount(emailOf(label))
  await withTenant(tenantId, async tx => {
    const system = await getSystemRoleIds(tx)
    await tx.insert(tenantMembership).values({ userId: person.id, status: 'active' })
    await tx.insert(userRole).values({ userId: person.id, idRole: system.registered })
  })
  return person
}

type AuditRow = { operation: string; object_type: string | null; object_id: string | null; actor_kind: string; actor_user_id: string | null; actor_email: string | null; details: Record<string, unknown> }

async function platformAuditOf(tenantId: number): Promise<AuditRow[]> {
  return withOwner(tx => tx.execute<AuditRow>(sql`
    select operation, object_type, object_id, actor_kind, actor_user_id, actor_email, details
    from public.platform_audit_event where id_tenant = ${tenantId} order by id`))
}

async function tenantAuditOf(tenantId: number): Promise<AuditRow[]> {
  return withOwner(tx => tx.execute<AuditRow>(sql`
    select operation, object_type, object_id, actor_kind, actor_user_id, actor_email, details
    from public.tenant_audit_event order by id`), tenantIdForTest(tenantId))
}

const onlyOperations = (rows: AuditRow[], operations: string[]) => rows.filter(row => operations.includes(row.operation))

async function tenantRow(id: number) {
  const [row] = await withGlobal(tx => tx.select().from(tenant).where(eq(tenant.id, id)))
  return row
}

async function hostsOf(id: number) {
  return withGlobal(tx => tx.select({ host: tenantHost.host, isPrimary: tenantHost.isPrimary }).from(tenantHost)
    .where(eq(tenantHost.idTenant, id)).orderBy(tenantHost.host))
}

async function tokensOf(userId: string) {
  return withGlobal(tx => tx.select().from(passwordSetTokens).where(eq(passwordSetTokens.userId, userId)).orderBy(passwordSetTokens.createdAt))
}

async function userByEmail(email: string) {
  const [row] = await withGlobal(tx => tx.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.email, email)))
  return row
}

async function rolesOf(tenantId: TenantId, userId: string): Promise<string[]> {
  return withTenant(tenantId, async tx => {
    const rows = await tx.execute<{ system_key: string | null }>(sql`
      select r.system_key from public.user_role ur
      join public.role r on r.id_tenant = ur.id_tenant and r.id_role = ur.id_role
      where ur.user_id = ${userId}::uuid order by r.system_key`)
    return rows.map(row => row.system_key ?? '')
  })
}

const emailsSent = () => mocks.sendEmail.mock.calls.map(call => call[0] as { to: string; subject: string; html: string; text: string })

beforeAll(async () => {
  previousAuthUrl = process.env.AUTH_URL
  process.env.AUTH_URL = `https://${MAIN_HOST}`
  platformAdmin = await createAccount(emailOf('padmin'), { platformAdmin: true })
}, 30_000)

afterAll(async () => {
  const errors: unknown[] = []
  const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
  if (previousAuthUrl === undefined) delete process.env.AUTH_URL; else process.env.AUTH_URL = previousAuthUrl
  for (const id of createdTenants) await step(() => deleteTenantForTest(id))
  await step(() => withOwner(tx => tx.execute(sql`delete from public.platform_audit_event where actor_user_id = ${platformAdmin.id}::uuid`)))
  await step(() => withOwner(tx => tx.execute(sql`update public.users set is_platform_admin = false where id = ${platformAdmin.id}::uuid`)))
  if (createdUserIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
  await step(() => closePlatform())
  await step(() => closeOwner())
  if (errors.length > 0) throw errors[0]
}, 60_000)

beforeEach(() => {
  mocks.headers = new Headers({ host: MAIN_HOST })
  mocks.sendEmail.mockReset().mockResolvedValue(undefined)
  vi.mocked(withPlatform).mockClear()
  failNextAudit.on = false
  signInAs(platformAdmin)
})

/** Crea un tenant con l'azione e lo registra per la pulizia. */
async function create(label: string, options: { host?: string; adminEmail?: string } = {}) {
  const slug = slugOf(label)
  const adminEmail = options.adminEmail ?? emailOf(`${label}admin`)
  const result = await createTenant({ name: `ZZZ ${label}`, slug, host: options.host, adminEmail })
  if (result.ok) createdTenants.push(tenantIdForTest(result.tenantId))
  const account = await userByEmail(adminEmail)
  if (account) createdUserIds.push(account.id)
  return { result, slug, adminEmail, account }
}

describeIntegration('createTenant', () => {
  it('copies the template, sets the primary host, makes the admin, and emails a link to the tenant host', async () => {
    const host = hostOf('create')
    const { result, slug, adminEmail, account } = await create('create', { host })
    expect(result).toEqual({ ok: true, tenantId: expect.any(Number), invited: true })
    if (!result.ok) throw new Error('unreachable')
    const id = tenantIdForTest(result.tenantId)

    expect(await tenantRow(id)).toMatchObject({ slug, name: 'ZZZ create', status: 'active', isTemplate: false })
    expect(await hostsOf(id)).toEqual([{ host, isPrimary: true }])
    // Copiato dal modello: il tenant ha i suoi ruoli e le sue voci di menu, come con tenant-create.
    const [template] = await withGlobal(tx => tx.execute<{ id: string }>(sql`select id::text as id from public.tenant where is_template`))
    const count = (tenantId: TenantId) => withTenant(tenantId, async tx => (await tx.execute<{ roles: number; menu: number }>(sql`
      select (select count(*) from public.role)::int as roles, (select count(*) from public.menu_entry)::int as menu`))[0])
    expect(await count(id)).toEqual(await count(tenantIdForTest(Number(template.id))))

    // Il primo amministratore: membro attivo con i ruoli REGISTERED e TENANT_ADMIN.
    expect(account).toBeDefined()
    expect(await rolesOf(id, account.id)).toEqual(['REGISTERED', 'TENANT_ADMIN'])
    const [membership] = await withTenant(id, tx => tx.select().from(tenantMembership).where(eq(tenantMembership.userId, account.id)))
    expect(membership.status).toBe('active')

    // L'email d'invito parte una volta, verso la persona, con il link all'indirizzo del tenant.
    const emails = emailsSent()
    expect(emails).toHaveLength(1)
    expect(emails[0].to).toBe(adminEmail)
    const tokens = await tokensOf(account.id)
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ purpose: 'invitation', usedAt: null, requestedBy: platformAdmin.id, deliveryStatus: 'sent' })
    expect(emails[0].html).toContain(`https://${host}/set-password?token=${tokens[0].token}`)
    expect(emails[0].html).not.toContain(MAIN_HOST)
  }, 60_000)

  it('without a dedicated address the link points to the main address', async () => {
    const { result, account } = await create('nohost')
    expect(result.ok && result.invited).toBe(true)
    const [token] = await tokensOf(account.id)
    expect(emailsSent()[0].html).toContain(`https://${MAIN_HOST}/set-password?token=${token.token}`)
    if (result.ok) expect(await hostsOf(result.tenantId)).toEqual([])
  }, 60_000)

  it('createTenant for an account with a password sends no email and returns invited: false', async () => {
    const known = await createAccount(emailOf('known'))
    const { result } = await create('known', { adminEmail: known.email })
    expect(result).toEqual({ ok: true, tenantId: expect.any(Number), invited: false })
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(await tokensOf(known.id)).toEqual([])
    if (!result.ok) throw new Error('unreachable')
    expect(await rolesOf(tenantIdForTest(result.tenantId), known.id)).toEqual(['REGISTERED', 'TENANT_ADMIN'])
  }, 60_000)

  it('keeps the tenant and says the invitation was not sent when the email cannot be sent', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('smtp down'))
    const { result, account } = await create('mailfail')
    expect(result).toEqual({ ok: true, tenantId: expect.any(Number), invited: false, inviteFailed: true })
    // Lo stato di consegna dice la verità: l'email non è partita.
    const [token] = await tokensOf(account.id)
    expect(token.deliveryStatus).toBe('failed')
    expect(token.deliveredAt).toBeNull()
    if (result.ok) expect((await tenantRow(result.tenantId)).status).toBe('active')
  }, 60_000)

  it('createTenant with a taken host or slug creates nothing', async () => {
    const takenHost = hostOf('taken')
    const first = await create('taken', { host: takenHost })
    expect(first.result.ok).toBe(true)
    const before = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant))

    // Un indirizzo già preso, e il tenant nuovo non nasce.
    const slugB = slugOf('takenb')
    const adminB = emailOf('takenb')
    expect(await createTenant({ name: 'ZZZ B', slug: slugB, host: takenHost, adminEmail: adminB })).toEqual({ ok: false, reason: 'taken' })
    expect(await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, slugB)))).toEqual([])
    expect(await userByEmail(adminB)).toBeUndefined()

    // Uno slug già preso.
    const adminC = emailOf('takenc')
    expect(await createTenant({ name: 'ZZZ C', slug: first.slug, adminEmail: adminC })).toEqual({ ok: false, reason: 'taken' })
    expect(await userByEmail(adminC)).toBeUndefined()
    expect(await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant))).toEqual(before)
    // Nessuna email, nessuna voce nel registro per i rifiuti.
    expect(emailsSent()).toHaveLength(1)
    expect(await withOwner(tx => tx.execute(sql`select 1 from public.platform_audit_event where details ->> 'slug' = ${slugB}`))).toHaveLength(0)
  }, 60_000)

  it('refuses the main address as a dedicated address, and the slug of the default tenant', async () => {
    expect(await createTenant({ name: 'ZZZ M', slug: slugOf('mainhost'), host: MAIN_HOST.toUpperCase(), adminEmail: emailOf('mainhost') }))
      .toEqual({ ok: false, reason: 'taken' })
    expect(await createTenant({ name: 'ZZZ D', slug: 'default', adminEmail: emailOf('defslug') })).toEqual({ ok: false, reason: 'taken' })
  }, 60_000)

  it('normalizes the address like the rest of the app', async () => {
    const base = `zzz-tl-norm-${unique()}.example.test`
    const { result } = await create('norm', { host: ` ${base.toUpperCase()}:3000 ` })
    expect(result.ok).toBe(true)
    if (result.ok) expect(await hostsOf(result.tenantId)).toEqual([{ host: base, isPrimary: true }])
  }, 60_000)

  it('refuses a tenant whose first administrator is a globally deactivated account, and creates nothing', async () => {
    const off = await createAccount(emailOf('off'), { status: 1 })
    const slug = slugOf('off')
    await expect(createTenant({ name: 'ZZZ off', slug, adminEmail: off.email })).rejects.toThrow()
    expect(await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, slug)))).toEqual([])
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  }, 60_000)

  it.each([
    ['an empty name', { name: '  ', slug: 'zzz-tl-ok-slug', adminEmail: 'a@example.test' }],
    ['a slug with capitals', { name: 'N', slug: 'Zzz-Bad', adminEmail: 'a@example.test' }],
    ['a slug that is too short', { name: 'N', slug: 'ab', adminEmail: 'a@example.test' }],
    ['an email that is not one', { name: 'N', slug: 'zzz-tl-ok-slug', adminEmail: 'non-una-email' }],
  ])('refuses %s before touching the database', async (_label, input) => {
    await expect(createTenant(input)).rejects.toThrow()
    expect(withPlatform).not.toHaveBeenCalled()
  })

  it('says an address that is not a host name is not valid, before touching the database', async () => {
    expect(await createTenant({ name: 'N', slug: 'zzz-tl-ok-slug', host: 'not a host', adminEmail: 'a@example.test' }))
      .toEqual({ ok: false, reason: 'invalid_host' })
    expect(withPlatform).not.toHaveBeenCalled()
  })

  it('leaves no tenant, no account, no token and no email when the audit row cannot be written', async () => {
    const adminEmail = emailOf('rollback')
    const slug = slugOf('rollback')
    failNextAudit.on = true
    await expect(createTenant({ name: 'ZZZ r', slug, adminEmail })).rejects.toThrow('audit write failed')
    expect(await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, slug)))).toEqual([])
    expect(await userByEmail(adminEmail)).toBeUndefined()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  }, 60_000)

  it('the platform audit row of createTenant contains no link or token, and the tenant gets its own row', async () => {
    const host = hostOf('audit')
    const { result, slug, adminEmail, account } = await create('audit', { host })
    if (!result.ok) throw new Error('unreachable')
    const [token] = await tokensOf(account.id)

    const platform = await platformAuditOf(result.tenantId)
    expect(platform).toHaveLength(1)
    expect(platform[0]).toMatchObject({
      operation: 'tenant.create', object_type: 'tenant', object_id: String(result.tenantId),
      actor_kind: 'platform', actor_user_id: platformAdmin.id, actor_email: platformAdmin.email,
    })
    expect(platform[0].details).toMatchObject({ slug, name: 'ZZZ audit', host, firstAdmin: adminEmail })
    const tenantSide = await tenantAuditOf(result.tenantId)
    expect(tenantSide.map(row => row.operation)).toEqual(['tenant.create'])
    expect(tenantSide[0]).toMatchObject({ actor_kind: 'platform', actor_user_id: platformAdmin.id })
    for (const row of [...platform, ...tenantSide]) {
      const text = JSON.stringify(row)
      expect(text).not.toContain(token.token)
      expect(text).not.toMatch(/set-password|https?:\/\//)
    }
  }, 60_000)

  it('refuses a person who is not a platform admin, and nobody signed in, opening no platform transaction', async () => {
    const plain = await createAccount(emailOf('plain'))
    mocks.session = { user: { id: plain.id, accountActive: true, tenantState: 'ready', isPlatformAdmin: true }, expires: '2099-01-01T00:00:00.000Z' }
    const slug = slugOf('refused')
    await expect(createTenant({ name: 'ZZZ x', slug, adminEmail: emailOf('refused') })).rejects.toThrow('Unauthorized')
    mocks.session = null
    await expect(createTenant({ name: 'ZZZ x', slug, adminEmail: emailOf('refused') })).rejects.toThrow('Unauthorized')
    expect(withPlatform).not.toHaveBeenCalled()
    expect(await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, slug)))).toEqual([])
  }, 30_000)
})

describeIntegration('setTenantStatus', () => {
  it('suspends and reactivates, with one platform row and one tenant row each time', async () => {
    const id = await seedTenant('status')
    expect(await setTenantStatus(id, 'suspended')).toEqual({ ok: true })
    expect((await tenantRow(id)).status).toBe('suspended')
    expect(await setTenantStatus(id, 'active')).toEqual({ ok: true })
    expect((await tenantRow(id)).status).toBe('active')

    for (const rows of [await platformAuditOf(id), await tenantAuditOf(id)]) {
      expect(rows.map(row => [row.operation, row.object_type, row.object_id, row.actor_kind, row.details])).toEqual([
        ['tenant.status', 'tenant', String(id), 'platform', { from: 'active', to: 'suspended' }],
        ['tenant.status', 'tenant', String(id), 'platform', { from: 'suspended', to: 'active' }],
      ])
    }
  }, 60_000)

  it('does nothing and writes nothing when the tenant already has that status', async () => {
    const id = await seedTenant('same')
    expect(await setTenantStatus(id, 'active')).toEqual({ ok: true })
    expect(await platformAuditOf(id)).toEqual([])
    expect(await tenantAuditOf(id)).toEqual([])
  }, 60_000)

  it('archive requires a reason and hides the tenant from the default list', async () => {
    const id = await seedTenant('archive')
    await expect(setTenantStatus(id, 'archived')).rejects.toThrow()
    await expect(setTenantStatus(id, 'archived', '   ')).rejects.toThrow()
    expect((await tenantRow(id)).status).toBe('active')
    expect(await platformAuditOf(id)).toEqual([])

    expect(await setTenantStatus(id, 'archived', '  Contratto concluso  ')).toEqual({ ok: true })
    expect((await tenantRow(id)).status).toBe('archived')
    // La ragione scritta finisce in entrambi i registri.
    for (const rows of [await platformAuditOf(id), await tenantAuditOf(id)]) {
      expect(rows).toHaveLength(1)
      expect(rows[0].details).toEqual({ from: 'active', to: 'archived', reason: 'Contratto concluso' })
    }

    const query = { page: 0, size: 200 } as const
    const names = (await listTenantsForPlatform({ ...query })).rows.map(row => row.id)
    expect(names).not.toContain(id)
    expect((await listTenantsForPlatform({ ...query, status: 'archived' })).rows.map(row => row.id)).toContain(id)
  }, 60_000)

  it('restoring an archived tenant needs the explicit confirmation, and a suspended one does not', async () => {
    const id = await seedTenant('restore')
    await setTenantStatus(id, 'archived', 'chiuso')
    await expect(setTenantStatus(id, 'active')).rejects.toThrow()
    await expect(setTenantStatus(id, 'active', undefined, false)).rejects.toThrow()
    expect((await tenantRow(id)).status).toBe('archived')
    // Dall'archivio non si passa direttamente a sospeso: prima si ripristina.
    await expect(setTenantStatus(id, 'suspended', undefined, true)).rejects.toThrow()

    expect(await setTenantStatus(id, 'active', undefined, true)).toEqual({ ok: true })
    expect((await tenantRow(id)).status).toBe('active')
    expect((await platformAuditOf(id)).map(row => row.details)).toEqual([
      { from: 'active', to: 'archived', reason: 'chiuso' },
      { from: 'archived', to: 'active' },
    ])
  }, 60_000)

  it('keeps a reason on suspension when one is given', async () => {
    const id = await seedTenant('why')
    await setTenantStatus(id, 'suspended', 'pagamento in ritardo')
    expect((await platformAuditOf(id))[0].details).toEqual({ from: 'active', to: 'suspended', reason: 'pagamento in ritardo' })
  }, 60_000)

  it('refuses the template and the default tenant, and an id that does not exist', async () => {
    const [template] = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.isTemplate, true)))
    await expect(setTenantStatus(template.id, 'suspended')).rejects.toThrow()
    await expect(setTenantStatus(1, 'suspended')).rejects.toThrow()
    await expect(setTenantStatus(999_999_999, 'suspended')).rejects.toThrow()
    expect((await tenantRow(1)).status).toBe('active')
    expect((await tenantRow(template.id)).status).toBe('active')
  }, 60_000)

  it.each([
    ['an id that is not a number', ['1', 'suspended']],
    ['a status that does not exist', [1, 'deleted']],
    ['a negative id', [-4, 'suspended']],
  ])('refuses %s before touching the database', async (_label, args) => {
    await expect((setTenantStatus as (...a: unknown[]) => Promise<unknown>)(...args)).rejects.toThrow()
    expect(withPlatform).not.toHaveBeenCalled()
  })

  it('leaves the status when the audit row cannot be written', async () => {
    const id = await seedTenant('auditfail')
    failNextAudit.on = true
    await expect(setTenantStatus(id, 'suspended')).rejects.toThrow('audit write failed')
    expect((await tenantRow(id)).status).toBe('active')
    expect(await tenantAuditOf(id)).toEqual([])
  }, 60_000)

  it('refuses someone who is not a platform admin', async () => {
    const id = await seedTenant('guard')
    mocks.session = null
    await expect(setTenantStatus(id, 'suspended')).rejects.toThrow('Unauthorized')
    expect(withPlatform).not.toHaveBeenCalled()
    expect((await tenantRow(id)).status).toBe('active')
  }, 60_000)
})

describeIntegration('tenant addresses', () => {
  it('the first address becomes the primary one, whatever was asked', async () => {
    const id = await seedTenant('host1')
    const host = hostOf('h1')
    expect(await addTenantHost(id, host, false)).toEqual({ ok: true })
    expect(await hostsOf(id)).toEqual([{ host, isPrimary: true }])
    for (const rows of [await platformAuditOf(id), await tenantAuditOf(id)]) {
      expect(rows.map(row => [row.operation, row.object_type, row.object_id])).toEqual([
        ['tenant.host.add', 'tenant_host', host], ['tenant.host.primary', 'tenant_host', host],
      ])
    }
  }, 60_000)

  it('a second address is not primary unless asked, and asking moves the primary with both rows', async () => {
    const id = await seedTenant('host2')
    const one = hostOf('h2a')
    const two = hostOf('h2b')
    const three = hostOf('h2c')
    await addTenantHost(id, one, true)
    await addTenantHost(id, two, false)
    expect((await hostsOf(id)).filter(row => row.isPrimary).map(row => row.host)).toEqual([one])
    await addTenantHost(id, three, true)
    expect((await hostsOf(id)).filter(row => row.isPrimary).map(row => row.host)).toEqual([three])
    const rows = await platformAuditOf(id)
    expect(rows.map(row => [row.operation, row.object_id])).toEqual([
      ['tenant.host.add', one], ['tenant.host.primary', one],
      ['tenant.host.add', two],
      ['tenant.host.add', three], ['tenant.host.primary', three],
    ])
    expect((await tenantAuditOf(id)).map(row => [row.operation, row.object_id])).toEqual(rows.map(row => [row.operation, row.object_id]))
  }, 60_000)

  it('normalizes the address and refuses the main address, an address that is taken and one that is not valid', async () => {
    const id = await seedTenant('host3')
    const other = await seedTenant('host3b')
    const host = hostOf('h3')
    expect(await addTenantHost(id, ` ${host.toUpperCase()}:8080`, false)).toEqual({ ok: true })
    expect((await hostsOf(id)).map(row => row.host)).toEqual([host])
    expect(await addTenantHost(other, host, false)).toEqual({ ok: false, reason: 'taken' })
    expect(await addTenantHost(id, MAIN_HOST, false)).toEqual({ ok: false, reason: 'invalid' })
    expect(await addTenantHost(id, 'not a host', false)).toEqual({ ok: false, reason: 'invalid' })
    expect(await hostsOf(other)).toEqual([])
    expect(await platformAuditOf(other)).toEqual([])
  }, 60_000)

  it('refuses an address for the default tenant and for the template', async () => {
    const [template] = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.isTemplate, true)))
    expect(await addTenantHost(1, hostOf('def'), false)).toEqual({ ok: false, reason: 'invalid' })
    expect(await addTenantHost(template.id, hostOf('tpl'), false)).toEqual({ ok: false, reason: 'invalid' })
    expect(await hostsOf(1)).toEqual([])
    expect(await hostsOf(template.id)).toEqual([])
    await expect(addTenantHost(999_999_999, hostOf('none'), false)).rejects.toThrow()
  }, 60_000)

  it('setPrimaryHost moves the primary; for the one that already is, nothing happens and nothing is written', async () => {
    const id = await seedTenant('host4')
    const one = hostOf('h4a')
    const two = hostOf('h4b')
    await addTenantHost(id, one, true)
    await addTenantHost(id, two, false)
    const before = (await platformAuditOf(id)).length
    expect(await setPrimaryHost(id, one)).toEqual({ ok: true })
    expect((await platformAuditOf(id)).length).toBe(before)

    expect(await setPrimaryHost(id, two)).toEqual({ ok: true })
    expect((await hostsOf(id)).filter(row => row.isPrimary).map(row => row.host)).toEqual([two])
    const last = (await platformAuditOf(id)).at(-1)!
    expect(last).toMatchObject({ operation: 'tenant.host.primary', object_id: two })
    expect((await tenantAuditOf(id)).at(-1)).toMatchObject({ operation: 'tenant.host.primary', object_id: two })
    // Un indirizzo che non è del tenant non si rende principale.
    expect(await setPrimaryHost(id, hostOf('ghost'))).toEqual({ ok: false, reason: 'invalid' })
  }, 60_000)

  it('removeTenantHost removes an address; the primary one stays while others exist; the last one can go', async () => {
    const id = await seedTenant('host5')
    const one = hostOf('h5a')
    const two = hostOf('h5b')
    await addTenantHost(id, one, true)
    await addTenantHost(id, two, false)

    expect(await removeTenantHost(id, one)).toEqual({ ok: false, reason: 'primary' })
    expect(await removeTenantHost(id, two)).toEqual({ ok: true })
    expect((await hostsOf(id)).map(row => row.host)).toEqual([one])
    expect((await platformAuditOf(id)).at(-1)).toMatchObject({ operation: 'tenant.host.remove', object_type: 'tenant_host', object_id: two })
    expect((await tenantAuditOf(id)).at(-1)).toMatchObject({ operation: 'tenant.host.remove', object_id: two })

    expect(await removeTenantHost(id, one)).toEqual({ ok: true })
    expect(await hostsOf(id)).toEqual([])
    // Un indirizzo che il tenant non ha: niente da togliere e niente voce.
    const before = (await platformAuditOf(id)).length
    expect(await removeTenantHost(id, hostOf('ghost'))).toEqual({ ok: true })
    expect((await platformAuditOf(id)).length).toBe(before)
  }, 60_000)

  it('does not touch an address of another tenant when asked to remove it from this one', async () => {
    const mine = await seedTenant('host6')
    const theirs = await seedTenant('host6b')
    const host = hostOf('h6')
    await addTenantHost(theirs, host, true)
    expect(await removeTenantHost(mine, host)).toEqual({ ok: true })
    expect(await hostsOf(theirs)).toEqual([{ host, isPrimary: true }])
    expect(await setPrimaryHost(mine, host)).toEqual({ ok: false, reason: 'invalid' })
  }, 60_000)

  it('leaves the address when the audit row cannot be written', async () => {
    const id = await seedTenant('host7')
    failNextAudit.on = true
    await expect(addTenantHost(id, hostOf('h7'), false)).rejects.toThrow('audit write failed')
    expect(await hostsOf(id)).toEqual([])
    expect(await tenantAuditOf(id)).toEqual([])
  }, 60_000)

  it('refuses someone who is not a platform admin and invalid arguments before the database', async () => {
    const id = await seedTenant('host8')
    await expect(addTenantHost(id, '', false)).rejects.toThrow()
    await expect((addTenantHost as (...a: unknown[]) => Promise<unknown>)('x', hostOf('h8'), false)).rejects.toThrow()
    await expect((addTenantHost as (...a: unknown[]) => Promise<unknown>)(id, hostOf('h8'), 'yes')).rejects.toThrow()
    mocks.session = null
    await expect(addTenantHost(id, hostOf('h8'), false)).rejects.toThrow('Unauthorized')
    await expect(removeTenantHost(id, hostOf('h8'))).rejects.toThrow('Unauthorized')
    await expect(setPrimaryHost(id, hostOf('h8'))).rejects.toThrow('Unauthorized')
    expect(withPlatform).not.toHaveBeenCalled()
  }, 60_000)
})

describeIntegration('tenant administrators', () => {
  it('addTenantAdmin makes a new account an administrator, emails a link to the tenant host and writes both registers', async () => {
    const id = await seedTenant('adm1')
    const host = hostOf('adm1')
    await addTenantHost(id, host, true)
    mocks.sendEmail.mockClear()
    const email = emailOf('newadmin')

    expect(await addTenantAdmin(id, `  ${email.toUpperCase()} `)).toEqual({ ok: true, invited: true })
    const account = await userByEmail(email)
    createdUserIds.push(account.id)
    expect(account.passwordHash).toBeNull()
    expect(await rolesOf(id, account.id)).toEqual(['REGISTERED', 'TENANT_ADMIN'])
    const [token] = await tokensOf(account.id)
    expect(token).toMatchObject({ purpose: 'invitation', deliveryStatus: 'sent', requestedBy: platformAdmin.id })
    expect(emailsSent()).toHaveLength(1)
    expect(emailsSent()[0].html).toContain(`https://${host}/set-password?token=${token.token}`)

    const platform = onlyOperations(await platformAuditOf(id), ['tenant.admin.add'])
    const tenantSide = onlyOperations(await tenantAuditOf(id), ['tenant.admin.add'])
    for (const rows of [platform, tenantSide]) {
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ object_type: 'user', object_id: account.id, actor_kind: 'platform', actor_user_id: platformAdmin.id })
      expect(rows[0].details).toMatchObject({ email, invited: true })
      expect(JSON.stringify(rows[0])).not.toContain(token.token)
    }
  }, 60_000)

  it('an existing account with a password becomes an administrator with no email', async () => {
    const id = await seedTenant('adm2')
    const known = await createAccount(emailOf('knownadmin'))
    expect(await addTenantAdmin(id, known.email)).toEqual({ ok: true, invited: false })
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(await rolesOf(id, known.id)).toEqual(['REGISTERED', 'TENANT_ADMIN'])
    expect(await tokensOf(known.id)).toEqual([])
    expect(onlyOperations(await platformAuditOf(id), ['tenant.admin.add'])[0].details).toMatchObject({ invited: false })
  }, 60_000)

  it('promotes an existing member of the tenant to administrator', async () => {
    const id = await seedTenant('adm3')
    const member = await seedMember(id, 'member')
    expect(await addTenantAdmin(id, member.email)).toEqual({ ok: true, invited: false })
    expect(await rolesOf(id, member.id)).toEqual(['REGISTERED', 'TENANT_ADMIN'])
  }, 60_000)

  it('does nothing and writes nothing for somebody who already is an administrator with a password', async () => {
    const id = await seedTenant('adm4')
    const admin = await seedAdmin(id, 'already')
    expect(await addTenantAdmin(id, admin.email)).toEqual({ ok: true, invited: false })
    expect(await platformAuditOf(id)).toEqual([])
    expect(await tenantAuditOf(id)).toEqual([])
  }, 60_000)

  it('keeps the administrator and says the invitation was not sent when the email cannot be sent', async () => {
    const id = await seedTenant('adm5')
    mocks.sendEmail.mockRejectedValue(new Error('smtp down'))
    const email = emailOf('mailfailadmin')
    expect(await addTenantAdmin(id, email)).toEqual({ ok: true, invited: false, inviteFailed: true })
    const account = await userByEmail(email)
    createdUserIds.push(account.id)
    expect(await rolesOf(id, account.id)).toContain('TENANT_ADMIN')
    expect((await tokensOf(account.id))[0].deliveryStatus).toBe('failed')
  }, 60_000)

  it('refuses a globally deactivated account and changes nothing', async () => {
    const id = await seedTenant('adm6')
    const off = await createAccount(emailOf('offadmin'), { status: 1 })
    await expect(addTenantAdmin(id, off.email)).rejects.toThrow()
    expect(await withTenant(id, tx => tx.select().from(tenantMembership).where(eq(tenantMembership.userId, off.id)))).toEqual([])
    expect(await platformAuditOf(id)).toEqual([])
  }, 60_000)

  it('add admin and resend invite are refused in a suspended tenant', async () => {
    const pending = await seedTenant('adm7')
    const waiting = await seedAdmin(pending, 'waiting', { password: false })
    await setTenantStatus(pending, 'suspended')
    const rowsBefore = [(await platformAuditOf(pending)).length, (await tenantAuditOf(pending)).length]
    const email = emailOf('refusedadmin')

    await expect(addTenantAdmin(pending, email)).rejects.toThrow()
    await expect(resendTenantInvite(pending, waiting.id)).rejects.toThrow()
    expect(await userByEmail(email)).toBeUndefined()
    expect(await tokensOf(waiting.id)).toEqual([])
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect([(await platformAuditOf(pending)).length, (await tenantAuditOf(pending)).length]).toEqual(rowsBefore)
  }, 60_000)

  it('add admin and resend invite are refused in an archived tenant and in the template', async () => {
    const archived = await seedTenant('adm8')
    const waiting = await seedAdmin(archived, 'waiting8', { password: false })
    await setTenantStatus(archived, 'archived', 'chiuso')
    await expect(addTenantAdmin(archived, emailOf('x'))).rejects.toThrow()
    await expect(resendTenantInvite(archived, waiting.id)).rejects.toThrow()

    const [template] = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.isTemplate, true)))
    await expect(addTenantAdmin(template.id, emailOf('y'))).rejects.toThrow()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  }, 60_000)

  it('resendTenantInvite sends a new link to an administrator who has not set a password', async () => {
    const id = await seedTenant('res1')
    const host = hostOf('res1')
    await addTenantHost(id, host, true)
    const waiting = await seedAdmin(id, 'waiting1', { password: false })

    expect(await resendTenantInvite(id, waiting.id)).toEqual({ ok: true, invited: true })
    const [token] = await tokensOf(waiting.id)
    expect(token).toMatchObject({ deliveryStatus: 'sent', requestedBy: platformAdmin.id })
    expect(emailsSent()).toHaveLength(1)
    expect(emailsSent()[0].to).toBe(waiting.email)
    expect(emailsSent()[0].html).toContain(`https://${host}/set-password?token=${token.token}`)

    // Un secondo invio sostituisce il primo: solo l'ultimo link vale.
    expect(await resendTenantInvite(id, waiting.id)).toEqual({ ok: true, invited: true })
    const tokens = await tokensOf(waiting.id)
    expect(tokens).toHaveLength(2)
    expect(tokens.filter(row => row.supersededAt === null)).toHaveLength(1)

    for (const rows of [onlyOperations(await platformAuditOf(id), ['tenant.invite.resend']), onlyOperations(await tenantAuditOf(id), ['tenant.invite.resend'])]) {
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ object_type: 'user', object_id: waiting.id, actor_kind: 'platform' })
      expect(JSON.stringify(rows)).not.toContain(token.token)
    }
  }, 60_000)

  it('resendTenantInvite does nothing for an administrator who already has a password, and refuses people who are not administrators', async () => {
    const id = await seedTenant('res2')
    const admin = await seedAdmin(id, 'withpass')
    const member = await seedMember(id, 'plainmember')
    const outsider = await createAccount(emailOf('outsider'), { password: false })
    expect(await resendTenantInvite(id, admin.id)).toEqual({ ok: true, invited: false })
    await expect(resendTenantInvite(id, member.id)).rejects.toThrow()
    await expect(resendTenantInvite(id, outsider.id)).rejects.toThrow()
    await expect(resendTenantInvite(id, 'not-a-uuid')).rejects.toThrow()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect(await tokensOf(outsider.id)).toEqual([])
    expect(await platformAuditOf(id)).toEqual([])
  }, 60_000)

  it('does not resend the invitation of an administrator of another tenant', async () => {
    const mine = await seedTenant('res3')
    const theirs = await seedTenant('res3b')
    const waiting = await seedAdmin(theirs, 'theirs', { password: false })
    await expect(resendTenantInvite(mine, waiting.id)).rejects.toThrow()
    expect(await tokensOf(waiting.id)).toEqual([])
  }, 60_000)

  it('leaves no token when the audit row cannot be written', async () => {
    const id = await seedTenant('adm9')
    const email = emailOf('rollbackadmin')
    failNextAudit.on = true
    await expect(addTenantAdmin(id, email)).rejects.toThrow('audit write failed')
    expect(await userByEmail(email)).toBeUndefined()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  }, 60_000)

  it('refuses someone who is not a platform admin and invalid arguments before the database', async () => {
    const id = await seedTenant('adm10')
    await expect(addTenantAdmin(id, 'non-una-email')).rejects.toThrow()
    await expect(resendTenantInvite(id, 'x')).rejects.toThrow()
    expect(withPlatform).not.toHaveBeenCalled()
    mocks.session = null
    await expect(addTenantAdmin(id, emailOf('z'))).rejects.toThrow('Unauthorized')
    await expect(resendTenantInvite(id, crypto.randomUUID())).rejects.toThrow('Unauthorized')
    expect(withPlatform).not.toHaveBeenCalled()
  }, 60_000)
})

describeIntegration('each console action writes one row in the platform audit and one in the tenant audit', () => {
  it('for every action, the two registers get the same operation about the same object', async () => {
    const id = await seedTenant('both')
    const host = hostOf('both')
    const waiting = await seedAdmin(id, 'bothwaiting', { password: false })
    const newAdmin = emailOf('bothnew')
    const second = hostOf('both2')
    const steps: Array<[string, () => Promise<unknown>]> = [
      ['tenant.host.add', () => addTenantHost(id, host, false)],
      ['tenant.status', () => setTenantStatus(id, 'suspended')],
      ['tenant.status', () => setTenantStatus(id, 'active')],
      ['tenant.admin.add', () => addTenantAdmin(id, newAdmin)],
      ['tenant.invite.resend', () => resendTenantInvite(id, waiting.id)],
      ['tenant.host.remove', async () => { await addTenantHost(id, second, false); return removeTenantHost(id, second) }],
    ]
    for (const [operation, run] of steps) {
      const before = [onlyOperations(await platformAuditOf(id), [operation]).length, onlyOperations(await tenantAuditOf(id), [operation]).length]
      await run()
      const after = [onlyOperations(await platformAuditOf(id), [operation]).length, onlyOperations(await tenantAuditOf(id), [operation]).length]
      expect(after[0] - before[0], `${operation} in the platform audit`).toBeGreaterThanOrEqual(1)
      expect(after[0] - before[0], `${operation}: both registers`).toBe(after[1] - before[1])
    }
    const account = await userByEmail(newAdmin)
    if (account) createdUserIds.push(account.id)
  }, 90_000)
})

describeIntegration('getTenantForPlatform', () => {
  it('returns the tenant with its addresses and administrators, and nothing else of the tenant', async () => {
    const id = await seedTenant('detail')
    const host = hostOf('detail')
    await addTenantHost(id, host, true)
    const waiting = await seedAdmin(id, 'dwaiting', { password: false })
    const ready = await seedAdmin(id, 'dready')
    const member = await seedMember(id, 'dmember')

    const detail = await getTenantForPlatform(id)
    expect(detail).toMatchObject({ id, name: 'ZZZ detail', status: 'active', isTemplate: false, isDefault: false })
    expect(detail?.hosts).toEqual([{ host, isPrimary: true }])
    expect(detail?.admins.map(admin => [admin.email, admin.hasPassword]).sort()).toEqual([
      [ready.email, true], [waiting.email, false],
    ].sort())
    expect(detail?.admins.find(admin => admin.email === waiting.email)?.userId).toBe(waiting.id)
    // Chi non è amministratore non esce dal tenant (MT5-OK-2).
    expect(JSON.stringify(detail)).not.toContain(member.email)
  }, 60_000)

  it('is empty for an id that does not exist, shows the default tenant and the template, and refuses a non-admin', async () => {
    expect(await getTenantForPlatform(999_999_999)).toBeNull()
    expect(await getTenantForPlatform(1)).toMatchObject({ slug: 'default', isDefault: true })
    const [template] = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.isTemplate, true)))
    expect(await getTenantForPlatform(template.id)).toMatchObject({ isTemplate: true, admins: [], hosts: [] })
    vi.mocked(withPlatform).mockClear()
    mocks.session = null
    await expect(getTenantForPlatform(1)).rejects.toThrow('Unauthorized')
    expect(withPlatform).not.toHaveBeenCalled()
  }, 60_000)
})
