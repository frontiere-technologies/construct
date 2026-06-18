import { z } from 'zod'
import type { MenuItem, ThemeConfig, AppSettings } from '@/types/menu'

const MenuItemRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().nullable().optional(),
  route: z.string().nullable().optional(),
  type: z.enum(['link', 'container']),
  parent_id: z.string().nullable(),
  order: z.number(),
  visible: z.boolean(),
  active: z.boolean(),
  roles: z.array(z.string()),
  target: z.enum(['_blank', '_self']).nullable().optional(),
  position: z.enum(['top', 'main', 'bottom']),
  collapsible: z.boolean().nullable().optional(),
  default_expanded: z.boolean().nullable().optional(),
})

export const defaultMenu: MenuItem[] = [
  { id: '13', label: 'Documentation', icon: 'FileText', route: '/docs', type: 'link', parentId: null, order: 0, visible: true, active: true, roles: ['admin', 'user'], position: 'bottom' },
  { id: '14', label: 'Support', icon: 'Headphones', route: '/support', type: 'link', parentId: null, order: 1, visible: true, active: true, roles: ['admin', 'user'], position: 'bottom' },
  { id: '16', label: 'Admin', icon: 'Shield', type: 'container', parentId: null, order: 2, visible: true, active: true, roles: ['admin'], position: 'bottom', collapsible: true, defaultExpanded: false },
  { id: '17', label: 'Menu Builder', icon: 'LayoutList', route: '/admin/menu-builder', type: 'link', parentId: '16', order: 0, visible: true, active: true, roles: ['admin'], position: 'bottom' },
  { id: '18', label: 'Theme & Styles', icon: 'Palette', route: '/admin/theme', type: 'link', parentId: '16', order: 1, visible: true, active: true, roles: ['admin'], position: 'bottom' },
]

export const defaultThemeConfig: ThemeConfig = {
primaryColor: '#6366f1',
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

export const mapFromDb = (row: Record<string, unknown>): MenuItem => {
  const r = MenuItemRowSchema.parse(row)
  return {
    id: r.id,
    label: r.label,
    icon: r.icon ?? undefined,
    route: r.route ?? undefined,
    type: r.type,
    parentId: r.parent_id,
    order: r.order,
    visible: r.visible,
    active: r.active,
    roles: r.roles,
    target: r.target ?? undefined,
    position: r.position,
    collapsible: r.collapsible ?? undefined,
    defaultExpanded: r.default_expanded ?? undefined,
  }
}
