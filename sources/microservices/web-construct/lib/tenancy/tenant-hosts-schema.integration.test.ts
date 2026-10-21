import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { tenant } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant, tenantIdForTest } from './testing'
import type { TenantId } from './tenant-id'

/**
 * Indirizzi, impostazioni del tenant e ultimo tenant usato (specifica 2026-10-21, §2.1–§2.3,
 * MT4-DEC-10, MT4-DEC-13, MT4-DEC-17; migrazione 0053). Un tenant nato dal modello in beforeAll
 * riceve gli indirizzi di prova; sparisce in afterAll con i suoi indirizzi.
 */
const DEFAULT = defaultTestTenant()

let template: TenantId
let created: TenantId
const createdTenants: TenantId[] = []

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

/** Un indirizzo di prova che non si scontra con quelli di altre esecuzioni. */
function host(): string {
  return `zzz-${unique()}.localhost`
}

async function hostsOf(tenantId: TenantId): Promise<{ host: string; is_primary: boolean }[]> {
  return withOwner(tx => tx.execute<{ host: string; is_primary: boolean }>(
    sql`select host, is_primary from public.tenant_host where id_tenant = ${tenantId} order by host`))
}

async function selfRegistrationOf(tenantId: TenantId): Promise<boolean[]> {
  const rows = await withTenant(tenantId, tx => tx.execute<{ self_registration: boolean }>(
    sql`select self_registration from public.tenant_settings`))
  return rows.map(row => row.self_registration)
}

