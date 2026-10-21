import { afterEach, expect, it } from 'vitest'
import { like } from 'drizzle-orm'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { role, tenantMembership, userRole, users } from '@/lib/db/schema'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import { USER_STATUS_ACTIVE } from './types'
import { getNavigationItem, getNavigationSubtree, getParentList } from './functionalities-service'
import { getNavigationItemById, getSidebarMenu } from './navigation-service'
import { getAllRoles, getRole, getRoleAuthorizationTree, listRoles, countRoles } from './roles-service'
import { countUsers, listUsers } from './users-service'

const PREFIX = 'zzz_loaders_'
const ROLE_TYPE_SERVICE = 2
const tenant = defaultTestTenant()

// I caricamenti chiamati da pagine e rotte aprono da soli la propria transazione: qui si
// verifica che con il tenant predefinito leggano ciò che leggevano con `db`.
describeIntegration('RBAC loaders through withTenant', () => {
  afterEach(async () => {
    await withGlobal(tx => tx.delete(users).where(like(users.email, `${PREFIX}%`)))
    await withTenant(tenant, tx => tx.delete(role).where(like(role.description, `${PREFIX}%`)))
  })

  async function makeRoleWithUser(): Promise<{ idRole: number; userId: string; description: string }> {
    const description = `${PREFIX}${unique()}`
    const [created] = await withTenant(tenant, tx => tx.insert(role)
      .values({ description, idRoleType: ROLE_TYPE_SERVICE })
      .returning({ idRole: role.idRole }))
    const [user] = await withGlobal(tx => tx.insert(users)
      .values({ email: `${PREFIX}${unique()}@example.test`, idUserStatus: USER_STATUS_ACTIVE })
      .returning({ id: users.id }))
    await withTenant(tenant, async tx => {
      // I ruoli esistono solo con l'appartenenza al tenant (0048).
      await tx.insert(tenantMembership).values({ userId: user.id })
      await tx.insert(userRole).values({ userId: user.id, idRole: created.idRole })
    })
    return { idRole: created.idRole, userId: user.id, description }
  }

  it('lists, counts, loads and names a role', async () => {
    const { idRole, description } = await makeRoleWithUser()
    const query = { page: 0, size: 50, search: description }
    const page = await listRoles(tenant, query)
    expect(page.elements.map(e => e.id)).toEqual([idRole])
    expect(page.elements[0]).toMatchObject({ description, associatedUsers: 1, roleType: 'SERVICE' })
    expect(await countRoles(tenant, query)).toBe(1)
    expect(await getRole(tenant, idRole)).toMatchObject({ id: idRole, roleName: description, associatedUsersCount: 1 })
    expect((await getAllRoles(tenant, ['SERVICE'])).map(r => r.id)).toContain(idRole)
  })

  it('rejects a role that does not exist with the same message as before', async () => {
    await expect(getRole(tenant, 999999999)).rejects.toThrow('Failed to load role: not found')
  })

  it('lists and counts users with their role names', async () => {
    const { idRole, userId, description } = await makeRoleWithUser()
    const query = { page: 0, size: 50, roleIds: [idRole] }
    const { users: found, total } = await listUsers(tenant, query)
    expect(total).toBe(1)
    expect(found.map(u => u.id)).toEqual([userId])
    expect(JSON.stringify(found[0])).toContain(description)
    expect(await countUsers(tenant, query)).toBe(1)
  })

  it('builds the authorization trees of a role', async () => {
    const { idRole } = await makeRoleWithUser()
    const trees = await getRoleAuthorizationTree(tenant, idRole)
    expect(trees.functionalities.length).toBeGreaterThan(0)
    expect(trees.operations.length).toBeGreaterThan(0)
  })

  it('reads the menu tree, one item, the parent choices and the sidebar', async () => {
    const tree = await getNavigationSubtree(tenant)
    expect(tree.length).toBeGreaterThan(0)
    const first = tree[0]
    expect(await getNavigationItem(tenant, first.id)).toMatchObject({ id: first.id })
    expect(await getNavigationItemById(tenant, first.id)).toMatchObject({ id_menu_entry: first.id })
    expect(await getNavigationItemById(tenant, 999999999)).toBeNull()
    expect((await getParentList(tenant)).length).toBeGreaterThan(0)
    // L'Amministratore del tenant vede il menu: il caricamento della barra laterale non è vuoto.
    const system = await withTenant(tenant, getSystemRoleIds)
    expect((await getSidebarMenu(tenant, [system.registered, system.tenantAdmin])).length).toBeGreaterThan(0)
  })
})
