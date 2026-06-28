export const SUPPORTED_LOCALES = ['EN', 'IT', 'DE', 'FR', 'ES', 'NL', 'PT', 'SK', 'RO'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'EN'

export const ROLE_REGISTERED = 0
export const ROLE_ADMINISTRATOR = 1

export const ROOT_ID = 0
export const OPERATIONS_ID = -1

export const ITEM_TYPE_CATEGORY = 1
export const ITEM_TYPE_FUNCTIONALITY = 2
export const FUNCTYPE_PERMISSION = 5

export interface ItemTranslation {
  name?: string
  description?: string
}

export interface NavigationItemRow {
  id_item: number
  name: string | null
  id_item_type: number
  id_functionality_type: number | null
  functionality_link: string | null
  icon_path: string | null
  id_item_parent: number | null
  order_position: number
  navbar_position: 'TOP' | 'BOTTOM' | null
  item_translation: Record<string, ItemTranslation> | null
  is_immutable: number
  config_visibility: number
  no_permission_need_for_navigation: number
}

export interface RoleItemRow {
  id_role: number
  id_item: number
  authorized: boolean
}
