import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { count, eq, like, sql } from 'drizzle-orm'
import { allowedDomains, appTheme, passwordSetTokens, tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route'
import { POST as register } from '@/app/api/auth/register/route'
import { getRequestAppTheme } from '@/lib/theme-server'
import { getSystemRoleIds } from './system-roles'
import { tenantBaseUrl } from './tenant-base-url'
import { acceptsSelfRegistration } from './tenant-settings'
import { defaultTestTenant, tenantIdForTest } from './testing'
import type { TenantId } from './tenant-id'

/**
 * Pagine e rotte prima dell'accesso dal tenant dell'indirizzo, e link nelle email dall'indirizzo
 * principale del tenant (specifica 2026-10-21, §3.3, §3.4, MT4-DEC-9, 11, 12; Review Focus #3).
 * Fuori da una richiesta di Next: intestazioni, sessione (nessuna), invio delle email e limite dei
 * tentativi sono finti; registro degli indirizzi, interruttore, appartenenze e token sono veri. Due
 * tenant nati dal modello: A con un indirizzo dedicato principale (al posto di `a.localhost`, un
 * nome unico per esecuzione) e C senza indirizzo. Un dominio email consentito, unico anche lui.
 * Tutto sparisce in afterAll.
 */
const mocks = vi.hoisted(() => ({
  headers: new Headers(),
  sent: [] as Array<{ to: string; html: string; text: string }>,
}))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('@/lib/auth-session', () => ({ getSession: async () => null }))
vi.mock('@/lib/mailer', () => ({
  sendEmail: async (message: { to: string; html: string; text: string }) => { mocks.sent.push(message) },
}))
vi.mock('@/lib/auth-rate-limit', () => ({
  enforceAuthRateLimit: async () => undefined,
  AuthRateLimitExceeded: class AuthRateLimitExceeded extends Error {},
}))
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))

const AUTH_URL = 'http://localhost:3000'
const DEFAULT = defaultTestTenant()

let A: TenantId
let C: TenantId
let aHost: string
let domain: string
const createdTenants: TenantId[] = []

