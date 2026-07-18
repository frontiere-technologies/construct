import type { navigationItem } from '@/lib/db/schema'
import type { NavigationItemRow } from './types'

export function toNavigationItemRow(r: typeof navigationItem.$inferSelect): NavigationItemRow {
  return {
    id_item: r.idItem,
    name: r.name,
    id_item_type: r.idItemType,
    id_functionality_type: r.idFunctionalityType,
    functionality_link: r.functionalityLink,
    icon_path: r.iconPath,
    id_item_parent: r.idItemParent,
    order_position: r.orderPosition,
    navbar_position: r.navbarPosition as 'TOP' | 'BOTTOM' | null,
    item_translation: r.itemTranslation as NavigationItemRow['item_translation'],
    is_immutable: r.isImmutable,
    config_visibility: r.configVisibility,
    no_permission_need_for_navigation: r.noPermissionNeedForNavigation,
  }
}
