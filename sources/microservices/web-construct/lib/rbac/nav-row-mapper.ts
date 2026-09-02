import type { permission, menuEntry } from '@/lib/db/schema'
import type { MenuEntryRow, NavigationItemRow } from './types'

export function toNavigationItemRow(r: typeof permission.$inferSelect): NavigationItemRow {
  return {
    id_item: r.idPermission,
    name: r.name,
    id_item_type: r.idItemType,
    id_functionality_type: r.idFunctionalityType,
    functionality_link: r.functionalityLink,
    icon_path: r.iconPath,
    id_item_parent: r.idParent,
    order_position: r.orderPosition,
    navbar_position: r.navbarPosition as 'TOP' | 'BOTTOM' | null,
    item_translation: r.itemTranslation as NavigationItemRow['item_translation'],
    is_immutable: r.isImmutable,
    config_visibility: r.configVisibility,
    no_permission_need_for_navigation: r.noPermissionNeedForNavigation,
    open_in_new_tab: r.openInNewTab,
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
