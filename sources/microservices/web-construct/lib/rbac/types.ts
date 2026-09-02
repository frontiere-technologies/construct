import type { TextSearch } from '@/lib/grid-text-search'

export type Locale = string
export const DEFAULT_LOCALE: Locale = 'EN'

export const ROLE_REGISTERED = 0
export const ROLE_ADMINISTRATOR = 1

export const USER_STATUS_DEACTIVATED = 1
export const USER_STATUS_ACTIVE = 2

export const ROOT_ID = 0
export const OPERATIONS_ID = -1

export const ITEM_TYPE_CATEGORY = 1
export const ITEM_TYPE_FUNCTIONALITY = 2
export const FUNCTYPE_EMBEDDED_PAGE = 1
export const FUNCTYPE_EXTERNAL_LINK = 2
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
  /** 1 = open in a new tab. Only consulted for EXTERNAL_LINK items. */
  open_in_new_tab: number
}

export interface RoleItemRow {
  id_role: number
  id_item: number
  authorized: boolean
}

/** A menu_entry row (Task 3): a voice reuses its origin permission's id, but the tree it
 * describes is structural, not authorization — id_permission null means a public voice,
 * and a container (id_functionality_type null) carries no permission of its own at all. */
export interface MenuEntryRow {
  id_menu_entry: number
  id_permission: number | null
  id_parent: number | null
  name: string | null
  order_position: number
  navbar_position: 'TOP' | 'BOTTOM' | null
  icon_path: string | null
  id_functionality_type: number | null
  functionality_link: string | null
  open_in_new_tab: number
  item_translation: Record<string, ItemTranslation> | null
  is_immutable: number
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
  /** External links only: open the URL in a new tab rather than in the app's own tab. */
  openInNewTab?: boolean
  translations?: Record<string, { name?: string; description?: string }>
  tagTranslations?: Record<string, string[]>
}

/** A category offered as a Genitore. `navbarPosition` is what pins Home above / Admin below Root. */
export interface ParentOption {
  id: number
  name: string
  navbarPosition: 'TOP' | 'BOTTOM' | null
}

/** An option in a `CustomSelect`. Lives here, not in `components/`, because `lib/` code
 * (`buildGenitoreOptions`) needs the shape too and `lib/` cannot import from `components/`. */
export interface SelectOption {
  value: string | number
  label: string
}

export interface PermissionDelta {
  idItem: number
  authorization: boolean
}

export interface RolesQuery {
  page: number
  size: number
  search?: TextSearch
  idMin?: number
  idMax?: number
  associatedUsersMin?: number
  associatedUsersMax?: number
  sort?: 'id' | 'description' | 'associatedUsers' | 'hasPermissions' | 'dateIns' | 'dateMod'
  direction?: 'ASC' | 'DESC'
  hasPermission?: boolean
  startDateIns?: string
  endDateIns?: string
  startDateMod?: string
  endDateMod?: string
}

export interface RolesPage {
  pagination: { currentElements: number; currentPage: number; totalPages: number }
  /** Exact row count across all pages (from the same COUNT() query used for totalPages), so
   * grid datasources can compute an exact lastRow instead of a `< pageSize` length heuristic. */
  total: number
  elements: RolePageItemDto[]
}

export type FunctionalityType =
  | 'EMBEDDED_PAGE' | 'EXTERNAL_LINK' | 'INTERNAL_FUNCTIONALITY' | 'REMOTE_DESKTOP' | 'PERMISSION'

export const FUNCTIONALITY_TYPE_BY_ID: Record<number, FunctionalityType> = {
  1: 'EMBEDDED_PAGE', 2: 'EXTERNAL_LINK', 3: 'INTERNAL_FUNCTIONALITY', 4: 'REMOTE_DESKTOP', 5: 'PERMISSION',
}

export const FUNCTIONALITY_ID_BY_TYPE: Record<FunctionalityType, number> = {
  EMBEDDED_PAGE: 1, EXTERNAL_LINK: 2, INTERNAL_FUNCTIONALITY: 3, REMOTE_DESKTOP: 4, PERMISSION: 5,
}

export interface CreateNavItemInput {
  name: string
  idItemType: 1 | 2
  idFunctionalityType: number | null
  functionalityLink: string | null
  iconPath: string | null
  /** External links only: open the URL in a new tab. Defaults to true when omitted. */
  openInNewTab?: boolean
  idItemParent: number | null
  /** Resolved active-root id (ROOT_ID=0 or OPERATIONS_ID=-1). Used only on create to determine placement when idItemParent is null. Optional so edit-mode callers can omit it. */
  idRootParent?: number | null
  description: string
  itemTranslation: Record<string, { name?: string; description?: string }>
  tagTranslations: Record<string, string[]>
}
export type UpdateNavItemInput = CreateNavItemInput
export interface MoveInput { targetParentId: number; orderPosition: number }

export type UserStatusId = 1 | 2 // 1 Deactivated, 2 Active

export interface UserDto {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  createdAt: string
  updatedAt: string | null
  roles: { id: number; name: string }[]
  status: { idUserStatus: UserStatusId; description: 'Active' | 'Deactivated' }
  tenantValidationPending: false
  multiTenancyEnabled: false
}

export interface UsersQuery {
  page: number
  size: number
  nameSearch?: TextSearch
  emailSearch?: TextSearch
  roleIds?: number[]
  statuses?: UserStatusId[]
  createdFrom?: string
  createdTo?: string
  updatedFrom?: string
  updatedTo?: string
  sort?: 'firstName' | 'lastName' | 'email' | 'dateIns' | 'dateMod' | 'status'
  direction?: 'ASC' | 'DESC'
}
