import type { MenuItem, ThemeConfig, AppSettings } from '@/types/menu'

export const defaultMenu: MenuItem[] = [
  { id: '13', label: 'Documentation', icon: 'FileText', route: '/docs', type: 'link', parentId: null, order: 0, visible: true, active: true, roles: ['admin', 'user'], position: 'bottom' },
  { id: '14', label: 'Support', icon: 'Headphones', route: '/support', type: 'link', parentId: null, order: 1, visible: true, active: true, roles: ['admin', 'user'], position: 'bottom' },
  { id: '15', label: 'Settings', icon: 'Settings', route: '/settings', type: 'link', parentId: null, order: 2, visible: true, active: true, roles: ['admin', 'user'], position: 'bottom' },
  { id: '16', label: 'Admin', icon: 'Shield', type: 'container', parentId: null, order: 3, visible: true, active: true, roles: ['admin'], position: 'bottom', collapsible: true, defaultExpanded: false },
  { id: '17', label: 'Menu Builder', icon: 'LayoutList', route: '/admin/menu-builder', type: 'link', parentId: '16', order: 0, visible: true, active: true, roles: ['admin'], position: 'bottom' },
  { id: '18', label: 'Theme & Styles', icon: 'Palette', route: '/admin/theme', type: 'link', parentId: '16', order: 1, visible: true, active: true, roles: ['admin'], position: 'bottom' },
]

export const defaultThemeConfig: ThemeConfig = {
  primaryColor: '#2563eb',
  sidebarBgLight: '#ffffff',
  sidebarBgDark: '#111827',
  sidebarTextLight: '#4b5563',
  sidebarTextDark: '#9ca3af',
  activeItemBgLight: '#f3f4f6',
  activeItemBgDark: '#1f2937',
  activeItemTextLight: '#111827',
  activeItemTextDark: '#ffffff',
}

export const defaultSettings: AppSettings = {
  language: 'en',
  theme: 'light',
  themeConfig: defaultThemeConfig,
}

export const mapToDb = (item: MenuItem) => ({
  id: item.id,
  label: item.label,
  icon: item.icon ?? null,
  route: item.route ?? null,
  type: item.type,
  parent_id: item.parentId,
  order: item.order,
  visible: item.visible,
  active: item.active,
  roles: item.roles,
  target: item.target ?? null,
  position: item.position,
  collapsible: item.collapsible ?? null,
  default_expanded: item.defaultExpanded ?? null,
})

export const mapFromDb = (row: Record<string, unknown>): MenuItem => ({
  id: row.id as string,
  label: row.label as string,
  icon: (row.icon as string | null) ?? undefined,
  route: (row.route as string | null) ?? undefined,
  type: row.type as MenuItem['type'],
  parentId: (row.parent_id as string | null) ?? null,
  order: row.order as number,
  visible: row.visible as boolean,
  active: row.active as boolean,
  roles: row.roles as string[],
  target: (row.target as MenuItem['target'] | null) ?? undefined,
  position: row.position as MenuItem['position'],
  collapsible: (row.collapsible as boolean | null) ?? undefined,
  defaultExpanded: (row.default_expanded as boolean | null) ?? undefined,
})
