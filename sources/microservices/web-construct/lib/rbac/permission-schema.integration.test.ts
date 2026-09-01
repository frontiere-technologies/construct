import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permission, role, roleListView, rolePermission } from '@/lib/db/schema'
import { ITEM_TYPE_CATEGORY } from './types'

/** Il rename è riuscito solo se i nomi vecchi sono spariti: una vista o una
 *  funzione lasciata indietro punterebbe ancora là e fallirebbe a runtime, non qui. */
async function tableExists(name: string): Promise<boolean> {
  const rows = await db.execute(
    sql`select 1 from information_schema.tables where table_schema = 'public' and table_name = ${name}`,
  )
  return rows.length > 0
}

describe('rename delle tabelle RBAC', () => {
  it('espone permission e role_permission, e non più i nomi vecchi', async () => {
    expect(await tableExists('permission')).toBe(true)
    expect(await tableExists('role_permission')).toBe(true)
    expect(await tableExists('navigation_item')).toBe(false)
    expect(await tableExists('role_item')).toBe(false)
  })

  it('rinomina la chiave primaria in id_permission su entrambe', async () => {
    const rows = await db.execute(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('permission', 'role_permission')
        and column_name = 'id_permission'
      order by table_name
    `)
    expect(rows.map(r => r.table_name)).toEqual(['permission', 'role_permission'])
  })

  it('conserva privilegi e policy RLS che il rename non deve perdere', async () => {
    const grants = await db.execute(sql`
      select table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'construct_runtime'
        and table_name in ('permission', 'role_permission')
      group by table_name order by table_name
    `)
    expect(grants.map(r => r.table_name)).toEqual(['permission', 'role_permission'])
  })

  it('mantiene eseguibile apply_role_permission_deltas dopo il rename', async () => {
    const rows = await db.execute(sql`
      select 1 from pg_proc where proname = 'apply_role_permission_deltas'
    `)
    expect(rows.length).toBe(1)
  })

  /** has_permissions e' "esiste una riga qualunque", non "esiste una riga autorizzata": una
   *  bozza precedente della migrazione aveva aggiunto `and rp.authorized`, che avrebbe cambiato
   *  questa semantica in silenzio. Il rename da solo non deve toccarla. */
  it('has_permissions resta vero anche quando l\'unica riga di role_permission non è autorizzata', async () => {
    const [createdRole] = await db.insert(role)
      .values({ description: 'zzz_rbac_rename_test_role' })
      .returning({ idRole: role.idRole })
    const [createdPermission] = await db.insert(permission)
      .values({ name: 'zzz_rbac_rename_test_permission', idItemType: ITEM_TYPE_CATEGORY })
      .returning({ idPermission: permission.idPermission })
    try {
      await db.insert(rolePermission).values({
        idRole: createdRole.idRole,
        idPermission: createdPermission.idPermission,
        authorized: false,
      })
      const [row] = await db.select({ hasPermissions: roleListView.hasPermissions })
        .from(roleListView)
        .where(eq(roleListView.id, createdRole.idRole))
      expect(row?.hasPermissions).toBe(true)
    } finally {
      await db.delete(rolePermission).where(eq(rolePermission.idRole, createdRole.idRole))
      await db.delete(permission).where(eq(permission.idPermission, createdPermission.idPermission))
      await db.delete(role).where(eq(role.idRole, createdRole.idRole))
    }
  })
})
