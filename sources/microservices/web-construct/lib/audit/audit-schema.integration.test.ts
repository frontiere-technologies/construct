import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { tenant } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'

/**
 * Il fondamento del pezzo 5a (specifica 2026-10-26, §2.1, §2.3, §2.4, MT5-DEC-1, 10, 14, 15, 23;
 * migrazione 0057): l'attributo di amministratore di piattaforma, i due registri (del tenant e
 * della piattaforma), il permesso di assistenza e il permesso `read-tenant-audit`. Un tenant nato
 * dal modello in beforeAll serve ai test che hanno bisogno di un secondo tenant; sparisce in
 * afterAll.
 */
const DEFAULT = defaultTestTenant()

let template: TenantId
let other: TenantId
let copy: TenantId
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

/** Gli indirizzi dei fixture di utente: spariscono in afterAll, comunque vadano i test. */
const createdEmails: string[] = []
function trackedEmail(kind: string): string {
  const email = `zzz-${kind}-${unique()}@example.test`
  createdEmails.push(email)
  return email
}

function slug(): string {
  return `zzz-audit-${unique()}`.slice(0, 40)
}

/** Una copia dal modello, fatta come construct_owner (il ruolo dell'app non crea tenant). */
async function createCopy(): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${slug()}, 'Registro di prova')::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  return id
}

async function auditCount(tenantId: TenantId): Promise<number> {
  const rows = await withOwner(tx => tx.execute<{ n: number }>(
    sql`select count(*)::int as n from public.tenant_audit_event`), tenantId)
  return rows[0].n
}

/** I permessi del ruolo TENANT_ADMIN del tenant, per codice. */
async function adminPermissionCodes(tenantId: TenantId): Promise<string[]> {
  const rows = await withTenant(tenantId, tx => tx.execute<{ code: string }>(sql`
    select p.code
    from public.role r
    join public.role_permission rp on rp.id_tenant = r.id_tenant and rp.id_role = r.id_role
    join public.permission p on p.id_permission = rp.id_permission
    where r.system_key = 'TENANT_ADMIN' and p.code = 'read-tenant-audit'
  `))
  return rows.map(row => row.code)
}

