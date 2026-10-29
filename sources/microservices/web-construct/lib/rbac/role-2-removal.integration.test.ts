import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { inArray, sql } from 'drizzle-orm'
import { users } from '@/lib/db/schema'
import { withGlobal } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'

/**
 * Via il ruolo 2 (specifica 2026-10-26, MT5-DEC-18, §2.5): il ruolo "Tenant Super Administrator",
 * senza logica dal pezzo 1, non esiste in nessun tenant né nel modello, e chi aveva solo quello
 * conserva il ruolo di base.
 *
 * La migrazione 0058 è già applicata al database di prova: il secondo e il terzo caso ricreano il
 * ruolo in un tenant di prova (la baseline lo seminava in ogni tenant) e rieseguono il testo della
 * migrazione come proprietario. Rieseguirla è innocuo: dove il ruolo non c'è non fa niente.
 */
const ROLE_2 = 'Tenant Super Administrator'
const MIGRATION = resolve(__dirname, '../../../../devops/db/migrations/0058_remove_role_2.sql')

const createdUserIds: string[] = []
const createdTenants: TenantId[] = []

async function createTenant(): Promise<TenantId> {
  const [row] = await withOwner(tx => tx.execute<{ id: string }>(
    sql`select app_private.create_tenant_from_template(${`zzz-r2-${unique()}`.slice(0, 40)}, 'ZZZ Ruolo 2')::text as id`))
  const id = tenantIdForTest(Number(row.id))
  createdTenants.push(id)
  return id
}

async function createUser(label: string): Promise<string> {
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({ email: `zzz_r2_${label}_${unique()}@example.test`, idUserStatus: 2, authProvider: 'credentials', passwordHash: null })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return row.id
}

/**
 * Il ruolo 2 come lo aveva la baseline: tipo 1, nessuna chiave di sistema, un permesso e una voce di
 * menu concessi. Se la copia dal modello ce l'ha già (prima della 0058) si usa quello.
 */
async function giveRole2(tenantId: TenantId): Promise<number> {
  return withOwner(async tx => {
    const [existing] = await tx.execute<{ id: string }>(sql`
      select id_role::text as id from public.role where system_key is null and description = ${ROLE_2}`)
    let roleId: number
    if (existing) {
      roleId = Number(existing.id)
    } else {
      const [created] = await tx.execute<{ id: string }>(sql`
        insert into public.role (id_role, id_role_type, description)
        values (nextval('public.s_id_role'), 1, ${ROLE_2}) returning id_role::text as id`)
      roleId = Number(created.id)
    }
    await tx.execute(sql`
      insert into public.role_permission (id_role, id_permission)
      select ${roleId}, p.id_permission from public.permission p order by p.id_permission limit 1
      on conflict do nothing`)
    await tx.execute(sql`
      insert into public.role_functionality (id_role, id_menu_entry)
      select ${roleId}, m.id_menu_entry from public.menu_entry m order by m.id_menu_entry limit 1
      on conflict do nothing`)
    return roleId
  }, tenantId)
}

async function addMember(tenantId: TenantId, userId: string, roleIds: number[], withRegistered: boolean): Promise<void> {
  await withOwner(async tx => {
    await tx.execute(sql`insert into public.tenant_membership (user_id, status) values (${userId}, 'active')`)
    if (withRegistered) {
      await tx.execute(sql`
        insert into public.user_role (user_id, id_role)
        select ${userId}, r.id_role from public.role r where r.system_key = 'REGISTERED'`)
    }
    for (const roleId of roleIds) {
      await tx.execute(sql`insert into public.user_role (user_id, id_role) values (${userId}, ${roleId})`)
    }
  }, tenantId)
}

async function runMigration(): Promise<void> {
  const text = readFileSync(MIGRATION, 'utf8')
  await withOwner(async tx => { await tx.execute(sql.raw(text)) })
}

