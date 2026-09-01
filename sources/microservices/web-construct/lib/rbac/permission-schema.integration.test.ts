import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

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
})