describeIntegration('tenant hosts and settings', () => {
  beforeAll(async () => {
    const [found] = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, 'template')))
    if (!found) throw new Error('template tenant missing: is migration 0050 applied?')
    template = tenantIdForTest(found.id)
    const [row] = await withOwner(tx => tx.execute<{ id: string }>(
      sql`select app_private.create_tenant_from_template(${`zzz-host-${unique()}`.slice(0, 40)}, 'Indirizzi di prova')::text as id`))
    created = tenantIdForTest(Number(row.id))
    createdTenants.push(created)
  }, 30_000)

  afterAll(async () => {
    const errors: unknown[] = []
    for (const id of createdTenants) {
      try { await deleteTenantForTest(id) } catch (error) { errors.push(error) }
    }
    try { await closeOwner() } catch (error) { errors.push(error) }
    if (errors.length > 0) throw errors[0]
  }, 30_000)

  it('stores hosts lowercase and without port', async () => {
    for (const bad of ['A.localhost', 'a.localhost:3000', `ZZZ-${unique()}.Localhost`]) {
      const failure = await failureFrom(withOwner(tx => tx.execute(
        sql`insert into public.tenant_host (host, id_tenant) values (${bad}, ${created})`)))
      expect(failure.codes, bad).toContain('23514')
    }
    const good = host()
    await withOwner(tx => tx.execute(sql`insert into public.tenant_host (host, id_tenant) values (${good}, ${created})`))
    expect(await hostsOf(created)).toContainEqual({ host: good, is_primary: false })
  }, 15_000)

  it('refuses a host for the default tenant and for the template', async () => {
    for (const target of [DEFAULT, template]) {
      const failure = await failureFrom(withOwner(tx => tx.execute(
        sql`insert into public.tenant_host (host, id_tenant) values (${host()}, ${target})`)))
      expect(failure.codes).toContain('P0001')
      expect(failure.text).toContain('host_not_allowed')
    }
    // Neppure spostando un indirizzo esistente.
    const moved = host()
    await withOwner(tx => tx.execute(sql`insert into public.tenant_host (host, id_tenant) values (${moved}, ${created})`))
    const failure = await failureFrom(withOwner(tx => tx.execute(
      sql`update public.tenant_host set id_tenant = ${DEFAULT} where host = ${moved}`)))
    expect(failure.text).toContain('host_not_allowed')
    expect(await hostsOf(DEFAULT)).toEqual([])
    expect(await hostsOf(template)).toEqual([])
  }, 15_000)

  it('allows at most one primary host per tenant', async () => {
    const first = host()
    await withOwner(tx => tx.execute(
      sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${first}, ${created}, true)`))
    const failure = await failureFrom(withOwner(tx => tx.execute(
      sql`insert into public.tenant_host (host, id_tenant, is_primary) values (${host()}, ${created}, true)`)))
    expect(failure.codes).toContain('23505')
    expect(failure.text).toContain('tenant_host_single_primary')
    expect((await hostsOf(created)).filter(row => row.is_primary)).toEqual([{ host: first, is_primary: true }])
  }, 15_000)

  it('the runtime role cannot write tenant_host', async () => {
    const before = await hostsOf(created)
    const inserted = await failureFrom(withGlobal(tx => tx.execute(
      sql`insert into public.tenant_host (host, id_tenant) values (${host()}, ${created})`)))
    expect(inserted.codes).toContain('42501')
    const deleted = await failureFrom(withTenant(created, tx => tx.execute(
      sql`delete from public.tenant_host where id_tenant = ${created}`)))
    expect(deleted.codes).toContain('42501')
    // Leggere sì: il registro serve a riconoscere l'indirizzo prima di conoscere il tenant.
    const read = await withGlobal(tx => tx.execute<{ host: string }>(
      sql`select host from public.tenant_host where id_tenant = ${created} order by host`))
    expect(read.map(row => row.host)).toEqual(before.map(row => row.host))
  }, 15_000)

  it('tenant_settings: default accepts self registration, template does not', async () => {
    expect(await selfRegistrationOf(DEFAULT)).toEqual([true])
    expect(await selfRegistrationOf(template)).toEqual([false])
    // Tabella di tenant: senza tenant non si legge.
    const failure = await failureFrom(withGlobal(tx => tx.execute(sql`select * from public.tenant_settings`)))
    expect(failure.text).toContain('tenant context missing')
  })

  it('a tenant created from the template starts with self registration off', async () => {
    expect(await selfRegistrationOf(created)).toEqual([false])
    // L'amministratore del tenant lo accende con il ruolo dell'app, solo nel suo tenant.
    await withTenant(created, tx => tx.execute(sql`update public.tenant_settings set self_registration = true`))
    expect(await selfRegistrationOf(created)).toEqual([true])
    expect(await selfRegistrationOf(template)).toEqual([false])
  })

  it('the TENANT_ADMIN role has manage-tenant-settings in default and template', async () => {
    for (const target of [DEFAULT, template, created]) {
      const rows = await withTenant(target, tx => tx.execute<{ system_key: string }>(sql`
        select r.system_key
        from public.role_permission rp
        join public.role r on r.id_role = rp.id_role
        join public.permission p on p.id_permission = rp.id_permission
        where p.code = 'manage-tenant-settings'
        order by r.system_key
      `))
      expect(rows.map(row => row.system_key), String(target)).toEqual(['TENANT_ADMIN'])
    }
  })

  it('users.last_tenant_id points to a tenant and is cleared when the tenant goes', async () => {
    // Tutto in una transazione che si annulla: niente resta nel database di prova.
    const rollback = new Error('rollback')
    let cleared: (string | null)[] = []
    await expect(withOwner(async tx => {
      const [bare] = await tx.execute<{ id: string }>(
        sql`insert into public.tenant (slug, name) values (${`zzz-last-${unique()}`.slice(0, 40)}, 'Ultimo') returning id::text as id`)
      const email = `zzz_last_${unique()}@example.test`
      await tx.execute(sql`insert into public.users (email, last_tenant_id) values (${email}, ${bare.id}::bigint)`)
      await tx.execute(sql`delete from public.tenant where id = ${bare.id}::bigint`)
      const rows = await tx.execute<{ last_tenant_id: string | null }>(
        sql`select last_tenant_id::text from public.users where email = ${email}`)
      cleared = rows.map(row => row.last_tenant_id)
      throw rollback
    })).rejects.toBe(rollback)
    expect(cleared).toEqual([null])
  })
})
