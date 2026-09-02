import { afterEach, expect, it, vi } from 'vitest'
import { eq, like } from 'drizzle-orm'
import postgres from 'postgres'
import { db } from '@/lib/db'
import { permission, menuEntry } from '@/lib/db/schema'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import type { CreateNavItemInput } from './types'

vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: async () => ({ userId: 'test', roleIds: [1] }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { createNavigationItem, deleteNavigationItem, moveNavigationItem, updateNavigationItem } = await import('./navigation-actions')

const PREFIX = 'zzz_navigation_tx_'
let sequence = 0

const categoryInput = (name: string, tag = 'safe'): CreateNavItemInput => ({
  name,
  idItemType: 1,
  idFunctionalityType: null,
  functionalityLink: null,
  iconPath: null,
  idItemParent: null,
  description: '',
  itemTranslation: { EN: { name } },
  tagTranslations: { EN: [tag] },
})

const functionalityInput = (name: string, tag = 'safe'): CreateNavItemInput => ({
  name,
  idItemType: 2,
  idFunctionalityType: 3,
  functionalityLink: `/${name}`,
  iconPath: null,
  idItemParent: null,
  description: '',
  itemTranslation: { EN: { name } },
  tagTranslations: { EN: [tag] },
})

describeIntegration('navigation mutations against the database', () => {
  afterEach(async () => {
    // menu_entry -> permission è on delete restrict: la voce se ne va prima del permesso.
    await db.delete(menuEntry).where(like(menuEntry.name, `${PREFIX}%`))
    await db.delete(permission).where(like(permission.name, `${PREFIX}%`))
  })

  it('creare una funzionalità crea il permesso e la voce, collegati', async () => {
    const name = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(functionalityInput(name))

    const [voce] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    expect(voce.idPermission).not.toBeNull()

    const [perm] = await db.select().from(permission).where(eq(permission.idPermission, voce.idPermission!))
    expect(perm.kind).toBe('GRANT')
    expect(perm.origin).toBe('CONSOLE')
    // DEC-14: un permesso di origine CONSOLE nasce con code nullo — non c'è
    // controparte in requirePermission('...') nel sorgente.
    expect(perm.code).toBeNull()
  })

  it('creare una categoria crea la sola voce, senza permesso', async () => {
    const name = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(categoryInput(name))
    const [voce] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    expect(voce.idPermission).toBeNull()
  })

  it('eliminare una funzionalità elimina anche il permesso che aveva creato', async () => {
    const name = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(functionalityInput(name))
    const [voce] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    const idPerm = voce.idPermission!

    await deleteNavigationItem(id)

    expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))).toHaveLength(0)
    expect(await db.select().from(permission).where(eq(permission.idPermission, idPerm))).toHaveLength(0)
  })

  it('rolls back the permission + entry pair when tag replacement fails', async () => {
    const name = `${PREFIX}${sequence++}`
    await expect(createNavigationItem(functionalityInput(name, 'x'.repeat(51)))).rejects.toThrow()
    expect(await db.select().from(menuEntry).where(eq(menuEntry.name, name))).toHaveLength(0)
    expect(await db.select().from(permission).where(eq(permission.name, name))).toHaveLength(0)
  })

  it('rolls back field and parent changes when an update tag write fails', async () => {
    const original = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(functionalityInput(original))
    await expect(updateNavigationItem(id, functionalityInput(`${PREFIX}changed`, 'x'.repeat(51)))).rejects.toThrow()
    const [row] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    expect(row.name).toBe(original)
    expect(row.idParent).toBeNull()
  })

  it('serializes concurrent reorders into unique deterministic positions', async () => {
    const ids = await Promise.all([
      createNavigationItem(categoryInput(`${PREFIX}${sequence++}`)),
      createNavigationItem(categoryInput(`${PREFIX}${sequence++}`)),
      createNavigationItem(categoryInput(`${PREFIX}${sequence++}`)),
    ])
    await Promise.all(ids.map(({ id }, index) => moveNavigationItem(id, { targetParentId: null, orderPosition: 2 - index })))
    const rows = await db.select({ position: menuEntry.orderPosition })
      .from(menuEntry)
      .where(like(menuEntry.name, `${PREFIX}%`))
    expect(new Set(rows.map(row => row.position)).size).toBe(rows.length)
  })

  it('serializes subtree deletion with every other navigation write', async () => {
    const { id } = await createNavigationItem(categoryInput(`${PREFIX}${sequence++}`))
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
      expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))).toHaveLength(0)
    } finally {
      connection.release()
      await sql.end({ timeout: 5 })
    }
  })
})
