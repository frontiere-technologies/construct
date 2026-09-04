'use server'

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { menuEntry } from '@/lib/db/schema'
import { toMenuEntryRow } from './nav-row-mapper'
import { sanitizeSvg } from './svg-sanitize'
import { canDeleteSubtree, isDescendant } from './nav-tree-builder'
import type { CreateNavItemInput, UpdateNavItemInput, MoveInput, MenuEntryRow } from './types'
import { ITEM_TYPE_CATEGORY } from './types'

type NavigationDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

async function lockNavigationWrites(database: NavigationDatabase) {
  await database.execute(sql`select pg_advisory_xact_lock(49374201)`)
}

async function writeMenuEntryTags(database: NavigationDatabase, idMenuEntry: number, tagTranslations: Record<string, string[]>) {
  const rows: { tag_lan: string; tag: string }[] = []
  for (const [lan, tags] of Object.entries(tagTranslations)) {
    for (const tag of tags) if (tag.trim()) rows.push({ tag_lan: lan, tag: tag.trim() })
  }
  // Atomic replace (delete + insert in one transaction) via the schema.sql RPC (DEC-3).
  try {
    await database.execute(sql`select public.replace_menu_entry_tags(${idMenuEntry}, ${JSON.stringify(rows)}::jsonb)`)
  } catch (err) {
    throw new Error(`Failed to write tags: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function loadMenuItems(database: NavigationDatabase = db): Promise<MenuEntryRow[]> {
  try {
    const rows = await database.select().from(menuEntry)
    return rows.map(toMenuEntryRow)
  } catch (err) {
    throw new Error(`Failed to load items: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function assertMutable(id: number, database: NavigationDatabase = db) {
  let row: { isImmutable: number } | undefined
  try {
    ;[row] = await database.select({ isImmutable: menuEntry.isImmutable }).from(menuEntry).where(eq(menuEntry.idMenuEntry, id)).limit(1)
  } catch (err) {
    throw new Error(`Item not found: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!row) throw new Error('Item not found: no rows')
  if (row.isImmutable === 1) throw new Error('This item is immutable')
}

/**
 * Reparent `id` under `targetParentId` at `orderPosition`, renumbering the destination's
 * children. Shared by moveNavigationItem (drag & drop in the tree) and updateNavigationItem
 * (the Genitore dropdown in the form). Operates on the menu tree ONLY: reordering or moving a
 * voice never touches the permission it points to — the two trees are independent, and shaped
 * differently. `targetParentId` null means the menu root: there is no item that stands for it,
 * unlike the old ROOT_ID/OPERATIONS_ID sentinels. Callers must have asserted `id` is mutable.
 */
async function reparent(
  database: NavigationDatabase,
  items: MenuEntryRow[],
  id: number,
  targetParentId: number | null,
  orderPosition: number,
) {
  if (targetParentId !== null) {
    if (isDescendant(items, targetParentId, id)) throw new Error('Cannot move an item into its own subtree')
    const targetItem = items.find(i => i.id_menu_entry === targetParentId)
    if (!targetItem || targetItem.id_functionality_type !== null) {
      throw new Error('Target parent must be a category')
    }
  }

  const dest = items
    .filter(i => i.id_parent === targetParentId && i.id_menu_entry !== id)
    .sort((a, b) => a.order_position - b.order_position)
    .map(i => i.id_menu_entry)
  const idx = Math.max(0, Math.min(orderPosition, dest.length))
  dest.splice(idx, 0, id)
  for (let pos = 0; pos < dest.length; pos++) {
    try {
      await database.update(menuEntry).set({ idParent: targetParentId, orderPosition: pos }).where(eq(menuEntry.idMenuEntry, dest[pos]))
    } catch (err) {
      throw new Error(`Failed to move item: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export async function createNavigationItem(input: CreateNavItemInput): Promise<{ id: number }> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  // Una categoria di menu non è un permesso: raggruppa voci, non protegge niente.
  const isCategory = input.idItemType === ITEM_TYPE_CATEGORY

  // I due campi dicono la stessa cosa due volte, e niente li obbligava a concordare. Il
  // motivo originale del controllo è caduto con la colonna id_permission: non nasce più un
  // permesso, quindi non esiste più la coppia incoerente che produceva una voce «pubblica e
  // ingovernabile». Il controllo resta perché una coppia incoerente resta una richiesta
  // priva di senso — { CATEGORIA, tipo 3 } chiede una cartella che è anche una pagina — e
  // una server action è un endpoint HTTP: rifiutare un input contraddittorio è il suo lavoro.
  //
  // `== null` e non `=== null`: su un campo che arriva dall'INPUT «assente» e «nullo» devono
  // dire la stessa cosa. Vale anche per `willBeCategory` in updateNavigationItem, che ha la
  // stessa origine; non vale per `wasCategory`, che viene dai dati salvati, dove una colonna
  // è nulla o valorizzata e «assente» non esiste.
  if (isCategory !== (input.idFunctionalityType == null)) {
    throw new Error(
      'Inconsistent item type: a category must have no functionality type, and a functionality must have one.',
    )
  }

  try {
    const created = await db.transaction(async tx => {
      await lockNavigationWrites(tx)

      // Le voci di primo livello hanno id_parent nullo: append-at-end fra i fratelli veri
      // (quelli sotto lo stesso genitore, root incluso), non un ordine fisso a 0.
      const siblings = await loadMenuItems(tx)
      const nextOrder = siblings
        .filter(i => i.id_parent === input.idItemParent)
        .reduce((m, i) => Math.max(m, i.order_position + 1), 0)

      const [entry] = await tx
        .insert(menuEntry)
        .values({
          idParent: input.idItemParent,
          name: input.name.trim(),
          idFunctionalityType: input.idFunctionalityType,
          functionalityLink: input.functionalityLink,
          iconPath: sanitizeSvg(input.iconPath),
          openInNewTab: input.openInNewTab === false ? 0 : 1,
          itemTranslation: input.itemTranslation,
          orderPosition: nextOrder,
        })
        .returning({ id: menuEntry.idMenuEntry })

      await writeMenuEntryTags(tx, entry.id, input.tagTranslations)
      return entry
    })
    revalidatePath('/', 'layout')
    return { id: created.id }
  } catch (err) {
    throw new Error(`Failed to create item: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// `input.idItemType` non si legge mai qui, deliberatamente: UpdateNavItemInput riusa la
// forma di CreateNavItemInput, ma su una voce che esiste già la tipologia la dicono i dati
// salvati, non il chiamante. È proprio questo a rendere il rifiuto qui sotto non
// aggirabile — nessuna forma dell'input può spacciare una voce per quello che non è. Sul
// percorso di creazione, invece, idItemType è l'unica fonte e createNavigationItem lo
// valida contro idFunctionalityType.
export async function updateNavigationItem(id: number, input: UpdateNavItemInput): Promise<void> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  try {
    await db.transaction(async tx => {
      await lockNavigationWrites(tx)
      await assertMutable(id, tx)

      const items = await loadMenuItems(tx)
      const current = items.find(i => i.id_menu_entry === id)
      if (!current) throw new Error(`Menu entry ${id} not found`)

      // Convertire una categoria in funzionalità o viceversa non è un'operazione che questa
      // funzione sa fare in sicurezza, e il divieto resta (DEC-22) — ma il motivo è cambiato.
      // Prima era: una categoria convertita resterebbe senza id_permission, cioè una voce
      // pubblica e ingovernabile. Quella colonna non esiste più. Il motivo che sopravvive è
      // l'altro verso, ed è più forte di "butterebbe via le concessioni": questa funzione non
      // tocca role_functionality, quindi le righe di una funzionalità convertita in categoria
      // sopravvivrebbero, concessioni su una riga ormai classificata contenitore — invisibili
      // in entrambi gli alberi (stampAuthorization timbra solo le funzionalità, resolveVisibleIds
      // salta i contenitori) e non più revocabili dall'interfaccia. Righe orfane e ingovernabili:
      // esattamente il difetto che questo lavoro esiste per rendere impossibile. Implementarlo
      // bene è lavoro della Fase 3, insieme all'editor dei permessi.
      const wasCategory = current.id_functionality_type === null
      const willBeCategory = input.idFunctionalityType == null
      if (wasCategory !== willBeCategory) {
        throw new Error(
          'Cannot change item type between category and functionality: delete this item and create a new one of the desired type instead.',
        )
      }

      if (current.id_parent !== input.idItemParent) {
        const siblings = items.filter(i => i.id_parent === input.idItemParent && i.id_menu_entry !== id).length
        await reparent(tx, items, id, input.idItemParent, siblings)
      }

      await tx
        .update(menuEntry)
        .set({
          name: input.name.trim(),
          idFunctionalityType: input.idFunctionalityType,
          functionalityLink: input.functionalityLink,
          iconPath: sanitizeSvg(input.iconPath),
          openInNewTab: input.openInNewTab === false ? 0 : 1,
          itemTranslation: input.itemTranslation,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(menuEntry.idMenuEntry, id))

      await writeMenuEntryTags(tx, id, input.tagTranslations)
    })
  } catch (err) {
    throw new Error(`Failed to update item: ${err instanceof Error ? err.message : String(err)}`)
  }
  revalidatePath('/', 'layout')
}

export async function moveNavigationItem(id: number, move: MoveInput): Promise<void> {
  await requireAdmin()
  await db.transaction(async tx => {
    await lockNavigationWrites(tx)
    await assertMutable(id, tx)
    const items = await loadMenuItems(tx)
    await reparent(tx, items, id, move.targetParentId, move.orderPosition)
  })
  revalidatePath('/', 'layout')
}

export async function deleteNavigationItem(id: number): Promise<void> {
  await requireAdmin()
  try {
    await db.transaction(async tx => {
      await lockNavigationWrites(tx)
      const items = await loadMenuItems(tx)
      if (!items.some(i => i.id_menu_entry === id)) return
      if (!canDeleteSubtree(items, id)) throw new Error('This item (or a descendant) is immutable and cannot be deleted')

      // menu_entry.id_parent è on delete cascade: cancellare `id` travolge il sottoalbero.
      // Le concessioni se ne vanno con lui, per la cascata su role_functionality.id_menu_entry
      // (migrazione 0024) — non c'è più niente da raccogliere prima di cancellare, e non c'è
      // più un permesso gemello che possa restare orfano. Era BUG-4: la riga di permission di
      // una categoria non era puntata da nessuna voce, quindi nessun percorso la citava mai.
      await tx.delete(menuEntry).where(eq(menuEntry.idMenuEntry, id))
    })
  } catch (err) {
    throw new Error(`Failed to delete item: ${err instanceof Error ? err.message : String(err)}`)
  }
  revalidatePath('/', 'layout')
}
