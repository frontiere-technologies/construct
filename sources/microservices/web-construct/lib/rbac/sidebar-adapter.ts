import type { MenuItem, MenuPosition } from '@/types/menu'
import {
  type NavigationItemRow, type RoleItemRow, type Locale,
  DEFAULT_LOCALE, ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY,
  FUNCTYPE_PERMISSION, FUNCTYPE_EMBEDDED_PAGE, FUNCTYPE_EXTERNAL_LINK,
} from './types'
import { resolveNavigationText } from './navigation-locales'

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

function labelFor(it: NavigationItemRow, locale: Locale, fallbackLocale: Locale): string {
  return resolveNavigationText(it.item_translation, 'name', locale, fallbackLocale, it.name)
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

/** Items that can never reach the sidebar, whatever the permissions say. */
function isRenderable(it: NavigationItemRow, byId: Map<number, NavigationItemRow>): boolean {
  return it.id_item !== ROOT_ID && it.id_item !== OPERATIONS_ID
    && !isUnderOperations(it, byId)
    && it.id_functionality_type !== FUNCTYPE_PERMISSION
    && it.config_visibility !== 1
}

/**
 * Items to render: everything authorized, plus the categories on the way to them.
 *
 * A category has no route of its own — it's a container, so it must show whenever it holds
 * something the user may open, grant or no grant. Categories are only ever granted implicitly
 * (Roles & Permissions walks up the ancestors of a functionality when it's toggled on), so a
 * section that an already-authorized item was later *moved* into carries no role_item row at
 * all; without this walk that section, and everything inside it, silently vanished.
 */
function resolveVisibleIds(items: NavigationItemRow[], authorizedIds: Set<number>, byId: Map<number, NavigationItemRow>): Set<number> {
  const visible = new Set<number>()
  for (const it of items) {
    if (!isRenderable(it, byId) || !authorizedIds.has(it.id_item)) continue
    visible.add(it.id_item)
    let parent = it.id_item_parent != null ? byId.get(it.id_item_parent) : undefined
    while (parent && parent.id_item_type === ITEM_TYPE_CATEGORY && isRenderable(parent, byId) && !visible.has(parent.id_item)) {
      visible.add(parent.id_item)
      parent = parent.id_item_parent != null ? byId.get(parent.id_item_parent) : undefined
    }
  }
  return visible
}

export function mapNavigationToSidebar(
  items: NavigationItemRow[],
  authorizedIds: Set<number>,
  locale: Locale = DEFAULT_LOCALE,
  fallbackLocale: Locale = DEFAULT_LOCALE,
): MenuItem[] {
  const byId = new Map(items.map(i => [i.id_item, i]))
  const visible = resolveVisibleIds(items, authorizedIds, byId)
  const out: MenuItem[] = []
  for (const it of items) {
    if (!visible.has(it.id_item)) continue

    const isCategory = it.id_item_type === ITEM_TYPE_CATEGORY
    const position: MenuPosition =
      it.navbar_position === 'TOP' ? 'top' : it.navbar_position === 'BOTTOM' ? 'bottom' : 'main'
    out.push({
      id: String(it.id_item),
      label: labelFor(it, locale, fallbackLocale),
      icon: it.icon_path ?? undefined,
      route: isCategory
        ? undefined
        : it.id_functionality_type === FUNCTYPE_EMBEDDED_PAGE
          ? `/embedded/${it.id_item}`
          : normalizeRoute(it.functionality_link),
      type: isCategory ? 'container' : 'link',
      // Only an external URL can leave the app, so only it carries a tab preference.
      target: it.id_functionality_type === FUNCTYPE_EXTERNAL_LINK
        ? (it.open_in_new_tab === 0 ? '_self' : '_blank')
        : undefined,
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
