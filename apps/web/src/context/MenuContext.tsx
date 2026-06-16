import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { MenuItem, AppSettings, User, ThemeConfig } from '../types/menu';
import { supabase } from '../lib/supabase';

const defaultMenu: MenuItem[] = [
  { id: '13', label: 'Documentation', icon: 'FileText', route: '/docs', type: 'link', parentId: null, order: 0, visible: true, active: true, roles: ['admin', 'user'], position: 'bottom' },
  { id: '14', label: 'Support', icon: 'Headphones', route: '/support', type: 'link', parentId: null, order: 1, visible: true, active: true, roles: ['admin', 'user'], position: 'bottom' },
  { id: '15', label: 'Settings', icon: 'Settings', route: '/settings', type: 'link', parentId: null, order: 2, visible: true, active: true, roles: ['admin', 'user'], position: 'bottom' },
  { id: '16', label: 'Admin', icon: 'Shield', type: 'container', parentId: null, order: 3, visible: true, active: true, roles: ['admin'], position: 'bottom', collapsible: true, defaultExpanded: false },
  { id: '17', label: 'Menu Builder', icon: 'LayoutList', route: '/admin/menu-builder', type: 'link', parentId: '16', order: 0, visible: true, active: true, roles: ['admin'], position: 'bottom' },
  { id: '18', label: 'Theme & Styles', icon: 'Palette', route: '/admin/theme', type: 'link', parentId: '16', order: 1, visible: true, active: true, roles: ['admin'], position: 'bottom' },
];

const defaultUser: User = {
  id: 'u1',
  name: 'Anna Taylor',
  email: 'anna.t@email.com',
  avatar: 'https://i.pravatar.cc/150?u=anna',
  role: 'admin'
};

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
};

// --- Supabase mappers ---

const mapToDb = (item: MenuItem) => ({
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
});

const mapFromDb = (row: Record<string, unknown>): MenuItem => ({
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
});

// --- Context ---

interface MenuContextType {
  menuItems: MenuItem[];
  saveMenuItems: (newItems: MenuItem[]) => Promise<void>;
  user: User;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  menuLoading: boolean;
}

const MenuContext = createContext<MenuContextType | undefined>(undefined);

export const MenuProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('appSettings');
    const parsed = (() => { try { return saved ? JSON.parse(saved) : null; } catch { return null; } })();
    return {
      language: parsed?.language || 'en',
      theme: parsed?.theme || 'light',
      themeConfig: parsed?.themeConfig || defaultThemeConfig
    };
  });

  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load menu items from Supabase on mount — read only, never writes back
  useEffect(() => {
    const loadMenuItems = async () => {
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .order('order');

      if (error) {
        console.error('Failed to load menu:', error.message);
        setMenuItems(defaultMenu);
      } else if (data && data.length > 0) {
        setMenuItems(data.map(mapFromDb));
      } else {
        // Table is empty: load defaults and seed the DB
        setMenuItems(defaultMenu);
        if (defaultMenu.length > 0) {
          await supabase.from('menu_items').insert(defaultMenu.map(mapToDb));
        }
      }
      setMenuLoading(false);
    };

    loadMenuItems();
  }, []);

  // saveMenuItems: the ONLY way to mutate the menu from Admin.
  // 1. Delete rows that no longer exist (by explicit ID list)
  // 2. Upsert rows that are new or updated
  // 3. Update React state
  const saveMenuItems = useCallback(async (newItems: MenuItem[]): Promise<void> => {
    const newIds = new Set(newItems.map(i => i.id));
    const deletedIds = menuItems.map(i => i.id).filter(id => !newIds.has(id));

    // Step 1: delete removed items by ID
    if (deletedIds.length > 0) {
      const { error } = await supabase
        .from('menu_items')
        .delete()
        .in('id', deletedIds);
      if (error) {
        console.error('Supabase delete failed:', error.message);
        throw new Error(error.message);
      }
    }

    // Step 2: upsert all current items (insert new, update existing)
    if (newItems.length > 0) {
      const { error } = await supabase
        .from('menu_items')
        .upsert(newItems.map(mapToDb), { onConflict: 'id' });
      if (error) {
        console.error('Supabase upsert failed:', error.message);
        throw new Error(error.message);
      }
    }

    // Step 3: update React state only after successful DB writes
    setMenuItems(newItems);
  }, [menuItems]);

  // Theme effect (settings stay in localStorage)
  useEffect(() => {
    localStorage.setItem('appSettings', JSON.stringify(settings));
    const isDark = settings.theme === 'dark';
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    const root = document.documentElement;
    const tc = settings.themeConfig || defaultThemeConfig;
    root.style.setProperty('--theme-primary', tc.primaryColor);
    root.style.setProperty('--theme-sidebar-bg', isDark ? tc.sidebarBgDark : tc.sidebarBgLight);
    root.style.setProperty('--theme-sidebar-text', isDark ? tc.sidebarTextDark : tc.sidebarTextLight);
    root.style.setProperty('--theme-active-bg', isDark ? tc.activeItemBgDark : tc.activeItemBgLight);
    root.style.setProperty('--theme-active-text', isDark ? tc.activeItemTextDark : tc.activeItemTextLight);
  }, [settings]);

  return (
    <MenuContext.Provider value={{ menuItems, saveMenuItems, user: defaultUser, settings, setSettings, isCollapsed, setIsCollapsed, menuLoading }}>
      {children}
    </MenuContext.Provider>
  );
};

export const useMenu = () => {
  const context = useContext(MenuContext);
  if (context === undefined) {
    throw new Error('useMenu must be used within a MenuProvider');
  }
  return context;
};
