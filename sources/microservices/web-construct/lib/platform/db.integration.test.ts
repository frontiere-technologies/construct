import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { closePlatform, withPlatform } from '@/lib/platform/db'

/**
 * L'identità di piattaforma (specifica 2026-10-26, §2.2, MT5-RISK-1): un login dedicato, membro di
 * construct_owner con NOINHERIT, che l'app apre solo da lib/platform/db.ts. Prima del
 * `set local role` non ha alcun privilegio; dopo, scrive i cataloghi che il ruolo dell'app può solo
 * leggere. La RLS forzata vale anche per il proprietario: una scrittura di tenant chiede il tenant.
 */
// Ogni client costruito dopo questa riga registra le istruzioni che manda: la prova del controllo del
// login (una volta per pool) conta le istruzioni del pool di piattaforma.
const sent = vi.hoisted(() => [] as string[])
vi.mock('@/lib/db/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db/client')>()
  return {
    ...actual,
    createDatabase: (url: string, options: Parameters<typeof actual.createDatabase>[1] = {}) => actual.createDatabase(url, {
      ...options,
      onQuery: (query, parameters) => { sent.push(query); options.onQuery?.(query, parameters) },
    }),
  }
})

const createdTenants: TenantId[] = []
const createdEmails: string[] = []

/** Codice e messaggi dell'errore e delle sue cause: Drizzle avvolge l'eccezione di Postgres. */
function failureOf(error: unknown): { codes: string[]; text: string } {
  const codes: string[] = []
  const messages: string[] = []
  let current: unknown = error
  while (current && typeof current === 'object') {
    if ('code' in current && typeof current.code === 'string') codes.push(current.code)
    if ('message' in current) messages.push(String(current.message))
    current = 'cause' in current ? current.cause : undefined
  }
  return { codes, text: messages.join('\n') }
}

async function failureFrom(operation: Promise<unknown>): Promise<{ codes: string[]; text: string }> {
  try {
    await operation
  } catch (error) {
    return failureOf(error)
  }
  throw new Error('expected the database to refuse')
}

function slug(): string {
  return `zzz-platform-${unique()}`.slice(0, 40)
}

/** Un tenant dal modello con il suo indirizzo, scritti come farà la console: solo da withPlatform. */
async function createTenantThroughPlatform(host: string): Promise<TenantId> {
  const id = await withPlatform(async tx => {
    const [created] = await tx.execute<{ id: string }>(sql`
      select app_private.create_tenant_from_template(${slug()}, 'Prova piattaforma')::text as id`)
    await tx.execute(sql`
      insert into public.tenant_host (host, id_tenant, is_primary) values (${host}, ${created.id}, true)`)
    return tenantIdForTest(Number(created.id))
  })
  createdTenants.push(id)
  return id
}