describeIntegration('audit tables, platform admin and support consent', () => {
  beforeAll(async () => {
    const [found] = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, 'template')))
    if (!found) throw new Error('template tenant missing: is migration 0050 applied?')
    template = tenantIdForTest(found.id)
    other = await createCopy()
    copy = await createCopy()
  }, 60_000)

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
    try { await closeOwner() } catch (error) { errors.push(error) }
    if (errors.length > 0) throw errors[0]
  }, 30_000)

  it('the runtime role can insert and select tenant_audit_event but never update or delete it', async () => {
    const marker = `zzz-op-${unique()}`
    await withTenant(other, tx => tx.execute(sql`
      insert into public.tenant_audit_event (actor_kind, operation, details)
      values ('person', ${marker}, '{"after":"x"}'::jsonb)`))
    const rows = await withTenant(other, tx => tx.execute<{ operation: string; id_tenant: string; actor_kind: string }>(sql`
      select operation, id_tenant::text as id_tenant, actor_kind from public.tenant_audit_event where operation = ${marker}`))
    expect(rows).toEqual([{ operation: marker, id_tenant: String(other), actor_kind: 'person' }])

    const update = await failureFrom(withTenant(other, tx => tx.execute(sql`
      update public.tenant_audit_event set operation = 'changed' where operation = ${marker}`)))
    expect(update.codes).toContain('42501')
    const remove = await failureFrom(withTenant(other, tx => tx.execute(sql`
      delete from public.tenant_audit_event where operation = ${marker}`)))
    expect(remove.codes).toContain('42501')
    const truncate = await failureFrom(withTenant(other, tx => tx.execute(sql`
      truncate public.tenant_audit_event`)))
    expect(truncate.codes).toContain('42501')

    // La riga è ancora lì, intatta.
    const still = await withTenant(other, tx => tx.execute<{ operation: string }>(sql`
      select operation from public.tenant_audit_event where operation = ${marker}`))
    expect(still).toHaveLength(1)
  }, 30_000)

  it('refuses an audit entry with a manner other than person, platform or command', async () => {
    const failure = await failureFrom(withTenant(other, tx => tx.execute(sql`
      insert into public.tenant_audit_event (actor_kind, operation) values ('robot', 'x')`)))
    expect(failure.codes).toContain('23514')
  })

  it('the runtime role can insert platform_audit_event but cannot read, update or delete it', async () => {
    const marker = `zzz-op-${unique()}`
    await withGlobal(tx => tx.execute(sql`
      insert into public.platform_audit_event (actor_kind, operation) values ('platform', ${marker})`))
    // Nemmeno con id_tenant: facoltativo, ma se c'è è un tenant vero.
    await withGlobal(tx => tx.execute(sql`
      insert into public.platform_audit_event (id_tenant, actor_kind, operation) values (${other}, 'platform', ${marker})`))

    for (const statement of [
      sql`select operation from public.platform_audit_event`,
      sql`update public.platform_audit_event set operation = 'changed' where operation = ${marker}`,
      sql`delete from public.platform_audit_event where operation = ${marker}`,
    ]) {
      const failure = await failureFrom(withGlobal(tx => tx.execute(statement)))
      expect(failure.codes).toContain('42501')
    }

    // Il proprietario le legge tutte e due: la piattaforma le leggerà con la sua identità.
    const written = await withOwner(tx => tx.execute<{ id_tenant: string | null }>(sql`
      select id_tenant::text as id_tenant from public.platform_audit_event
      where operation = ${marker} order by id`))
    expect(written).toEqual([{ id_tenant: null }, { id_tenant: String(other) }])
    await withOwner(tx => tx.execute(sql`delete from public.platform_audit_event where operation = ${marker}`))
  }, 30_000)

  it('refuses a platform audit entry for a tenant that does not exist', async () => {
    const failure = await failureFrom(withGlobal(tx => tx.execute(sql`
      insert into public.platform_audit_event (id_tenant, actor_kind, operation)
      values (999999999, 'command', 'x')`)))
    expect(failure.codes).toContain('23503')
  })

  it('tenant_audit_event rows of B are invisible from A', async () => {
    const marker = `zzz-op-${unique()}`
    await withTenant(other, tx => tx.execute(sql`
      insert into public.tenant_audit_event (actor_kind, operation) values ('person', ${marker})`))
    const fromA = await withTenant(DEFAULT, tx => tx.execute<{ operation: string }>(sql`
      select operation from public.tenant_audit_event where operation = ${marker}`))
    expect(fromA).toEqual([])
    const fromB = await withTenant(other, tx => tx.execute<{ operation: string }>(sql`
      select operation from public.tenant_audit_event where operation = ${marker}`))
    expect(fromB).toHaveLength(1)

    // Scrivere con l'id_tenant di un altro è rifiutato dal confine di tenant.
    const failure = await failureFrom(withTenant(DEFAULT, tx => tx.execute(sql`
      insert into public.tenant_audit_event (id_tenant, actor_kind, operation) values (${other}, 'person', 'x')`)))
    expect(failure.codes).toContain('42501')
  }, 30_000)

  it('a tenant created from the template has no audit rows and the template audit stays untouched', async () => {
    const marker = `zzz-op-${unique()}`
    await withOwner(tx => tx.execute(sql`
      insert into public.tenant_audit_event (actor_kind, operation) values ('platform', ${marker})`), template)
    try {
      const templateBefore = await auditCount(template)
      expect(templateBefore).toBeGreaterThan(0)

      const fresh = await createCopy()
      expect(await auditCount(fresh)).toBe(0)
      expect(await auditCount(template)).toBe(templateBefore)
    } finally {
      await withOwner(tx => tx.execute(sql`
        delete from public.tenant_audit_event where operation = ${marker}`), template)
    }
  }, 60_000)

  it('ensure_default_membership creates nothing for a platform admin', async () => {
    const adminEmail = trackedEmail('platform')
    const [admin] = await withOwner(tx => tx.execute<{ id: string }>(sql`
      insert into public.users (email, is_platform_admin) values (${adminEmail}, true) returning id::text as id`))
    const rollback = new Error('rollback')
    let outcome: { admin: string | null; adminMemberships: number; control: string | null } | null = null
    try {
      await withTenant(DEFAULT, async tx => {
        // Il predefinito accetta le registrazioni autonome solo se l'interruttore è acceso: lo si
        // accende nella transazione, che poi si annulla.
        await tx.execute(sql`update public.tenant_settings set self_registration = true`)
        const [control] = await tx.execute<{ id: string }>(sql`
          insert into public.users (email) values (${trackedEmail('control')}) returning id::text as id`)
        const [adminResult] = await tx.execute<{ status: string | null }>(sql`
          select public.ensure_default_membership(${admin.id}::uuid) as status`)
        const [controlResult] = await tx.execute<{ status: string | null }>(sql`
          select public.ensure_default_membership(${control.id}::uuid) as status`)
        const [memberships] = await tx.execute<{ n: number }>(sql`
          select count(*)::int as n from public.tenant_membership where user_id = ${admin.id}::uuid`)
        outcome = { admin: adminResult.status, adminMemberships: memberships.n, control: controlResult.status }
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
    // Il controllo prova che l'interruttore acceso fa entrare una persona qualunque: senza di lui
    // il null dell'amministratore non direbbe niente.
    expect(outcome).toEqual({ admin: null, adminMemberships: 0, control: 'active' })
  }, 30_000)

  it('ensure_default_membership still returns the status of a platform admin who is already a member', async () => {
    const [admin] = await withOwner(tx => tx.execute<{ id: string }>(sql`
      insert into public.users (email, is_platform_admin) values (${trackedEmail('member')}, true) returning id::text as id`))
    const rollback = new Error('rollback')
    const statuses: (string | null)[] = []
    try {
      await withTenant(DEFAULT, async tx => {
        // Anche con le registrazioni spente: chi è già membro riceve il suo stato, qualunque
        // sia l'interruttore (come prima della 0057).
        await tx.execute(sql`update public.tenant_settings set self_registration = false`)
        await tx.execute(sql`
          insert into public.tenant_membership (user_id, status) values (${admin.id}::uuid, 'active')`)
        const [active] = await tx.execute<{ status: string | null }>(sql`
          select public.ensure_default_membership(${admin.id}::uuid) as status`)
        statuses.push(active.status)
        await tx.execute(sql`
          update public.tenant_membership set status = 'deactivated' where user_id = ${admin.id}::uuid`)
        const [deactivated] = await tx.execute<{ status: string | null }>(sql`
          select public.ensure_default_membership(${admin.id}::uuid) as status`)
        statuses.push(deactivated.status)
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
    expect(statuses).toEqual(['active', 'deactivated'])
  }, 30_000)

  it('the runtime role cannot create a user who is a platform admin', async () => {
    const failure = await failureFrom(withGlobal(tx => tx.execute(sql`
      insert into public.users (email, is_platform_admin) values (${trackedEmail('mass')}, true)`)))
    expect(failure.codes).toContain('42501')
    expect(failure.text).toContain('is_platform_admin')
  })

  it('the runtime role cannot set or clear the platform admin flag of an existing user', async () => {
    const plainEmail = trackedEmail('plain')
    const adminEmail = trackedEmail('admin')
    await withGlobal(tx => tx.execute(sql`insert into public.users (email) values (${plainEmail})`))
    await withOwner(tx => tx.execute(sql`insert into public.users (email, is_platform_admin) values (${adminEmail}, true)`))

    const grant = await failureFrom(withGlobal(tx => tx.execute(sql`
      update public.users set is_platform_admin = true where email = ${plainEmail}`)))
    expect(grant.codes).toContain('42501')
    const revoke = await failureFrom(withGlobal(tx => tx.execute(sql`
      update public.users set is_platform_admin = false where email = ${adminEmail}`)))
    expect(revoke.codes).toContain('42501')

    const flags = await withOwner(tx => tx.execute<{ email: string; is_platform_admin: boolean }>(sql`
      select email, is_platform_admin from public.users where email in (${plainEmail}, ${adminEmail}) order by email`))
    expect(flags.map(row => [row.email === plainEmail, row.is_platform_admin]).sort()).toEqual([[false, true], [true, false]])
  }, 30_000)

  it('the runtime role can still insert and update users, flag untouched or restated', async () => {
    const email = trackedEmail('normal')
    await withGlobal(tx => tx.execute(sql`insert into public.users (email, name) values (${email}, 'Prima')`))
    await withGlobal(tx => tx.execute(sql`update public.users set name = 'Dopo' where email = ${email}`))
    // Drizzle riscrive ogni colonna: lo stesso valore non è un cambio.
    await withGlobal(tx => tx.execute(sql`
      update public.users set name = 'Ancora', is_platform_admin = false where email = ${email}`))
    const rows = await withOwner(tx => tx.execute<{ name: string; is_platform_admin: boolean }>(sql`
      select name, is_platform_admin from public.users where email = ${email}`))
    expect(rows).toEqual([{ name: 'Ancora', is_platform_admin: false }])
  })

  it('construct_owner can set and clear the platform admin flag', async () => {
    const email = trackedEmail('owner')
    await withOwner(tx => tx.execute(sql`insert into public.users (email) values (${email})`))
    const read = () => withOwner(tx => tx.execute<{ is_platform_admin: boolean }>(sql`
      select is_platform_admin from public.users where email = ${email}`))
    await withOwner(tx => tx.execute(sql`update public.users set is_platform_admin = true where email = ${email}`))
    expect(await read()).toEqual([{ is_platform_admin: true }])
    await withOwner(tx => tx.execute(sql`update public.users set is_platform_admin = false where email = ${email}`))
    expect(await read()).toEqual([{ is_platform_admin: false }])
  })

  it('gives the runtime role no privilege at all on the audit identity sequences', async () => {
    const rows = await withGlobal(tx => tx.execute<{ name: string; any_privilege: boolean }>(sql`
      select s.name, has_sequence_privilege('construct_runtime', pg_get_serial_sequence(s.name, 'id'), 'usage,select,update') as any_privilege
      from unnest(array['public.tenant_audit_event', 'public.platform_audit_event']) as s(name)`))
    expect(rows.map(row => row.any_privilege)).toEqual([false, false])
  })

  it('has no platform admin by default and stores the attribute on users', async () => {
    const rollback = new Error('rollback')
    let flag: boolean | null = null
    try {
      await withGlobal(async tx => {
        const [row] = await tx.execute<{ is_platform_admin: boolean }>(sql`
          insert into public.users (email) values (${`zzz-flag-${unique()}@example.test`}) returning is_platform_admin`)
        flag = row.is_platform_admin
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
    expect(flag).toBe(false)
  })

  it('keeps the support consent on tenant_settings, empty until the tenant grants it', async () => {
    const rows = await withTenant(copy, tx => tx.execute<{
      support_until: string | null
      support_granted_by: string | null
      support_granted_at: string | null
    }>(sql`select support_until, support_granted_by, support_granted_at from public.tenant_settings`))
    expect(rows).toEqual([{ support_until: null, support_granted_by: null, support_granted_at: null }])
  })

  it('TENANT_ADMIN holds read-tenant-audit in default, template and a fresh copy', async () => {
    expect(await adminPermissionCodes(DEFAULT)).toEqual(['read-tenant-audit'])
    expect(await adminPermissionCodes(template)).toEqual(['read-tenant-audit'])
    expect(await adminPermissionCodes(copy)).toEqual(['read-tenant-audit'])
  })

  it('does not give read-tenant-audit to the REGISTERED role', async () => {
    const rows = await withTenant(copy, tx => tx.execute<{ code: string }>(sql`
      select p.code
      from public.role r
      join public.role_permission rp on rp.id_tenant = r.id_tenant and rp.id_role = r.id_role
      join public.permission p on p.id_permission = rp.id_permission
      where r.system_key = 'REGISTERED' and p.code = 'read-tenant-audit'`))
    expect(rows).toEqual([])
  })

  // La voce di menu «Registro» (0062, MT5-DEC-16): righe di tenant, quindi in ogni tenant.
  it('has the Audit log menu entry in default, template and a fresh copy, granted to TENANT_ADMIN only, next to the tenant settings', async () => {
    for (const tenantId of [DEFAULT, template, copy, other]) {
      const rows = await withTenant(tenantId, tx => tx.execute<{ name: string; id_parent: string | null; order_position: number; roles: string[]; settings_order: number }>(sql`
        select m.name, m.id_parent::text as id_parent, m.order_position,
          coalesce(array_agg(distinct r.system_key) filter (where r.id_role is not null), '{}') as roles,
          (select s.order_position from public.menu_entry s where s.functionality_link = 'admin/tenant-settings' and s.id_parent is not distinct from m.id_parent) as settings_order
        from public.menu_entry m
        left join public.role_functionality rf on rf.id_tenant = m.id_tenant and rf.id_menu_entry = m.id_menu_entry
        left join public.role r on r.id_tenant = rf.id_tenant and r.id_role = rf.id_role
        where m.functionality_link = 'admin/audit'
        group by m.id_menu_entry`))
      expect(rows, String(tenantId)).toHaveLength(1)
      expect(rows[0].roles, String(tenantId)).toEqual(['TENANT_ADMIN'])
      expect(rows[0].order_position, String(tenantId)).toBe(rows[0].settings_order + 1)
    }
  })
})
