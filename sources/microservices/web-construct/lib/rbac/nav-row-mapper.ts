import type { permission, menuEntry } from '@/lib/db/schema'
import type { MenuEntryRow, PermissionRow } from './types'

export function toPermissionRow(r: typeof permission.$inferSelect): PermissionRow {
  return {
    id_permission: r.idPermission,
    kind: r.kind,
    code: r.code,
    name: r.name,
    id_parent: r.idParent,
    order_position: r.orderPosition,
    item_translation: r.itemTranslation as PermissionRow['item_translation'],
    description: r.description,
    deprecated_at: r.deprecatedAt,
  }
}

export function toMenuEntryRow(r: typeof menuEntry.$inferSelect): MenuEntryRow {
  return {
    id_menu_entry: r.idMenuEntry,
    id_permission: r.idPermission,
    id_parent: r.idParent,
    name: r.name,
    order_position: r.orderPosition,
    navbar_position: r.navbarPosition as 'TOP' | 'BOTTOM' | null,
    icon_path: r.iconPath,
    id_functionality_type: r.idFunctionalityType,
    functionality_link: r.functionalityLink,
    open_in_new_tab: r.openInNewTab,
    item_translation: r.itemTranslation as MenuEntryRow['item_translation'],
    is_immutable: r.isImmutable,
  }
}
