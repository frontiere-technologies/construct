import type { MenuItem, MenuPosition } from '@/types/menu'
import {
  type NavigationItemRow, type RoleItemRow, type Locale,
  DEFAULT_LOCALE, ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY, FUNCTYPE_PERMISSION, FUNCTYPE_EMBEDDED_PAGE,
} from './types'

export function resolveAuthorizedItemIds(
  items: NavigationItemRow[],
  roleItems: RoleItemRow[],
  roleIds: number[],
): Set<number> {
  const roleSet = new Set(roleIds)
  const ids = new Set<number>()
  for (const ri of roleItems) {
    if (ri.authorized && roleSet.has(ri.id_role)) ids.add(ri.id_item)
  }
  for (const it of items) {
    if (it.no_permission_need_for_navigation === 1) ids.add(it.id_item)
  }
  return ids
}

function labelFor(it: NavigationItemRow, locale: Locale): string {
  return it.item_translation?.[locale]?.name ?? it.item_translation?.[DEFAULT_LOCALE]?.name ?? it.name ?? ''
}

function normalizeRoute(link: string | null): string | undefined {
  if (!link) return undefined
  if (link.startsWith('/') || link.startsWith('http')) return link
  return '/' + link
}

function isUnderOperations(it: NavigationItemRow, byId: Map<number, NavigationItemRow>): boolean {
  let cur: NavigationItemRow | undefined = it
  const seen = new Set<number>()
  while (cur) {
    if (cur.id_item === OPERATIONS_ID) return true
    if (cur.id_item_parent == null || seen.has(cur.id_item)) break
    seen.add(cur.id_item)
    cur = byId.get(cur.id_item_parent)
  }
  return false
}

export function mapNavigationToSidebar(
  items: NavigationItemRow[],
  authorizedIds: Set<number>,
  locale: Locale = DEFAULT_LOCALE,
): MenuItem[] {
  const byId = new Map(items.map(i => [i.id_item, i]))
  const out: MenuItem[] = []
  for (const it of items) {
    if (it.id_item === ROOT_ID || it.id_item === OPERATIONS_ID) continue
    if (isUnderOperations(it, byId)) continue
    if (it.id_functionality_type === FUNCTYPE_PERMISSION) continue
    if (it.config_visibility === 1) continue
    if (!authorizedIds.has(it.id_item)) continue

    const isCategory = it.id_item_type === ITEM_TYPE_CATEGORY
    const position: MenuPosition =
      it.navbar_position === 'TOP' ? 'top' : it.navbar_position === 'BOTTOM' ? 'bottom' : 'main'
    out.push({
      id: String(it.id_item),
      label: labelFor(it, locale),
      icon: it.icon_path ?? undefined,
      route: isCategory
        ? undefined
        : it.id_functionality_type === FUNCTYPE_EMBEDDED_PAGE
          ? `/embedded/${it.id_item}`
          : normalizeRoute(it.functionality_link),
      type: isCategory ? 'container' : 'link',
      parentId: it.id_item_parent == null || it.id_item_parent === ROOT_ID ? null : String(it.id_item_parent),
      order: it.order_position,
      visible: true,
      active: true,
      position,
      collapsible: isCategory ? true : undefined,
      system: it.is_immutable === 1,
    })
  }
  const emitted = new Set(out.map(m => m.id))
  return out.filter(m => m.parentId === null || emitted.has(m.parentId))
}