async function createTenant(name: string): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-tbu-${unique()}`.slice(0, 40)}, ${name})::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  return id
}

async function setSelfRegistration(tenantId: TenantId, value: boolean): Promise<void> {
  await withTenant(tenantId, tx => tx.execute(sql`update public.tenant_settings set self_registration = ${value}`))
}

async function userIdOf(email: string): Promise<string | null> {
  const [row] = await withGlobal(tx => tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))
  return row?.id ?? null
}

/** I token di impostazione della password: una registrazione rifiutata non ne crea. */
async function tokenCount(): Promise<number> {
  const [row] = await withGlobal(tx => tx.select({ n: count() }).from(passwordSetTokens))
  return row?.n ?? 0
}

async function membershipStatus(tenantId: TenantId, userId: string): Promise<string[]> {
  const rows = await withTenant(tenantId, tx => tx.select({ status: tenantMembership.status })
    .from(tenantMembership).where(eq(tenantMembership.userId, userId)))
  return rows.map(row => row.status)
}

function onHost(host: string): void {
  mocks.headers = new Headers({ host })
}

function post(path: string, host: string, body: unknown): NextRequest {
  return new NextRequest(`http://${host}${path}`, {
    method: 'POST',
    headers: { host, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function newEmail(): string {
  return `zzz_tbu_${unique()}@${domain}`
}

/** I link `/set-password` di tutte le email mandate, dal testo e dall'HTML. */
function sentLinks(): string[] {
  return mocks.sent.flatMap(message => [message.html, message.text])
    .flatMap(body => body.match(/https?:\/\/[^\s"<]+\/set-password\?token=[^\s"<]+/g) ?? [])
}

describeIntegration('tenant base url and pre-login pages on the address of the tenant', () => {
  beforeAll(async () => {
    A = await createTenant('ZZZ Alfa base url')
    C = await createTenant('ZZZ Charlie base url')
    aHost = `zzz-tbu-${unique()}.localhost`
    domain = `zzz-tbu-${unique()}.test`
    await withOwner(async tx => {
      await tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${aHost}, ${A}, true)`)
      await tx.insert(allowedDomains).values({ domain, active: true })
    })
  }, 60_000)

  afterAll(async () => {
    // Passi indipendenti: uno che fallisce non lascia indietro gli altri. Appartenenze e token delle
    // persone di prova spariscono con loro (ON DELETE CASCADE).
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    if (domain) await step(() => withGlobal(tx => tx.delete(users).where(like(users.email, `%@${domain}`))))
    if (domain) await step(() => withOwner(tx => tx.delete(allowedDomains).where(eq(allowedDomains.domain, domain))))
    for (const id of createdTenants) await step(() => deleteTenantForTest(id))
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  }, 60_000)

  beforeEach(() => {
    vi.stubEnv('AUTH_URL', AUTH_URL)
    vi.stubEnv('NEXTAUTH_URL', '')
    vi.stubEnv('TRUST_FORWARDED_HOST', '')
    mocks.sent.length = 0
    onHost('localhost:3000')
  })
  afterEach(() => vi.unstubAllEnvs())

  describe('tenantBaseUrl', () => {
    it('tenantBaseUrl uses the primary host of the tenant and the scheme and port of AUTH_URL', async () => {
      expect(await tenantBaseUrl(A)).toBe(`http://${aHost}:3000`)

      vi.stubEnv('AUTH_URL', 'https://construct.example.test:8443/')
      expect(await tenantBaseUrl(A)).toBe(`https://${aHost}:8443`)

      // Un indirizzo non principale dello stesso tenant non entra nei link.
      const secondary = `zzz-tbu-${unique()}.localhost`
      await withOwner(tx => tx.execute(sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${secondary}, ${A}, false)`))
      try {
        expect(await tenantBaseUrl(A)).toBe(`https://${aHost}:8443`)
      } finally {
        await withOwner(tx => tx.execute(sql`delete from public.tenant_host where host = ${secondary}`))
      }
    })

    it('tenantBaseUrl falls back to AUTH_URL for tenants without host', async () => {
      expect(await tenantBaseUrl(C)).toBe(AUTH_URL)
      expect(await tenantBaseUrl(DEFAULT)).toBe(AUTH_URL)

      vi.stubEnv('AUTH_URL', '')
      vi.stubEnv('NEXTAUTH_URL', 'https://legacy.example.test/')
      expect(await tenantBaseUrl(C)).toBe('https://legacy.example.test/')
      expect(await tenantBaseUrl(A)).toBe(`https://${aHost}`)

      vi.stubEnv('NEXTAUTH_URL', '')
      await expect(tenantBaseUrl(C)).rejects.toThrow('server_configuration')
    })
  })

  describe('acceptsSelfRegistration', () => {
    it('is true only for an active tenant with the switch on; a missing row or a suspended tenant is off', async () => {
      // A nasce dal modello con l'interruttore spento; il predefinito parte acceso.
      expect(await acceptsSelfRegistration(A)).toBe(false)
      expect(await acceptsSelfRegistration(DEFAULT)).toBe(true)

      const S = await createTenant('ZZZ Sospeso base url')
      await setSelfRegistration(S, true)
      expect(await acceptsSelfRegistration(S)).toBe(true)
      await withOwner(tx => tx.execute(sql`update public.tenant set status = 'suspended' where id = ${S}`))
      expect(await acceptsSelfRegistration(S)).toBe(false)

      // Riga delle impostazioni mancante: spento, anche per un tenant attivo.
      await withOwner(tx => tx.execute(sql`update public.tenant set status = 'active' where id = ${S}`))
      await withTenant(S, tx => tx.execute(sql`delete from public.tenant_settings`))
      expect(await acceptsSelfRegistration(S)).toBe(false)
    })
  })

  describe('registration and password recovery', () => {
    it('register from a.localhost joins A when A accepts self registration', async () => {
      const email = newEmail()
      await setSelfRegistration(A, true)
      try {
        onHost(`${aHost}:3000`)
        const response = await register(post('/api/auth/register', `${aHost}:3000`, { email }))

        expect(await response.json()).toEqual({ ok: true })
        const userId = await userIdOf(email)
        expect(userId).not.toBeNull()
        expect(await membershipStatus(A, userId!)).toEqual(['active'])
        expect(await membershipStatus(DEFAULT, userId!)).toEqual([])
        // Il link dell'email punta all'indirizzo di A (MT4-OK-5).
        expect(sentLinks().length).toBeGreaterThan(0)
        for (const link of sentLinks()) expect(link.startsWith(`http://${aHost}:3000/set-password?token=`)).toBe(true)
      } finally {
        await setSelfRegistration(A, false)
      }
    })

    it('register from a.localhost does nothing in A when the switch is off, same answer', async () => {
      const email = newEmail()
      const tokensBefore = await tokenCount()
      onHost(`${aHost}:3000`)
      const response = await register(post('/api/auth/register', `${aHost}:3000`, { email }))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
      // MT4-OK-5: non si crea nulla. Né l'account, né un token, né l'email.
      expect(await userIdOf(email)).toBeNull()
      expect(await tokenCount()).toBe(tokensBefore)
      expect(mocks.sent).toEqual([])
    })

    it('register from a.localhost sends nothing to a person who already belongs to another tenant, same answer', async () => {
      // Un account senza password, membro di C (in attesa di impostare la password): lo aggiunge ad A
      // l'amministratore di A, e l'invito di C lo rimanda l'amministratore di C (MT4-DEC-9).
      const email = newEmail()
      const [created] = await withGlobal(tx => tx.insert(users).values({ email, idUserStatus: 2 }).returning({ id: users.id }))
      await withTenant(C, async tx => {
        const system = await getSystemRoleIds(tx)
        await tx.insert(tenantMembership).values({ userId: created.id })
        await tx.insert(userRole).values({ userId: created.id, idRole: system.registered })
      })
      await setSelfRegistration(A, true)
      try {
        onHost(`${aHost}:3000`)
        const response = await register(post('/api/auth/register', `${aHost}:3000`, { email }))

        expect(await response.json()).toEqual({ ok: true })
        expect(await membershipStatus(A, created.id)).toEqual([])
        expect(await membershipStatus(C, created.id)).toEqual(['active'])
        expect(mocks.sent).toEqual([])
      } finally {
        await setSelfRegistration(A, false)
      }
    })

    it('register with Host: evil.example builds no link on evil.example', async () => {
      const email = newEmail()
      onHost('evil.example')
      const response = await register(post('/api/auth/register', 'evil.example', { email }))

      expect(await response.json()).toEqual({ ok: true })
      // Un indirizzo sconosciuto è l'indirizzo principale: il tenant predefinito, link su AUTH_URL.
      const userId = await userIdOf(email)
      expect(await membershipStatus(DEFAULT, userId!)).toEqual(['active'])
      expect(sentLinks().length).toBeGreaterThan(0)
      for (const link of sentLinks()) expect(link.startsWith(`${AUTH_URL}/set-password?token=`)).toBe(true)
      for (const message of mocks.sent) expect(`${message.html}${message.text}`).not.toContain('evil.example')
    })

    it('forgot-password with Host: evil.example builds no link on evil.example', async () => {
      const email = newEmail()
      await withGlobal(tx => tx.insert(users).values({ email, passwordHash: 'not-a-real-hash', idUserStatus: 2 }))
      onHost('evil.example')
      const response = await forgotPassword(post('/api/auth/forgot-password', 'evil.example', { email }))

      expect(await response.json()).toEqual({ ok: true })
      expect(sentLinks().length).toBeGreaterThan(0)
      for (const link of sentLinks()) expect(link.startsWith(`${AUTH_URL}/set-password?token=`)).toBe(true)
      for (const message of mocks.sent) expect(`${message.html}${message.text}`).not.toContain('evil.example')
    })

    it('forgot-password from a.localhost builds the link on the primary host of A', async () => {
      const email = newEmail()
      await withGlobal(tx => tx.insert(users).values({ email, passwordHash: 'not-a-real-hash', idUserStatus: 2 }))
      onHost(`${aHost.toUpperCase()}:3000`)
      await forgotPassword(post('/api/auth/forgot-password', `${aHost}:3000`, { email }))

      expect(sentLinks().length).toBeGreaterThan(0)
      for (const link of sentLinks()) expect(link.startsWith(`http://${aHost}:3000/set-password?token=`)).toBe(true)
    })
  })

  describe('root layout theme', () => {
    it('the root layout theme on a.localhost is the theme of A', async () => {
      await withTenant(A, tx => tx.update(appTheme).set({ primaryColor: '#123456' }))
      const [defaultTheme] = await withTenant(DEFAULT, tx => tx.select({ primaryColor: appTheme.primaryColor }).from(appTheme))

      onHost(`${aHost}:3000`)
      expect((await getRequestAppTheme()).primaryColor).toBe('#123456')

      onHost('localhost:3000')
      expect((await getRequestAppTheme()).primaryColor).toBe(defaultTheme?.primaryColor)
    })
  })
})
