import { afterEach, expect, it, vi } from 'vitest'
import { eq, like } from 'drizzle-orm'
import postgres from 'postgres'
import { db } from '@/lib/db'
import { permission } from '@/lib/db/schema'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import type { CreateNavItemInput } from './types'

vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: async () => ({ userId: 'test', roleIds: [1] }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { createNavigationItem, deleteNavigationItem, moveNavigationItem, updateNavigationItem } = await import('./navigation-actions')

const PREFIX = 'zzz_navigation_tx_'
let sequence = 0
const input = (name: string, tag = 'safe'): CreateNavItemInput => ({
  name,
  idItemType: 1,
  idFunctionalityType: null,
  functionalityLink: null,
  iconPath: null,
  idItemParent: 0,
  description: '',
  itemTranslation: { EN: { name } },
  tagTranslations: { EN: [tag] },
})

describeIntegration('navigation mutations against the database', () => {
  afterEach(async () => {
    await db.delete(permission).where(like(permission.name, `${PREFIX}%`))
  })

  it('rolls back item creation when tag replacement fails', async () => {
    const name = `${PREFIX}${sequence++}`
    await expect(createNavigationItem(input(name, 'x'.repeat(51)))).rejects.toThrow()
    expect(await db.select().from(permission).where(eq(permission.name, name))).toHaveLength(0)
  })

  it('rolls back field and parent changes when an update tag write fails', async () => {
    const original = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(input(original))
    await expect(updateNavigationItem(id, input(`${PREFIX}changed`, 'x'.repeat(51)))).rejects.toThrow()
    const [row] = await db.select().from(permission).where(eq(permission.idPermission, id))
    expect(row.name).toBe(original)
    expect(row.idParent).toBe(0)
  })

  it('serializes concurrent reorders into unique deterministic positions', async () => {
    const ids = await Promise.all([
      createNavigationItem(input(`${PREFIX}${sequence++}`)),
      createNavigationItem(input(`${PREFIX}${sequence++}`)),
      createNavigationItem(input(`${PREFIX}${sequence++}`)),
    ])
    await Promise.all(ids.map(({ id }, index) => moveNavigationItem(id, { targetParentId: 0, orderPosition: 2 - index })))
    const rows = await db.select({ position: permission.orderPosition })
      .from(permission)
      .where(like(permission.name, `${PREFIX}%`))
    expect(new Set(rows.map(row => row.position)).size).toBe(rows.length)
  })

  it('serializes subtree deletion with every other navigation write', async () => {
    const { id } = await createNavigationItem(input(`${PREFIX}${sequence++}`))
    const sql = postgres(process.env.TEST_DATABASE_URL!, { prepare: false, max: 1 })
    const connection = await sql.reserve()
    try {
      await connection`select pg_advisory_lock(49374201)`
      let completed = false
      const deleting = deleteNavigationItem(id).then(() => { completed = true })
      await new Promise(resolve => setTimeout(resolve, 75))
      expect(completed).toBe(false)
      await connection`select pg_advisory_unlock(49374201)`
      await deleting
      expect(await db.select().from(permission).where(eq(permission.idPermission, id))).toHaveLength(0)
    } finally {
      connection.release()
      await sql.end({ timeout: 5 })
    }
  })
})
