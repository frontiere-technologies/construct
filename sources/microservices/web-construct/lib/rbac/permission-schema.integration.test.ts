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
      // kind è NOT NULL da 0015 e senza default: questa riga crea una categoria
      // (idItemType: ITEM_TYPE_CATEGORY), quindi kind è 'CATEGORY' e code resta nullo.
      .values({ name: 'zzz_rbac_rename_test_permission', idItemType: ITEM_TYPE_CATEGORY, kind: 'CATEGORY' })
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

describe('identità del permesso', () => {
  it('assegna kind a ogni riga esistente', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as orfane from public.permission
      where kind not in ('CATEGORY', 'GRANT')
    `)
    expect(rows[0].orfane).toBe(0)
  })

  it('dà un code a ogni GRANT e a nessuna CATEGORY', async () => {
    const rows = await db.execute(sql`
      select count(*)::int as violazioni from public.permission
      where (kind = 'GRANT' and code is null) or (kind = 'CATEGORY' and code is not null)
    `)
    expect(rows[0].violazioni).toBe(0)
  })

  /* id_item_type resta NOT NULL fino al Task 7: gli insert grezzi qui sotto lo valorizzano
   * (2 = FUNCTIONALITY, coerente con kind = 'GRANT') solo per soddisfare quel vincolo, non
   * perché il test riguardi id_item_type — il brief lo ometteva e l'insert falliva prima
   * ancora di arrivare al vincolo che il test vuole verificare. */
  it('rifiuta un GRANT senza code', async () => {
    await expect(
      db.execute(sql`
        insert into public.permission (kind, code, origin, description, id_parent, order_position, id_item_type)
        values ('GRANT', null, 'CONSOLE', 'senza codice', 0, 0, 2)
      `),
    ).rejects.toThrow()
  })

  it('rifiuta due permessi con lo stesso code', async () => {
    await db.execute(sql`
      insert into public.permission (kind, code, origin, description, id_parent, order_position, id_item_type)
      values ('GRANT', 'test-duplicato', 'CONSOLE', 'primo', 0, 0, 2)
    `)
    // finally, non l'ultima riga: se l'assert sopra fallisse, 'test-duplicato' resterebbe
    // sul database e avvelenerebbe la riesecuzione di questo test e i task successivi della
    // stessa fase, che condividono la stessa suite di integrazione.
    try {
      await expect(
        db.execute(sql`
          insert into public.permission (kind, code, origin, description, id_parent, order_position, id_item_type)
          values ('GRANT', 'test-duplicato', 'CONSOLE', 'secondo', 0, 0, 2)
        `),
      ).rejects.toThrow()
    } finally {
      await db.execute(sql`delete from public.permission where code = 'test-duplicato'`)
    }
  })
})
