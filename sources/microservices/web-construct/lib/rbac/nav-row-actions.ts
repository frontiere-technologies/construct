import type { UserNavigationTreeDto } from './types'

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
