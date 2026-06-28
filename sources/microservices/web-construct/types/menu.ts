export type MenuPosition = 'top' | 'main' | 'bottom';
export type MenuItemType = 'link' | 'container';

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  route?: string;
  type: MenuItemType;
  parentId: string | null;
  order: number;
  visible: boolean;
  active: boolean;
  roles?: string[];
  target?: '_blank' | '_self';
  position: MenuPosition;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  system?: boolean;
}

export interface ThemeConfig {
  primaryColor: string;
  sidebarBgLight: string;
  sidebarBgDark: string;
  sidebarTextLight: string;
  sidebarTextDark: string;
  activeItemBgLight: string;
  activeItemBgDark: string;
  activeItemTextLight: string;
  activeItemTextDark: string;
}

export interface AppSettings {
  language: string;
  theme: 'light' | 'dark';
  themeConfig: ThemeConfig;
}

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
