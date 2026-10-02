export type MenuPosition = 'top' | 'main' | 'bottom'
export type MenuItemType = 'link' | 'container'

export interface MenuItem {
  id: string
  label: string
  icon?: string
  route?: string
  type: MenuItemType
  parentId: string | null
  order: number
  visible: boolean
  active: boolean
  roles?: string[]
  target?: '_blank' | '_self'
  position: MenuPosition
  collapsible?: boolean
  defaultExpanded?: boolean
  system?: boolean
}
