import type { UserNavigationTreeDto } from './types'

/**
 * Which row actions a tree node offers.
 *
 * The two questions are independent: *containment* — only a category can hold a new child, so
 * a functionality never shows "add" — and *mutability* — the seeded rows (Home, Admin, the Admin
 * pages) can never be renamed or deleted, but the immutable categories among them can still take
 * new children.
 */
export function rowActions(node: Pick<UserNavigationTreeDto, 'type' | 'isImmutable'>): {
  add: boolean; edit: boolean; remove: boolean
} {
  const mutable = node.isImmutable !== true
  return { add: node.type === 'CATEGORY', edit: mutable, remove: mutable }
}
