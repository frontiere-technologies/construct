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

/**
 * L'input col campo `idFunctionalityType` davvero ASSENTE, non messo a undefined: una
 * server action e' un endpoint HTTP e un payload puo' semplicemente non portarlo. Il tipo
 * lo dichiara obbligatorio, quindi la cancellazione passa da un cast — e il cast e' il
 * punto del test: verifica cosa fa il server con una forma che il tipo non ammette ma la
 * rete si.
 */
function omitFunctionalityType(input: CreateNavItemInput): CreateNavItemInput {
  const copy: Record<string, unknown> = { ...input }
  delete copy.idFunctionalityType
  return copy as unknown as CreateNavItemInput
}

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

  it('non cancella mai un permesso di origine SOURCE, anche se la voce che lo cita viene eliminata', async () => {
    const name = `${PREFIX}${sequence++}`
    const code = `${PREFIX}source_${sequence++}`
    // Nessuna riga SOURCE esiste ancora in Fase 1 (arriva con la sincronizzazione del
    // catalogo, Fase 2): la inseriamo a mano per esercitare il ramo comunque, oggi.
    const [perm] = await db.insert(permission).values({
      kind: 'GRANT',
      origin: 'SOURCE',
      code,
      name,
      description: '',
      itemTranslation: { EN: { name } },
      idParent: null,
      orderPosition: 0,
    }).returning({ id: permission.idPermission })

    const [entry] = await db.insert(menuEntry).values({
      idPermission: perm.id,
      idParent: null,
      name,
      idFunctionalityType: 3,
      functionalityLink: `/${name}`,
      openInNewTab: 1,
      itemTranslation: { EN: { name } },
      orderPosition: 0,
    }).returning({ id: menuEntry.idMenuEntry })

    try {
      await deleteNavigationItem(entry.id)

      expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, entry.id))).toHaveLength(0)
      // Il permesso SOURCE sopravvive: lo possiede il sorgente, non la console.
      expect(await db.select().from(permission).where(eq(permission.idPermission, perm.id))).toHaveLength(1)
    } finally {
      await db.delete(menuEntry).where(eq(menuEntry.idMenuEntry, entry.id))
      await db.delete(permission).where(eq(permission.idPermission, perm.id))
    }
  })

  it('elimina i permessi orfani di un intero sottoalbero, non solo del primo livello', async () => {
    // categoria > sotto-categoria > funzionalità: due livelli sotto la voce cancellata,
    // cosi' un cammino fermato al primo figlio farebbe fallire questo test.
    const catName = `${PREFIX}${sequence++}`
    const subName = `${PREFIX}${sequence++}`
    const funcName = `${PREFIX}${sequence++}`

    const { id: catId } = await createNavigationItem(categoryInput(catName))
    const { id: subId } = await createNavigationItem({ ...categoryInput(subName), idItemParent: catId })
    const { id: funcId } = await createNavigationItem({ ...functionalityInput(funcName), idItemParent: subId })

    const [funcEntry] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, funcId))
    const idPerm = funcEntry.idPermission!

    await deleteNavigationItem(catId)

    // Il cascade su menu_entry.id_parent porta via l'intero sottoalbero...
    expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, catId))).toHaveLength(0)
    expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, subId))).toHaveLength(0)
    expect(await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, funcId))).toHaveLength(0)
    // ...e il permesso della funzionalita' a due livelli di profondita' non resta orfano.
    expect(await db.select().from(permission).where(eq(permission.idPermission, idPerm))).toHaveLength(0)
  })

  it('rolls back the permission + entry pair when tag replacement fails', async () => {
    const name = `${PREFIX}${sequence++}`
    await expect(createNavigationItem(functionalityInput(name, 'x'.repeat(51)))).rejects.toThrow()
    expect(await db.select().from(menuEntry).where(eq(menuEntry.name, name))).toHaveLength(0)
    expect(await db.select().from(permission).where(eq(permission.name, name))).toHaveLength(0)
  })

  it('rifiuta la conversione di una categoria in funzionalità: id_functionality_type e id_permission restano nulli', async () => {
    const name = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(categoryInput(name))

    await expect(updateNavigationItem(id, functionalityInput(name))).rejects.toThrow(/Cannot change item type/)

    const [row] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    expect(row.idFunctionalityType).toBeNull()
    expect(row.idPermission).toBeNull()
  })

  it('rifiuta la conversione di una funzionalità in categoria: id_functionality_type e id_permission restano quelli di prima', async () => {
    const name = `${PREFIX}${sequence++}`
    const { id } = await createNavigationItem(functionalityInput(name))
    const [before] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    expect(before.idFunctionalityType).not.toBeNull()
    expect(before.idPermission).not.toBeNull()

    await expect(updateNavigationItem(id, categoryInput(name))).rejects.toThrow(/Cannot change item type/)

    const [after] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    expect(after.idFunctionalityType).toBe(before.idFunctionalityType)
    expect(after.idPermission).toBe(before.idPermission)
  })

  // Le due sopra coprono la CONVERSIONE; queste due la NASCITA. La revisione dell'ondata
  // finale ha notato che le due funzioni definivano «categoria» in due modi diversi —
  // update dai dati salvati, create dall'input — e che solo update imponeva la coerenza.
  // Una coppia incoerente in ingresso a create raggiungeva lo stesso stato che il rifiuto
  // sulla conversione esiste per impedire, senza passare da nessuna conversione.
  it('rifiuta la creazione di una categoria con un tipo di funzionalità: non scrive né voce né permesso', async () => {
    const name = `${PREFIX}${sequence++}`

    await expect(
      createNavigationItem({ ...categoryInput(name), idFunctionalityType: 3 }),
    ).rejects.toThrow(/Inconsistent item type/)

    // La coppia incoerente sarebbe stata la voce pubblica e ingovernabile: nessuna delle
    // due righe deve esistere, nemmeno il permesso da solo.
    expect(await db.select().from(menuEntry).where(eq(menuEntry.name, name))).toHaveLength(0)
    expect(await db.select().from(permission).where(eq(permission.name, name))).toHaveLength(0)
  })

  it('rifiuta la creazione di una funzionalità senza tipo di funzionalità: non scrive né voce né permesso', async () => {
    const name = `${PREFIX}${sequence++}`

    await expect(
      createNavigationItem({ ...functionalityInput(name), idFunctionalityType: null }),
    ).rejects.toThrow(/Inconsistent item type/)

    expect(await db.select().from(menuEntry).where(eq(menuEntry.name, name))).toHaveLength(0)
    expect(await db.select().from(permission).where(eq(permission.name, name))).toHaveLength(0)
  })

  // La ri-revisione ha smontato l'invariante con una tabella di verita' e ha trovato la
  // falla: `=== null` non copre il campo OMESSO. Su una funzionalita' senza
  // idFunctionalityType l'invariante passava, il permesso nasceva, e Drizzle scriveva
  // `default` sulla colonna — che non ha default, quindi NULL. Risultato: un permesso che
  // governa un CONTENITORE, il verso che il commento dell'invariante dichiarava di
  // rifiutare e che DEC-13 dice non debba esistere. Il verso simmetrico era l'immagine
  // speculare: una categoria legittima col campo omesso veniva rifiutata a torto.
  it('rifiuta una funzionalità con il tipo OMESSO, non solo esplicitamente nullo', async () => {
    const name = `${PREFIX}${sequence++}`
    const senzaTipo = omitFunctionalityType(functionalityInput(name))

    await expect(
      createNavigationItem(senzaTipo),
    ).rejects.toThrow(/Inconsistent item type/)

    expect(await db.select().from(menuEntry).where(eq(menuEntry.name, name))).toHaveLength(0)
    expect(await db.select().from(permission).where(eq(permission.name, name))).toHaveLength(0)
  })

  it('accetta una categoria con il tipo OMESSO: assenza e nullo dicono la stessa cosa', async () => {
    const name = `${PREFIX}${sequence++}`
    const senzaTipo = omitFunctionalityType(categoryInput(name))

    const { id } = await createNavigationItem(senzaTipo)

    const [row] = await db.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    expect(row.idFunctionalityType).toBeNull()
    expect(row.idPermission).toBeNull()
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
