import type { UserNavigationTreeDto } from './types'

/**
 * Quanti figli diretti ha ogni nodo, sull'albero intero. Serve al cestino di una cartella, che
 * resta disattivato finché la cartella non è vuota: va contato sull'albero completo e non su
 * quello mostrato, perché un filtro di ricerca toglie dei figli e una cartella piena sembrerebbe
 * vuota.
 */
export function childCountById(tree: UserNavigationTreeDto[]): Map<number, number> {
  const counts = new Map<number, number>()
  const walk = (nodes: UserNavigationTreeDto[]) => {
    for (const n of nodes) { counts.set(n.id, n.children.length); walk(n.children) }
  }
  walk(tree)
  return counts
}

/**
 * Which row actions a tree node offers.
 *
 * Three independent questions: *permission* — a reader without `manage-menu` gets none; *containment* —
 * only a category can hold a new child, so a functionality never shows "add"; and *mutability* — the
 * seeded rows (Home, Admin, the Admin pages) can never be renamed or deleted, but the immutable
 * categories among them can still take new children.
 *
 * `canManage` has no default on purpose: a caller that forgets it must not compile.
 */
export function rowActions(node: Pick<UserNavigationTreeDto, 'type' | 'isImmutable'>, canManage: boolean): {
  add: boolean; edit: boolean; remove: boolean
} {
  if (!canManage) return { add: false, edit: false, remove: false }
  const mutable = node.isImmutable !== true
  return { add: node.type === 'CATEGORY', edit: mutable, remove: mutable }
}
