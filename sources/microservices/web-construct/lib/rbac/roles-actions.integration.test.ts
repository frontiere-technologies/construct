import { afterEach, expect, it, vi } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permission, role, rolePermission } from '@/lib/db/schema'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'

vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: async () => ({ userId: 'test', roleIds: [1] }) }))

const { updateRolePermissions } = await import('./roles-actions')

const PREFIX = 'zzz_roles_actions_tx_'
const ROLE_TYPE_SERVICE = 2
let sequence = 0
const name = () => `${PREFIX}${sequence++}`

async function makeServiceRole(): Promise<number> {
  const [created] = await db.insert(role).values({ description: name(), idRoleType: ROLE_TYPE_SERVICE }).returning({ idRole: role.idRole })
  return created.idRole
}

async function makePermission(kind: 'CATEGORY' | 'GRANT'): Promise<number> {
  const [created] = await db
    .insert(permission)
    .values({ name: name(), kind, origin: 'CONSOLE' })
    .returning({ idPermission: permission.idPermission })
  return created.idPermission
}

describeIntegration('updateRolePermissions against the database', () => {
  afterEach(async () => {
    // role_permission cascata via id_role -> role (db-fixtures.ts); il permesso invece resta
    // finché non lo si cancella esplicitamente qui.
    await db.delete(role).where(like(role.description, `${PREFIX}%`))
    await db.delete(permission).where(like(permission.name, `${PREFIX}%`))
  })

  // IMP-2 (revisione Task 6): senza questo presidio lato server, un delta verso una categoria
  // scriverebbe di nuovo il residuo che la migrazione 0020 ha appena ripulito — l'unica cosa a
  // impedirlo prima era la buona educazione del chiamante (buildAuthMap/applyToggle), la stessa
  // classe di errore che ha prodotto HOLE-5.
  it('rifiuta l\'intera chiamata quando un delta punta a un permesso di tipo CATEGORY, e non scrive nulla', async () => {
    const roleId = await makeServiceRole()
    const categoryId = await makePermission('CATEGORY')
    const grantId = await makePermission('GRANT')

    await expect(updateRolePermissions(roleId, [
      { idItem: categoryId, authorization: true },
      { idItem: grantId, authorization: true },
    ])).rejects.toThrow(/category permission/)

    // Rifiuto = niente scritto, nemmeno il delta valido nello stesso lotto (tutto o niente).
    const rows = await db.select().from(rolePermission).where(eq(rolePermission.idRole, roleId))
    expect(rows).toHaveLength(0)
  })

  it('rifiuta anche una revoca verso una categoria, non solo una concessione', async () => {
    const roleId = await makeServiceRole()
    const categoryId = await makePermission('CATEGORY')

    await expect(updateRolePermissions(roleId, [
      { idItem: categoryId, authorization: false },
    ])).rejects.toThrow(/category permission/)
  })

  it('lascia passare un lotto di soli permessi GRANT', async () => {
    const roleId = await makeServiceRole()
    const grantId = await makePermission('GRANT')

    await updateRolePermissions(roleId, [{ idItem: grantId, authorization: true }])

    const rows = await db.select().from(rolePermission).where(eq(rolePermission.idRole, roleId))
    expect(rows.map(r => r.idPermission)).toEqual([grantId])
  })
})