describeIntegration('the platform identity', () => {
  beforeAll(() => {
    if (!process.env.TEST_PLATFORM_DATABASE_URL) {
      throw new Error('TEST_PLATFORM_DATABASE_URL is missing: run local-test-db.sh up (it provisions construct_platform)')
    }
  })

  afterAll(async () => {
    const errors: unknown[] = []
    try {
      for (const email of createdEmails) {
        await withOwner(tx => tx.execute(sql`delete from public.users where email = ${email}`))
      }
    } catch (error) { errors.push(error) }
    for (const id of createdTenants) {
      try { await deleteTenantForTest(id) } catch (error) { errors.push(error) }
    }
    try { await closePlatform() } catch (error) { errors.push(error) }
    try { await closeOwner() } catch (error) { errors.push(error) }
    if (errors.length > 0) throw errors[0]
  }, 30_000)

  it('writes tenant and tenant_host, which the runtime role can only read', async () => {
    const host = `zzz-${unique()}.platform.test`
    const id = await createTenantThroughPlatform(host)

    const read = await withGlobal(tx => tx.execute<{ slug: string; host: string; is_primary: boolean }>(sql`
      select t.slug, h.host, h.is_primary
      from public.tenant t join public.tenant_host h on h.id_tenant = t.id
      where t.id = ${id}`))
    expect(read).toHaveLength(1)
    expect(read[0]).toMatchObject({ host, is_primary: true })

    // Lo stesso insert con la connessione dell'app: il ruolo dell'app non scrive `tenant`.
    const refused = await failureFrom(withGlobal(tx => tx.execute(sql`
      insert into public.tenant (slug, name) values (${slug()}, 'Non deve nascere')`)))
    expect(refused.codes).toContain('42501')
    const refusedHost = await failureFrom(withGlobal(tx => tx.execute(sql`
      insert into public.tenant_host (host, id_tenant, is_primary) values (${`zzz-${unique()}.refused.test`}, ${id}, false)`)))
    expect(refusedHost.codes).toContain('42501')
  }, 30_000)

  it('works as construct_owner inside the transaction and as the dedicated login outside it', async () => {
    const inside = await withPlatform(tx => tx.execute<{ current_user: string; session_user: string }>(sql`
      select current_user::text as current_user, session_user::text as session_user`))
    expect(inside[0].current_user).toBe('construct_owner')
    expect(inside[0].session_user).not.toBe('construct_owner')
    expect(inside[0].session_user).not.toBe(new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://x@h/d').username)
  })

  it('has no privileges of its own: without `set local role` the same login cannot write', async () => {
    const raw = postgres(process.env.TEST_PLATFORM_DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10 })
    try {
      const [identity] = await raw`
        select current_user::text as login,
               pg_has_role(current_user, 'construct_owner', 'USAGE') as inherits,
               pg_has_role(current_user, 'construct_owner', 'MEMBER') as member,
               r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb
        from pg_roles r where r.rolname = current_user`
      expect(identity).toMatchObject({
        member: true, inherits: false, rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false,
      })
      const failure = await failureFrom(raw`insert into public.tenant (slug, name) values (${slug()}, 'Senza ruolo')`)
      expect(failure.codes).toContain('42501')
      const [afterSetRole] = await raw.begin(async tx => {
        await tx`set local role construct_owner`
        return tx`select pg_has_role(current_user, 'construct_owner', 'USAGE') as owner`
      })
      expect(afterSetRole.owner).toBe(true)
    } finally {
      await raw.end({ timeout: 5 })
    }
  })

  describe('the login behind PLATFORM_DATABASE_URL', () => {
    const LOGIN_CHECK = /rolbypassrls/
    let platformUrl: string | undefined

    beforeAll(() => { platformUrl = process.env.TEST_PLATFORM_DATABASE_URL })
    afterEach(async () => {
      process.env.TEST_PLATFORM_DATABASE_URL = platformUrl
      await closePlatform()
    })

    it('refuses a pool built with the owner or migration login, on every transaction, before it can do anything', async () => {
      const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL
      if (!ownerUrl) throw new Error('TEST_MIGRATION_DATABASE_URL is missing: this check needs the owner login to point the pool at')
      process.env.TEST_PLATFORM_DATABASE_URL = ownerUrl
      await closePlatform()
      for (let attempt = 0; attempt < 2; attempt += 1) {
        sent.length = 0
        const failure = await failureFrom(withPlatform(tx => tx.execute(sql`select 1`)))
        expect(failure.text).toContain('PLATFORM_DATABASE_URL non è il login di piattaforma')
        // Il difetto non si ricorda come un successo: la richiesta dopo lo rivede.
        expect(sent.filter(query => LOGIN_CHECK.test(query))).toHaveLength(1)
        // Nessuna istruzione del chiamante è partita, e il ruolo non è nemmeno cambiato.
        expect(sent.some(query => /set local role/i.test(query))).toBe(false)
        expect(sent.some(query => /select 1/.test(query))).toBe(false)
      }
    })

    it('lets the platform login through, checking it only on the first transaction of the pool', async () => {
      await closePlatform()
      sent.length = 0
      await withPlatform(tx => tx.execute(sql`select 1`))
      expect(sent.filter(query => LOGIN_CHECK.test(query))).toHaveLength(1)
      const firstTrips = sent.length
      sent.length = 0
      await withPlatform(tx => tx.execute(sql`select 1`))
      expect(sent.filter(query => LOGIN_CHECK.test(query))).toHaveLength(0)
      // Dopo il primo restano solo begin, set local role, la lettura e commit: niente controllo (e niente lettura dei tipi del driver, che è della connessione nuova).
      expect(sent.length).toBeLessThan(firstTrips)
      expect(sent.map(query => query.trim().toLowerCase().split(/\s+/).slice(0, 3).join(' '))).toEqual(['begin', 'set local role', 'select 1', 'commit'])
    })
  })

  it('sets the tenant of the transaction only when asked, and only for that transaction', async () => {
    const id = await createTenantThroughPlatform(`zzz-${unique()}.tenant-arg.test`)

    // Senza tenant una tabella di tenant risponde 42501 anche al proprietario (RLS forzata).
    const noTenant = await failureFrom(withPlatform(tx => tx.execute(sql`select count(*) from public.role`)))
    expect(noTenant.codes).toContain('42501')
    expect(noTenant.text).toContain('tenant context missing')

    const withTenantSet = await withPlatform(async tx => {
      const [current] = await tx.execute<{ id: string }>(sql`select app_private.current_tenant_id()::text as id`)
      const roles = await tx.execute<{ n: string }>(sql`select count(*)::text as n from public.role`)
      return { current: current.id, roles: Number(roles[0].n) }
    }, id)
    expect(withTenantSet.current).toBe(String(id))
    expect(withTenantSet.roles).toBeGreaterThan(0)

    // Una scrittura di tenant dentro lo stesso tenant riesce, e finisce solo lì.
    const marker = `zzz-role-${unique()}`
    await withPlatform(tx => tx.execute(sql`
      insert into public.role (description) values (${marker})`), id)
    const found = await withPlatform(tx => tx.execute<{ n: string }>(sql`
      select count(*)::text as n from public.role where description = ${marker}`), id)
    expect(Number(found[0].n)).toBe(1)

    // Il tenant e il ruolo non restano sulla connessione: lo si prova sulla stessa connessione, con un
    // client a una sola connessione che fa le stesse due istruzioni di withPlatform e poi si guarda
    // intorno. (Con il pool di withPlatform la transazione dopo potrebbe cadere su un'altra.)
    const raw = postgres(process.env.TEST_PLATFORM_DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10 })
    try {
      await raw.begin(async tx => {
        await tx`set local role construct_owner`
        await tx`select set_config('app.tenant_id', ${String(id)}, true)`
        const [during] = await tx`select current_user::text as who, current_setting('app.tenant_id', true) as tenant`
        expect(during).toEqual({ who: 'construct_owner', tenant: String(id) })
      })
      const [after] = await raw`
        select current_user::text as who, nullif(current_setting('app.tenant_id', true), '') as tenant`
      expect(after.who).not.toBe('construct_owner')
      expect(after.tenant).toBeNull()
    } finally {
      await raw.end({ timeout: 5 })
    }
  }, 30_000)

  it('rolls everything back when the function throws', async () => {
    const marker = slug()
    await failureFrom(withPlatform(async tx => {
      await tx.execute(sql`insert into public.tenant (slug, name) values (${marker}, 'Da annullare')`)
      throw new Error('console failure')
    }))
    const rows = await withGlobal(tx => tx.execute(sql`select 1 from public.tenant where slug = ${marker}`))
    expect(rows).toHaveLength(0)
  })

  it('can set users.is_platform_admin, which the plain application connection cannot', async () => {
    const email = `zzz-platform-admin-${unique()}@example.test`
    createdEmails.push(email)
    await withPlatform(tx => tx.execute(sql`insert into public.users (email, is_platform_admin) values (${email}, true)`))
    const [row] = await withPlatform(tx => tx.execute<{ is_platform_admin: boolean }>(sql`
      select is_platform_admin from public.users where email = ${email}`))
    expect(row.is_platform_admin).toBe(true)

    const refused = await failureFrom(withGlobal(tx => tx.execute(sql`
      update public.users set is_platform_admin = false where email = ${email}`)))
    expect(refused.codes).toContain('42501')
    expect(refused.text).toContain('is_platform_admin')
  })
})
