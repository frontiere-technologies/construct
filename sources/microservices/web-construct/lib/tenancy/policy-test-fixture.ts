/** Fixture dei soli test: non importare dal codice applicativo. */
import { inArray, sql } from 'drizzle-orm'
import { menuEntry, users } from '@/lib/db/schema'
import { withOwner, deleteTenantForTest } from '@/lib/db/testing'
import { unique } from '@/lib/i18n/test-support/db-fixtures'
import { tenantIdForTest } from './testing'
import type { TenantId } from './tenant-id'

export interface PolicyFixture {
  tenantId: TenantId
  slug: string
  adminId: string
  memberId: string
  platformAdminId: string
  roleId: number
  menuEntryId: number
  close(): Promise<void>
}

export async function createPolicyFixture(label: string): Promise<PolicyFixture> {
  const slug = `zzz-policy-${label.replace(/[^a-z0-9-]/g, '').slice(0, 10)}-${unique()}`
  const ids: string[] = []
  let tenantId: TenantId | undefined
  const close = async () => {
    if (tenantId !== undefined) await deleteTenantForTest(tenantId)
    if (ids.length) await withOwner(tx => tx.delete(users).where(inArray(users.id, ids)))
  }
  try {
    const [created] = await withOwner(tx => tx.execute<{ id: string }>(
      sql`select app_private.create_tenant_from_template(${slug}, ${label})::text as id`))
    tenantId = tenantIdForTest(Number(created.id))
    const data = await withOwner(async tx => {
      const people = await tx.insert(users).values([
        { email: `${slug}-admin@example.test`, idUserStatus: 2 },
        { email: `${slug}-member@example.test`, idUserStatus: 2 },
        { email: `${slug}-platform@example.test`, idUserStatus: 2, isPlatformAdmin: true },
      ]).returning({ id: users.id })
      ids.push(...people.map(person => person.id))
      const [admin, member, platformAdmin] = people
      await tx.execute(sql`insert into public.tenant_membership (user_id) values (${admin.id}), (${member.id})`)
      await tx.execute(sql`insert into public.user_role (user_id, id_role)
        select p.id::uuid, r.id_role from (values (${admin.id}), (${member.id})) p(id)
        cross join public.role r where r.system_key = 'REGISTERED'
          or (p.id::uuid = ${admin.id}::uuid and r.system_key = 'TENANT_ADMIN')`)
      const [role] = await tx.execute<{ id: number }>(sql`insert into public.role (id_role_type, description)
        values (2, ${slug}) returning id_role::int as id`)
      const [menu] = await tx.insert(menuEntry).values({
        name: slug, idFunctionalityType: 3, functionalityLink: '/user-management', orderPosition: 0, isImmutable: 0,
      }).returning({ id: menuEntry.idMenuEntry })
      return { adminId: admin.id, memberId: member.id, platformAdminId: platformAdmin.id, roleId: role.id, menuEntryId: menu.id }
    }, tenantId)
    return { tenantId, slug, ...data, close }
  } catch (error) {
    await close()
    throw error
  }
}