async function rolesOf(tenantId: TenantId, userId: string): Promise<string[]> {
  const rows = await withOwner(tx => tx.execute<{ key: string }>(sql`
    select coalesce(r.system_key, r.description) as key
    from public.user_role ur join public.role r on r.id_tenant = ur.id_tenant and r.id_role = ur.id_role
    where ur.user_id = ${userId} order by 1`), tenantId)
  return rows.map(row => row.key)
}

async function countRole2(tenantId: TenantId): Promise<{ roles: number; grants: number; functionality: number }> {
  const [row] = await withOwner(tx => tx.execute<{ roles: number; grants: number; functionality: number }>(sql`
    select
      (select count(*)::int from public.role where system_key is null and description = ${ROLE_2}) as roles,
      (select count(*)::int from public.role_permission p
         where exists (select 1 from public.role r where r.id_role = p.id_role and r.description = ${ROLE_2})) as grants,
      (select count(*)::int from public.role_functionality f
         where exists (select 1 from public.role r where r.id_role = f.id_role and r.description = ${ROLE_2})) as functionality`),
    tenantId)
  return row
}

describeIntegration('removal of the Tenant Super Administrator role', () => {
  let tenant: TenantId
  let onlyRole2: string
  let bothRoles: string
  let adminToo: string
  let roleIdBefore: number

  beforeAll(async () => {
    tenant = await createTenant()
    onlyRole2 = await createUser('solo')
    bothRoles = await createUser('both')
    adminToo = await createUser('admin')
    roleIdBefore = await giveRole2(tenant)
  }, 60_000)

  afterAll(async () => {
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    if (createdUserIds.length > 0) await step(() => withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))))
    for (const id of createdTenants) await step(() => deleteTenantForTest(id))
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  }, 60_000)

  it('no tenant nor the template has the Tenant Super Administrator role', async () => {
    const tenants = await withOwner(tx => tx.execute<{ id: string }>(sql`select id::text as id from public.tenant order by id`))
    expect(tenants.length).toBeGreaterThan(1)
    // Il tenant di prova è fuori dal conto finché non ci si rimette mano: si controllano tutti gli altri,
    // il modello compreso. Quello di prova lo copre il caso successivo.
    for (const { id } of tenants.filter(t => !createdTenants.includes(tenantIdForTest(Number(t.id))))) {
      expect(await countRole2(tenantIdForTest(Number(id))), `tenant ${id}`).toEqual({ roles: 0, grants: 0, functionality: 0 })
    }
  })

  it('a person who had only role 2 still has the base role, and the role goes with its grants', async () => {
    await addMember(tenant, onlyRole2, [roleIdBefore], false)
    await addMember(tenant, bothRoles, [roleIdBefore], true)
    await addMember(tenant, adminToo, [roleIdBefore], true)
    await withOwner(tx => tx.execute(sql`
      insert into public.user_role (user_id, id_role)
      select ${adminToo}, r.id_role from public.role r where r.system_key = 'TENANT_ADMIN'`), tenant)

    expect(await rolesOf(tenant, onlyRole2)).toEqual(['Tenant Super Administrator'])
    const before = await countRole2(tenant)
    expect(before.roles).toBe(1)
    expect(before.grants).toBeGreaterThan(0)
    expect(before.functionality).toBeGreaterThan(0)

    await runMigration()

    expect(await countRole2(tenant)).toEqual({ roles: 0, grants: 0, functionality: 0 })
    expect(await rolesOf(tenant, onlyRole2)).toEqual(['REGISTERED'])
    expect(await rolesOf(tenant, bothRoles)).toEqual(['REGISTERED'])
    expect(await rolesOf(tenant, adminToo)).toEqual(['REGISTERED', 'TENANT_ADMIN'])
  })

  it('the migration leaves the tenant context as it found it, and running it again changes nothing', async () => {
    const context = await withOwner(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`)
      await tx.execute(sql.raw(readFileSync(MIGRATION, 'utf8')))
      const [row] = await tx.execute<{ value: string | null }>(sql`select current_setting('app.tenant_id', true) as value`)
      return row.value
    })
    expect(context === null || context === '').toBe(true)
    expect(await rolesOf(tenant, onlyRole2)).toEqual(['REGISTERED'])
  })
})
