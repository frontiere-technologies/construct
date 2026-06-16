export type MenuPosition = 'top' | 'main' | 'bottom';
export type MenuItemType = 'link' | 'container' | 'action' | 'separator';

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
  roles: string[];
  target?: '_blank' | '_self';
  position: MenuPosition;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: string;
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
