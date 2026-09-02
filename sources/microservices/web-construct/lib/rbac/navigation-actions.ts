'use server'

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { permission, menuEntry } from '@/lib/db/schema'
import { toMenuEntryRow } from './nav-row-mapper'
import { sanitizeSvg } from './svg-sanitize'
import { canDeleteSubtree, descendantIds, isDescendant } from './nav-tree-builder'
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

  // La stessa invariante che updateNavigationItem impone sulla conversione, imposta qui
  // sulla nascita. I due campi dicono la stessa cosa due volte — idItemType decide se
  // nasce un permesso, idFunctionalityType finisce sulla riga di menu — e niente, prima
  // di questa riga, li obbligava a concordare. Una coppia incoerente
  // { idItemType: CATEGORIA, idFunctionalityType: 3 } produceva esattamente lo stato che
  // il rifiuto sulla conversione esiste per impedire: id_functionality_type valorizzato e
  // id_permission nullo, cioè una voce che sidebar-adapter mostra a chiunque sia
  // autenticato e che non compare in Ruoli & Permessi da nessuna parte. Il verso opposto
  // { FUNZIONALITÀ, null } crea un permesso che governa un contenitore, meno grave ma
  // altrettanto non voluto.
  //
  // Il modulo non è raggiungibile dall'interfaccia (FunctionalityForm manda sempre una
  // coppia coerente), ma una server action è un endpoint HTTP: la sua sicurezza non può
  // dipendere da quale modulo la chiama. Un vincolo sul database sarebbe sbagliato — la
  // specifica §3.2 elenca «voce con id_permission nullo» fra i casi legittimi del modello
  // — quindi il posto giusto è qui, dove si conosce l'intenzione.
  //
  // `== null` e non `=== null`, ed e' l'unico posto di questo file dove l'uguaglianza larga
  // e' quella giusta: qui «assente» e «nullo» devono dire la stessa cosa. Con il confronto
  // stretto una funzionalita' col campo OMESSO passava l'invariante, il permesso nasceva, e
  // Drizzle scriveva `default` sulla colonna — che non ha default, quindi NULL: un permesso
  // che governa un contenitore, il verso che questo commento dichiarava di rifiutare. E una
  // categoria legittima col campo omesso veniva rifiutata a torto. Trovato dalla
  // ri-revisione con una tabella di verita' sulle forme dell'input, non da un test: i due
  // test che ora lo coprono sono nati dopo la diagnosi.
  if (isCategory !== (input.idFunctionalityType == null)) {
    throw new Error(
      'Inconsistent item type: a category must have no functionality type, and a functionality must have one.',
    )
  }

  try {
    const created = await db.transaction(async tx => {
      await lockNavigationWrites(tx)

      let idPermission: number | null = null
      if (!isCategory) {
        const [row] = await tx
          .insert(permission)
          .values({
            kind: 'GRANT',
            // Nessun code: lo porta solo un permesso dichiarato dal sorgente (DEC-14).
            // Un permesso creato dalla console non ha controparte in requirePermission('...').
            origin: 'CONSOLE',
            name: input.name.trim(),
            description: input.description,
            itemTranslation: input.itemTranslation,
            idParent: null,
            orderPosition: 0,
          })
          .returning({ id: permission.idPermission })
        idPermission = row.id
      }

      // Le voci di primo livello hanno id_parent nullo: append-at-end fra i fratelli veri
      // (quelli sotto lo stesso genitore, root incluso), non un ordine fisso a 0.
      const siblings = await loadMenuItems(tx)
      const nextOrder = siblings
        .filter(i => i.id_parent === input.idItemParent)
        .reduce((m, i) => Math.max(m, i.order_position + 1), 0)

      const [entry] = await tx
        .insert(menuEntry)
        .values({
          idPermission,
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

      // Una voce è una categoria quando non ha un tipo di funzionalità (deduzione dai
      // dati, non dall'input): cambiarla in funzionalità o viceversa non è
      // un'operazione che questa funzione sa fare in sicurezza. Una categoria diventata
      // funzionalità porterebbe un id_functionality_type senza mai guadagnare un
      // id_permission (perché qui sotto il permesso si aggiorna solo se
      // entry.idPermission non è già nullo) — e id_permission nullo, in
      // sidebar-adapter.ts, significa voce pubblica: visibile a chiunque sia
      // autenticato, senza controllo e senza comparire in Ruoli & Permessi da nessuna
      // parte. Rifiutare l'intera chiamata, non scartare in silenzio il campo: è la
      // stessa politica di updateRolePermissions (roles-actions.ts) e per lo stesso
      // motivo — il silenzio nasconderebbe un chiamante difettoso.
      const wasCategory = current.id_functionality_type === null
      const willBeCategory = input.idFunctionalityType === null
      if (wasCategory !== willBeCategory) {
        throw new Error(
          'Cannot change item type between category and functionality: delete this item and create a new one of the desired type instead.',
        )
      }

      if (current.id_parent !== input.idItemParent) {
        const siblings = items.filter(i => i.id_parent === input.idItemParent && i.id_menu_entry !== id).length
        await reparent(tx, items, id, input.idItemParent, siblings)
      }

      const [entry] = await tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)).limit(1)
      if (!entry) throw new Error(`Menu entry ${id} not found`)

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

      if (entry.idPermission !== null) {
        // Il code resta quello di sempre: è il patto col sorgente, non un'etichetta (DEC-3).
        await tx
          .update(permission)
          .set({
            name: input.name.trim(),
            description: input.description,
            itemTranslation: input.itemTranslation,
          })
          .where(eq(permission.idPermission, entry.idPermission))
      }

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

      // menu_entry.id_parent è on delete cascade: cancellare `id` travolge anche l'intero
      // sottoalbero. Raccogliamo i permessi collegati — la voce stessa e ogni discendente —
      // PRIMA di cancellare, altrimenti quelli dei discendenti travolti dal cascade
      // resterebbero orfani (mai più cancellati, perché nessuna voce li cita più).
      const subtree = descendantIds(items, id)
      const idPermissions = items
        .filter(i => subtree.has(i.id_menu_entry) && i.id_permission !== null)
        .map(i => i.id_permission!)

      // L'ordine conta: on delete restrict fa fallire la cancellazione del
      // permesso finché una voce ci punta contro.
      await tx.delete(menuEntry).where(eq(menuEntry.idMenuEntry, id))

      for (const idPermission of idPermissions) {
        const [perm] = await tx
          .select({ origin: permission.origin })
          .from(permission)
          .where(eq(permission.idPermission, idPermission))
          .limit(1)
        // Un permesso SOURCE non si cancella da qui: lo possiede il sorgente.
        // In Fase 1 non ne esistono ancora, ma il ramo va scritto adesso.
        if (perm?.origin === 'CONSOLE') {
          await tx.delete(permission).where(eq(permission.idPermission, idPermission))
        }
      }
    })
  } catch (err) {
    throw new Error(`Failed to delete item: ${err instanceof Error ? err.message : String(err)}`)
  }
  revalidatePath('/', 'layout')
}
