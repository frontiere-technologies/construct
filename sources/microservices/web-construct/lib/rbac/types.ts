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

export type RoleType = 'SYSTEM' | 'SERVICE' | 'SYNCED'

export interface RolePageItemDto {
  id: number
  description: string
  associatedUsers: number
  hasPermissions: boolean
  dateIns: string | null
  dateMod: string | null
  roleType: RoleType
}

export interface RoleInformationDto {
  id: number
  roleName: string
  associatedUsersCount: number
  roleType: RoleType
}

export interface UserNavigationTreeDto {
  id: number
  name: string
  type: 'CATEGORY' | 'FUNCTIONALITY'
  parentId: number | null
  authorization: boolean
  children: UserNavigationTreeDto[]
  // Phase 2 (optional — Phase 1 consumers don't set these):
  description?: string | null
  functionalityType?: FunctionalityType | null
  link?: string | null
  icon?: string | null
  navbarPosition?: 'TOP' | 'BOTTOM' | null
  isImmutable?: boolean
  translations?: Record<string, { name?: string; description?: string }>
  tagTranslations?: Record<string, string[]>
}

export interface PermissionDelta {
  idItem: number
  authorization: boolean
}

export interface RolesQuery {
  page: number
  size: number
  search?: string
  sort?: 'id' | 'description' | 'associatedUsers' | 'dateIns' | 'dateMod'
  direction?: 'ASC' | 'DESC'
  hasPermission?: boolean
  startDateIns?: string
  endDateIns?: string
}

export interface RolesPage {
  pagination: { currentElements: number; currentPage: number; totalPages: number }
  elements: RolePageItemDto[]
}

export type FunctionalityType =
  | 'EMBEDDED_PAGE' | 'EXTERNAL_LINK' | 'INTERNAL_FUNCTIONALITY' | 'REMOTE_DESKTOP' | 'PERMISSION'

export interface CreateNavItemInput {
  name: string
  idItemType: 1 | 2
  idFunctionalityType: number | null
  functionalityLink: string | null
  iconPath: string | null
  idItemParent: number | null
  /** Resolved active-root id (ROOT_ID=0 or OPERATIONS_ID=-1). Used only on create to determine placement when idItemParent is null. Optional so edit-mode callers can omit it. */
  idRootParent?: number | null
  description: string
  itemTranslation: Record<string, { name?: string; description?: string }>
  tagTranslations: Record<string, string[]>
}
export type UpdateNavItemInput = CreateNavItemInput
export interface MoveInput { targetParentId: number; orderPosition: number }
