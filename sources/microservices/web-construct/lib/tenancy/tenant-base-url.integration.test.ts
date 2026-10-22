import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, like, sql } from 'drizzle-orm'
import { allowedDomains, appTheme, tenantMembership, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route'
import { POST as register } from '@/app/api/auth/register/route'
import { getRequestAppTheme } from '@/lib/theme-server'
import { tenantBaseUrl } from './tenant-base-url'
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
      onHost(`${aHost}:3000`)
      const response = await register(post('/api/auth/register', `${aHost}:3000`, { email }))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
      const userId = await userIdOf(email)
      expect(userId).not.toBeNull()
      expect(await membershipStatus(A, userId!)).toEqual([])
      // Nemmeno nel predefinito: l'indirizzo di A non ricade mai sull'indirizzo principale.
      expect(await membershipStatus(DEFAULT, userId!)).toEqual([])
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
