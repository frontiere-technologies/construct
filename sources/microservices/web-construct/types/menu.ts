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
  pageLight: string;
  pageDark: string;
  surfaceLight: string;
  surfaceDark: string;
  surfaceOverlayLight: string;
  surfaceOverlayDark: string;
  surfaceHoverLight: string;
  surfaceHoverDark: string;
  borderLight: string;
  borderDark: string;
  borderSubtleLight: string;
  borderSubtleDark: string;
  foregroundLight: string;
  foregroundDark: string;
  foregroundSecondaryLight: string;
  foregroundSecondaryDark: string;
  foregroundMutedLight: string;
  foregroundMutedDark: string;
  foregroundFaintLight: string;
  foregroundFaintDark: string;
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
  pageLight: '#f9fafb',
  pageDark: '#030712',
  surfaceLight: '#ffffff',
  surfaceDark: '#1f2937',
  surfaceOverlayLight: '#ffffff',
  surfaceOverlayDark: '#111827',
  surfaceHoverLight: '#f3f4f6',
  surfaceHoverDark: '#1f2937',
  borderLight: '#e5e7eb',
  borderDark: '#374151',
  borderSubtleLight: '#f3f4f6',
  borderSubtleDark: '#1f2937',
  foregroundLight: '#111827',
  foregroundDark: '#ffffff',
  foregroundSecondaryLight: '#374151',
  foregroundSecondaryDark: '#d1d5db',
  foregroundMutedLight: '#6b7280',
  foregroundMutedDark: '#9ca3af',
  foregroundFaintLight: '#9ca3af',
  foregroundFaintDark: '#6b7280',
}

export const defaultSettings: AppSettings = {
  language: 'en',
  theme: 'light',
  themeConfig: defaultThemeConfig,
}
