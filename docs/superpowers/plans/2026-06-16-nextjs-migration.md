# Next.js Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [✅]`) syntax for tracking.

**Goal:** Replace the Vite + React Router SPA in `apps/web/` with a Next.js 15 App Router application using `@supabase/ssr` for cookie-based auth, server-side menu fetching, and a clean split between Server and Client Components.

**Architecture:** The `app/` directory holds routing; a `(protected)` route group wraps all auth-gated pages with the sidebar layout. Auth is enforced by `middleware.ts` (replaces `ProtectedRoute`). `MenuContext` is replaced by a server-side fetch in the protected layout + a lightweight `UIContext` for theme/collapse state only.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4 (@tailwindcss/postcss), Supabase (@supabase/ssr), Lucide React, Motion, clsx, tailwind-merge.

---

## File Map

**Created (new):**
- `apps/web/next.config.ts`
- `apps/web/postcss.config.ts`
- `apps/web/middleware.ts`
- `apps/web/app/globals.css`
- `apps/web/app/layout.tsx`
- `apps/web/app/providers.tsx`
- `apps/web/app/login/page.tsx`
- `apps/web/app/(protected)/layout.tsx`
- `apps/web/app/(protected)/page.tsx`
- `apps/web/app/(protected)/admin/menu-builder/page.tsx`
- `apps/web/app/(protected)/admin/theme/page.tsx`
- `apps/web/lib/supabase-server.ts`
- `apps/web/lib/supabase-browser.ts`
- `apps/web/lib/menu-utils.ts`
- `apps/web/lib/menu-actions.ts`
- `apps/web/context/UIContext.tsx`
- `apps/web/context/AuthContext.tsx`
- `apps/web/components/Layout.tsx`
- `apps/web/components/Sidebar.tsx`
- `apps/web/components/SidebarItem.tsx`
- `apps/web/components/IconRenderer.tsx`
- `apps/web/components/IconPicker.tsx`
- `apps/web/components/Home.tsx`
- `apps/web/components/Login.tsx`
- `apps/web/components/AdminMenuBuilder.tsx`
- `apps/web/components/AdminTheme.tsx`
- `apps/web/types/menu.ts`

**Modified:**
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `apps/web/.env.local`
- `apps/web/.env.template`
- Root `package.json`

**Deleted at cleanup:**
- `apps/web/src/` (entire directory)
- `apps/web/vite.config.ts`
- `apps/web/index.html`

---

## Task 1: Update package.json

**Files:**
- Modify: `apps/web/package.json`

- [✅] **Step 1: Replace the full contents of `apps/web/package.json`**

```json
{
  "name": "@construct/web",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "clean": "rm -rf .next"
  },
  "dependencies": {
    "@google/genai": "^1.29.0",
    "@supabase/ssr": "^0.6.1",
    "@supabase/supabase-js": "^2.99.2",
    "clsx": "^2.1.1",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "next": "^15.3.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^3.5.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.14",
    "@types/node": "^22.14.0",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.14",
    "typescript": "~5.8.2"
  }
}
```

- [✅] **Step 2: Commit**

```bash
git add apps/web/package.json
git commit -m "chore: update package.json for Next.js migration"
```

---

## Task 2: Configuration files

**Files:**
- Create: `apps/web/next.config.ts`
- Create: `apps/web/postcss.config.ts`

- [✅] **Step 1: Create `apps/web/next.config.ts`**

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  env: {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  },
}

export default nextConfig
```

- [✅] **Step 2: Create `apps/web/postcss.config.ts`**

```ts
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
```

- [✅] **Step 3: Commit**

```bash
git add apps/web/next.config.ts apps/web/postcss.config.ts
git commit -m "chore: add Next.js and PostCSS config files"
```

---

## Task 3: Update tsconfig.json

**Files:**
- Modify: `apps/web/tsconfig.json`

- [✅] **Step 1: Replace the full contents of `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "src"]
}
```

- [✅] **Step 2: Commit**

```bash
git add apps/web/tsconfig.json
git commit -m "chore: update tsconfig.json for Next.js App Router"
```

---

## Task 4: Update environment variables

**Files:**
- Modify: `apps/web/.env.local`
- Modify: `apps/web/.env.template`

- [✅] **Step 1: Update `apps/web/.env.local` — rename the VITE_ prefixes**

Replace:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```
With:
```
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
GEMINI_API_KEY=<your-gemini-key>
```
Keep `GEMINI_API_KEY` as-is (no prefix — server-only, injected by next.config.ts).

- [✅] **Step 2: Replace `apps/web/.env.template` with**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GEMINI_API_KEY=
```

- [✅] **Step 3: Commit**

```bash
git add apps/web/.env.template
git commit -m "chore: update env template for Next.js (NEXT_PUBLIC_ prefix)"
```

Note: `.env.local` is gitignored, so update it manually but don't commit it.

---

## Task 5: Create Supabase clients

**Files:**
- Create: `apps/web/lib/supabase-server.ts`
- Create: `apps/web/lib/supabase-browser.ts`

- [✅] **Step 1: Create `apps/web/lib/supabase-server.ts`**

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — middleware handles session refresh
          }
        },
      },
    }
  )
}
```

- [✅] **Step 2: Create `apps/web/lib/supabase-browser.ts`**

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [✅] **Step 3: Commit**

```bash
git add apps/web/lib/
git commit -m "feat: add Supabase server and browser clients (@supabase/ssr)"
```

---

## Task 6: Create menu utilities

**Files:**
- Create: `apps/web/lib/menu-utils.ts`

This file contains the default data, mappers, and constants extracted from the old `MenuContext.tsx`. Used by both server-side layout (for seeding) and client-side admin.

- [✅] **Step 1: Create `apps/web/lib/menu-utils.ts`**

```ts
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
```

- [✅] **Step 2: Copy `apps/web/src/types/menu.ts` → `apps/web/types/menu.ts`**

Create `apps/web/types/menu.ts` with this content (identical to current `src/types/menu.ts`):

```ts
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
```

- [✅] **Step 3: Commit**

```bash
git add apps/web/lib/menu-utils.ts apps/web/types/menu.ts
git commit -m "feat: add menu utilities and types (extracted from MenuContext)"
```

---

## Task 7: Create menu-actions (client-side write utility)

**Files:**
- Create: `apps/web/lib/menu-actions.ts`

- [✅] **Step 1: Create `apps/web/lib/menu-actions.ts`**

```ts
import { createClient } from '@/lib/supabase-browser'
import { mapToDb } from '@/lib/menu-utils'
import type { MenuItem } from '@/types/menu'

export async function saveMenuItems(previousItems: MenuItem[], newItems: MenuItem[]): Promise<void> {
  const supabase = createClient()

  const newIds = new Set(newItems.map(i => i.id))
  const deletedIds = previousItems.map(i => i.id).filter(id => !newIds.has(id))

  if (deletedIds.length > 0) {
    const { error } = await supabase.from('menu_items').delete().in('id', deletedIds)
    if (error) throw new Error(error.message)
  }

  if (newItems.length > 0) {
    const { error } = await supabase
      .from('menu_items')
      .upsert(newItems.map(mapToDb), { onConflict: 'id' })
    if (error) throw new Error(error.message)
  }
}
```

- [✅] **Step 2: Commit**

```bash
git add apps/web/lib/menu-actions.ts
git commit -m "feat: add saveMenuItems client-side utility"
```

---

## Task 8: Create middleware

**Files:**
- Create: `apps/web/middleware.ts`

- [✅] **Step 1: Create `apps/web/middleware.ts`**

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isLoginPage = request.nextUrl.pathname === '/login'

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [✅] **Step 2: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat: add Next.js middleware for route protection (replaces ProtectedRoute)"
```

---

## Task 9: Create UIContext

**Files:**
- Create: `apps/web/context/UIContext.tsx`

- [✅] **Step 1: Create `apps/web/context/UIContext.tsx`**

```tsx
'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import type { AppSettings } from '@/types/menu'
import { defaultSettings, defaultThemeConfig } from '@/lib/menu-utils'

interface UIContextType {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
  isCollapsed: boolean
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>
}

const UIContext = createContext<UIContextType | undefined>(undefined)

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    if (typeof window === 'undefined') return defaultSettings
    const saved = localStorage.getItem('appSettings')
    const parsed = (() => { try { return saved ? JSON.parse(saved) : null } catch { return null } })()
    return {
      language: parsed?.language || 'en',
      theme: parsed?.theme || 'light',
      themeConfig: parsed?.themeConfig || defaultThemeConfig,
    }
  })

  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    localStorage.setItem('appSettings', JSON.stringify(settings))
    const isDark = settings.theme === 'dark'
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    const root = document.documentElement
    const tc = settings.themeConfig || defaultThemeConfig
    root.style.setProperty('--theme-primary', tc.primaryColor)
    root.style.setProperty('--theme-sidebar-bg', isDark ? tc.sidebarBgDark : tc.sidebarBgLight)
    root.style.setProperty('--theme-sidebar-text', isDark ? tc.sidebarTextDark : tc.sidebarTextLight)
    root.style.setProperty('--theme-active-bg', isDark ? tc.activeItemBgDark : tc.activeItemBgLight)
    root.style.setProperty('--theme-active-text', isDark ? tc.activeItemTextDark : tc.activeItemTextLight)
  }, [settings])

  return (
    <UIContext.Provider value={{ settings, setSettings, isCollapsed, setIsCollapsed }}>
      {children}
    </UIContext.Provider>
  )
}

export function useUI() {
  const context = useContext(UIContext)
  if (!context) throw new Error('useUI must be used within UIProvider')
  return context
}
```

- [✅] **Step 2: Commit**

```bash
git add apps/web/context/UIContext.tsx
git commit -m "feat: add UIContext (theme + sidebar collapse state)"
```

---

## Task 10: Create AuthContext

**Files:**
- Create: `apps/web/context/AuthContext.tsx`

- [✅] **Step 1: Create `apps/web/context/AuthContext.tsx`**

```tsx
'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-browser'

interface AuthContextType {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
```

- [✅] **Step 2: Commit**

```bash
git add apps/web/context/AuthContext.tsx
git commit -m "feat: add minimal AuthContext using @supabase/ssr browser client"
```

---

## Task 11: Create app root files

**Files:**
- Create: `apps/web/app/globals.css`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/providers.tsx`

- [✅] **Step 1: Create `apps/web/app/globals.css`**

```css
@import "tailwindcss";

@theme {
  --color-primary: var(--theme-primary);
  --color-sidebar-bg: var(--theme-sidebar-bg);
  --color-sidebar-text: var(--theme-sidebar-text);
  --color-sidebar-active-bg: var(--theme-active-bg);
  --color-sidebar-active-text: var(--theme-active-text);
}
```

- [✅] **Step 2: Create `apps/web/app/providers.tsx`**

```tsx
'use client'

import { AuthProvider } from '@/context/AuthContext'
import { UIProvider } from '@/context/UIContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <UIProvider>
        {children}
      </UIProvider>
    </AuthProvider>
  )
}
```

- [✅] **Step 3: Create `apps/web/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Construct',
  description: 'Construct application',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
```

- [✅] **Step 4: Commit**

```bash
git add apps/web/app/
git commit -m "feat: add app root layout, providers, and global CSS"
```

---

## Task 12: Create protected layout (server-side menu fetch)

**Files:**
- Create: `apps/web/app/(protected)/layout.tsx`

- [✅] **Step 1: Create `apps/web/app/(protected)/layout.tsx`**

```tsx
import { createClient } from '@/lib/supabase-server'
import { defaultMenu, mapFromDb, mapToDb } from '@/lib/menu-utils'
import { Layout } from '@/components/Layout'
import type { MenuItem } from '@/types/menu'

async function getMenuItems(): Promise<MenuItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .order('order')

  if (error) return defaultMenu

  if (!data || data.length === 0) {
    await supabase.from('menu_items').insert(defaultMenu.map(mapToDb))
    return defaultMenu
  }

  return data.map(mapFromDb)
}

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const menuItems = await getMenuItems()

  return <Layout menuItems={menuItems}>{children}</Layout>
}
```

- [✅] **Step 2: Commit**

```bash
git add "apps/web/app/(protected)/"
git commit -m "feat: add protected layout with server-side menu fetch"
```

---

## Task 13: Create all route page files

**Files:**
- Create: `apps/web/app/login/page.tsx`
- Create: `apps/web/app/(protected)/page.tsx`
- Create: `apps/web/app/(protected)/admin/menu-builder/page.tsx`
- Create: `apps/web/app/(protected)/admin/theme/page.tsx`

These are thin wrappers that import and render the actual components.

- [✅] **Step 1: Create `apps/web/app/login/page.tsx`**

```tsx
import { Login } from '@/components/Login'

export default function LoginPage() {
  return <Login />
}
```

- [✅] **Step 2: Create `apps/web/app/(protected)/page.tsx`**

```tsx
import { Home } from '@/components/Home'

export default function HomePage() {
  return <Home />
}
```

- [✅] **Step 3: Create `apps/web/app/(protected)/admin/menu-builder/page.tsx`**

The protected layout already handles seeding — this page just fetches.

```tsx
import { createClient } from '@/lib/supabase-server'
import { defaultMenu, mapFromDb } from '@/lib/menu-utils'
import { AdminMenuBuilder } from '@/components/AdminMenuBuilder'
import type { MenuItem } from '@/types/menu'

async function getMenuItems(): Promise<MenuItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('menu_items').select('*').order('order')
  if (error || !data || data.length === 0) return defaultMenu
  return data.map(mapFromDb)
}

export default async function MenuBuilderPage() {
  const menuItems = await getMenuItems()
  return <AdminMenuBuilder initialMenuItems={menuItems} />
}
```

- [✅] **Step 4: Create `apps/web/app/(protected)/admin/theme/page.tsx`**

```tsx
import { AdminTheme } from '@/components/AdminTheme'

export default function ThemePage() {
  return <AdminTheme />
}
```

- [✅] **Step 5: Commit**

```bash
git add apps/web/app/login/ "apps/web/app/(protected)/page.tsx" "apps/web/app/(protected)/admin/"
git commit -m "feat: add Next.js route page files"
```

---

## Task 14: Create shared components (no changes needed)

**Files:**
- Create: `apps/web/components/IconRenderer.tsx`
- Create: `apps/web/components/IconPicker.tsx`

- [✅] **Step 1: Create `apps/web/components/IconRenderer.tsx`**

Identical to current `src/components/IconRenderer.tsx`:

```tsx
import React from 'react';
import * as Icons from 'lucide-react';

interface IconRendererProps {
  name?: string;
  className?: string;
  size?: number;
}

export const IconRenderer: React.FC<IconRendererProps> = ({ name, className, size = 20 }) => {
  if (!name) return null;

  // @ts-ignore
  const IconComponent = Icons[name];

  if (!IconComponent) {
    return <Icons.HelpCircle className={className} size={size} />;
  }

  return <IconComponent className={className} size={size} />;
};
```

- [✅] **Step 2: Create `apps/web/components/IconPicker.tsx`**

Add `'use client'` at the top; rest is identical to `src/components/IconPicker.tsx`:

```tsx
'use client'

import React, { useState, useMemo } from 'react';
import * as Icons from 'lucide-react';
import { IconRenderer } from './IconRenderer';

const ALL_ICON_NAMES: string[] = Object.keys(Icons).filter(key => {
  if (!/^[A-Z]/.test(key)) return false;
  const val = (Icons as Record<string, unknown>)[key];
  if (typeof val !== 'object' || val === null) return false;
  const v = val as Record<string, unknown>;
  return typeof v['displayName'] === 'string' && v['displayName'] === key;
});

class IconItemBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? null : this.props.children; }
}

interface IconPickerProps {
  value: string;
  onChange: (name: string) => void;
}

export const IconPicker: React.FC<IconPickerProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () => ALL_ICON_NAMES.filter(n => n.toLowerCase().includes(search.toLowerCase())),
    [search]
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center space-x-2 p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
      >
        <div className="w-6 h-6 flex items-center justify-center">
          <IconRenderer name={value} size={18} />
        </div>
        <span className="flex-1 text-sm">{value || 'Select icon…'}</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg">
          <div className="p-2 border-b dark:border-gray-700">
            <input
              autoFocus
              type="text"
              placeholder="Search icons…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full p-2 text-sm border rounded-lg dark:bg-gray-800 dark:border-gray-700 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-6 gap-1 p-2 max-h-64 overflow-y-auto">
            {filtered.map(name => (
              <IconItemBoundary key={name}>
                <button
                  type="button"
                  title={name}
                  onClick={() => { onChange(name); setOpen(false); setSearch(''); }}
                  className={`flex flex-col items-center justify-center p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 gap-1 ${value === name ? 'bg-blue-100 dark:bg-blue-900/50' : ''}`}
                >
                  <IconRenderer name={name} size={18} />
                  <span className="text-[9px] text-gray-500 truncate w-full text-center leading-tight">{name}</span>
                </button>
              </IconItemBoundary>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-6 text-center text-sm text-gray-400 py-4">No icons found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
```

- [✅] **Step 3: Commit**

```bash
git add apps/web/components/IconRenderer.tsx apps/web/components/IconPicker.tsx
git commit -m "feat: add IconRenderer and IconPicker components"
```

---

## Task 15: Create Layout component

**Files:**
- Create: `apps/web/components/Layout.tsx`

Replaces `src/components/Layout.tsx`. Removes `<Outlet />`, adds `children` prop and `menuItems` prop for Sidebar. Client component because it renders Sidebar (which uses hooks).

- [✅] **Step 1: Create `apps/web/components/Layout.tsx`**

```tsx
'use client'

import React from 'react'
import { Sidebar } from './Sidebar'
import type { MenuItem } from '@/types/menu'

interface LayoutProps {
  children: React.ReactNode
  menuItems: MenuItem[]
}

export const Layout: React.FC<LayoutProps> = ({ children, menuItems }) => {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-hidden font-sans">
      <Sidebar menuItems={menuItems} />
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  )
}
```

- [✅] **Step 2: Commit**

```bash
git add apps/web/components/Layout.tsx
git commit -m "feat: add Layout component (Outlet → children, menuItems prop)"
```

---

## Task 16: Create Sidebar component

**Files:**
- Create: `apps/web/components/Sidebar.tsx`

Key changes from `src/components/Sidebar.tsx`:
- Add `'use client'`
- Accept `menuItems: MenuItem[]` as prop (removed from context)
- `useMenu()` → `useUI()` for `settings` and `setSettings`
- `useLocation()` → `usePathname()` from `next/navigation`
- `useNavigate()` → `useRouter()` from `next/navigation`
- `NavLink` → `Link` from `next/link`
- Remove `menuLoading` and loading skeleton

- [✅] **Step 1: Create `apps/web/components/Sidebar.tsx`**

```tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, Sun, Moon, CircleUser, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { useUI } from '@/context/UIContext'
import { useAuth } from '@/context/AuthContext'
import type { MenuItem, MenuPosition } from '@/types/menu'
import { IconRenderer } from './IconRenderer'

const ICON_COL_W = 'w-16'
const TEXT_COL_W = 'w-52'
const ICON_SUB_W = 'w-14'
const TEXT_SUB_W = 'w-48'
const COLLAPSE_KEY = 'sidebarCollapseState'

interface TooltipState { text: string; top: number; left: number }

const ColToggle: React.FC<{ collapsed: boolean; onToggle: () => void }> = ({ collapsed, onToggle }) => (
  <button
    onClick={onToggle}
    className="absolute -right-3 top-6 bg-sidebar-bg border border-sidebar-text/10 rounded-full p-1 shadow-sm hover:bg-sidebar-text/5 z-10"
  >
    {collapsed
      ? <ChevronRight size={14} className="text-sidebar-text/60" />
      : <ChevronLeft size={14} className="text-sidebar-text/60" />}
  </button>
)

interface L1ItemProps {
  item: MenuItem
  isSelected: boolean
  isActive: boolean
  isCollapsed: boolean
  onShowTooltip: (e: React.MouseEvent, text: string) => void
  onHideTooltip: () => void
  onClick: () => void
}

const L1Item: React.FC<L1ItemProps> = ({
  item, isSelected, isActive, isCollapsed, onShowTooltip, onHideTooltip, onClick,
}) => {
  const highlight = isActive || isSelected
  return (
    <button
      onClick={onClick}
      onMouseEnter={isCollapsed ? e => onShowTooltip(e, item.label) : undefined}
      onMouseLeave={isCollapsed ? onHideTooltip : undefined}
      className={clsx(
        'w-full flex items-center rounded-lg py-2 px-3 transition-colors duration-200',
        isCollapsed ? 'justify-center' : 'gap-3',
        highlight
          ? 'bg-sidebar-active-bg text-sidebar-active-text font-medium ring-1 ring-inset ring-primary/70'
          : 'text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text'
      )}
    >
      {item.icon && (
        <IconRenderer name={item.icon} size={20} className={highlight ? 'text-primary' : ''} />
      )}
      {!isCollapsed && <span className="text-sm truncate">{item.label}</span>}
    </button>
  )
}

interface SubItemProps {
  item: MenuItem
  menuItems: MenuItem[]
  isCollapsed: boolean
  isSelected: boolean
  isActive: boolean
  onShowTooltip: (e: React.MouseEvent, text: string) => void
  onHideTooltip: () => void
  onContainerClick: () => void
}

const SubItem: React.FC<SubItemProps> = ({
  item, menuItems, isCollapsed, isSelected, isActive, onShowTooltip, onHideTooltip, onContainerClick,
}) => {
  const hasChildren = menuItems.some(i => i.parentId === item.id && i.visible)
  const highlight = isActive || isSelected

  const cls = clsx(
    'flex items-center rounded-lg py-2 px-3 transition-colors duration-200 w-full text-sm',
    isCollapsed ? 'justify-center' : 'gap-3',
    highlight
      ? 'bg-sidebar-active-bg text-sidebar-active-text font-medium ring-1 ring-inset ring-primary/70'
      : 'text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text'
  )

  const tooltipEnter = isCollapsed ? (e: React.MouseEvent) => onShowTooltip(e, item.label) : undefined
  const tooltipLeave = isCollapsed ? onHideTooltip : undefined

  const icon = item.icon && (
    <IconRenderer name={item.icon} size={16} className={highlight ? 'text-primary' : ''} />
  )
  const label = !isCollapsed && <span className="truncate">{item.label}</span>

  if (hasChildren) {
    return (
      <button onClick={onContainerClick} onMouseEnter={tooltipEnter} onMouseLeave={tooltipLeave} className={cls}>
        {icon}{label}
      </button>
    )
  }

  if (item.route) {
    return (
      <Link href={item.route} onMouseEnter={tooltipEnter} onMouseLeave={tooltipLeave} className={cls}>
        {icon}{label}
      </Link>
    )
  }

  return (
    <div onMouseEnter={tooltipEnter} onMouseLeave={tooltipLeave} className={cls}>
      {icon}{label}
    </div>
  )
}

const readCollapse = (key: 'col1' | 'col2' | 'col3', defaultValue: boolean): boolean => {
  try {
    const saved = localStorage.getItem(COLLAPSE_KEY)
    if (!saved) return defaultValue
    const parsed = JSON.parse(saved)
    return parsed[key] ?? defaultValue
  } catch {
    return defaultValue
  }
}

interface SidebarProps {
  menuItems: MenuItem[]
}

export const Sidebar: React.FC<SidebarProps> = ({ menuItems }) => {
  const { settings, setSettings } = useUI()
  const { user: authUser, signOut } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  const [selectedL1Id, setSelectedL1Id] = useState<string | null>(null)
  const [selectedL2Id, setSelectedL2Id] = useState<string | null>(null)

  const [col1Collapsed, setCol1Collapsed] = useState<boolean>(() => readCollapse('col1', true))
  const [col2Collapsed, setCol2Collapsed] = useState<boolean>(() => readCollapse('col2', false))
  const [col3Collapsed, setCol3Collapsed] = useState<boolean>(() => readCollapse('col3', false))

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ col1: col1Collapsed, col2: col2Collapsed, col3: col3Collapsed }))
    } catch { /* ignore quota errors */ }
  }, [col1Collapsed, col2Collapsed, col3Collapsed])

  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const showTooltip = useCallback((e: React.MouseEvent, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTooltip({ text, top: rect.top + rect.height / 2, left: rect.right + 8 })
  }, [])
  const hideTooltip = useCallback(() => setTooltip(null), [])

  useEffect(() => {
    const active = menuItems.find(i => i.route === pathname)
    if (!active) return
    if (active.parentId === null) {
      setSelectedL1Id(null)
      setSelectedL2Id(null)
    } else {
      const parent = menuItems.find(i => i.id === active.parentId)
      if (!parent) return
      if (parent.parentId === null) {
        setSelectedL1Id(parent.id)
        setSelectedL2Id(null)
      } else {
        const grandparent = menuItems.find(i => i.id === parent.parentId)
        if (grandparent) {
          setSelectedL1Id(grandparent.id)
          setSelectedL2Id(parent.id)
        }
      }
    }
  }, [pathname, menuItems])

  const activeRouteId = menuItems.find(i => i.type === 'link' && i.route === pathname)?.id ?? null

  const getRootItems = (position: MenuPosition) =>
    menuItems
      .filter(i => i.parentId === null && i.visible && i.position === position)
      .sort((a, b) => a.order - b.order)

  const topItems = getRootItems('top')
  const mainItems = getRootItems('main')
  const bottomItems = getRootItems('bottom')

  const l1Children = selectedL1Id
    ? menuItems.filter(i => i.parentId === selectedL1Id && i.visible).sort((a, b) => a.order - b.order)
    : []

  const l2Children = selectedL2Id
    ? menuItems.filter(i => i.parentId === selectedL2Id && i.visible).sort((a, b) => a.order - b.order)
    : []

  const handleL1Click = useCallback((item: MenuItem) => {
    const hasChildren = menuItems.some(i => i.parentId === item.id && i.visible)
    if (hasChildren) {
      if (selectedL1Id === item.id) { setSelectedL1Id(null); setSelectedL2Id(null) }
      else { setSelectedL1Id(item.id); setSelectedL2Id(null) }
    } else if (item.route) {
      setSelectedL1Id(null)
      setSelectedL2Id(null)
      router.push(item.route)
    }
  }, [menuItems, selectedL1Id, router])

  const handleL2Click = useCallback((item: MenuItem) => {
    const hasChildren = menuItems.some(i => i.parentId === item.id && i.visible)
    if (hasChildren) {
      setSelectedL2Id(prev => prev === item.id ? null : item.id)
    } else if (item.route) {
      router.push(item.route)
    }
  }, [menuItems, router])

  const toggleTheme = () =>
    setSettings(prev => ({ ...prev, theme: prev.theme === 'light' ? 'dark' : 'light' }))

  return (
    <div className="flex h-screen flex-shrink-0">
      {tooltip && createPortal(
        <div
          className="fixed z-[9999] px-2 py-1 bg-gray-900 text-white text-xs rounded pointer-events-none whitespace-nowrap"
          style={{ top: tooltip.top, left: tooltip.left, transform: 'translateY(-50%)' }}
        >
          {tooltip.text}
        </div>,
        document.body
      )}

      <aside className={clsx(
        'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
        col1Collapsed ? ICON_COL_W : TEXT_COL_W
      )}>
        <ColToggle collapsed={col1Collapsed} onToggle={() => setCol1Collapsed(c => !c)} />

        {topItems.length > 0 && (
          <div className="p-2 border-b border-sidebar-text/10 space-y-1">
            {topItems.map(item => (
              <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
                isActive={selectedL1Id === null && item.id === activeRouteId}
                isCollapsed={col1Collapsed}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onClick={() => handleL1Click(item)} />
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
          {mainItems.map(item => (
            <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
              isActive={selectedL1Id === null && item.id === activeRouteId}
              isCollapsed={col1Collapsed}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}
        </div>

        <div className="p-2 border-t border-sidebar-text/10 space-y-1">
          {bottomItems.map(item => (
            <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
              isActive={selectedL1Id === null && item.id === activeRouteId}
              isCollapsed={col1Collapsed}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}

          <div className={clsx(
            'pt-2 mt-1 border-t border-sidebar-text/10 flex gap-2',
            col1Collapsed ? 'flex-col items-center' : 'flex-row items-center flex-wrap'
          )}>
            {authUser?.user_metadata?.avatar_url
              ? <img src={authUser.user_metadata.avatar_url} alt="avatar" className="w-7 h-7 rounded-full" />
              : <CircleUser size={26} className="text-sidebar-text opacity-60 flex-shrink-0" />}
            {!col1Collapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-medium text-sidebar-active-text truncate">
                  {authUser?.email?.split('@')[0] ?? ''}
                </span>
                <span className="text-xs opacity-50 truncate">{authUser?.email ?? ''}</span>
              </div>
            )}
            <button onClick={signOut} className="opacity-60 hover:opacity-100 flex-shrink-0" title="Logout">
              <LogOut size={15} />
            </button>
            <button onClick={toggleTheme} className="opacity-60 hover:opacity-100 flex-shrink-0" title="Toggle theme">
              {settings.theme === 'light' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </aside>

      {l1Children.length > 0 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          col2Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggle collapsed={col2Collapsed} onToggle={() => setCol2Collapsed(c => !c)} />
          {!col2Collapsed && (
            <div className="px-4 py-3 border-b border-sidebar-text/10">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-50">
                {menuItems.find(i => i.id === selectedL1Id)?.label}
              </span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
            {l1Children.map(item => (
              <SubItem key={item.id} item={item} menuItems={menuItems}
                isCollapsed={col2Collapsed} isSelected={selectedL2Id === item.id}
                isActive={item.id === activeRouteId}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onContainerClick={() => handleL2Click(item)} />
            ))}
          </div>
        </aside>
      )}

      {l2Children.length > 0 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          col3Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggle collapsed={col3Collapsed} onToggle={() => setCol3Collapsed(c => !c)} />
          {!col3Collapsed && (
            <div className="px-4 py-3 border-b border-sidebar-text/10">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-50">
                {menuItems.find(i => i.id === selectedL2Id)?.label}
              </span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
            {l2Children.map(item => (
              <SubItem key={item.id} item={item} menuItems={menuItems}
                isCollapsed={col3Collapsed} isSelected={false}
                isActive={item.id === activeRouteId}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onContainerClick={() => handleL2Click(item)} />
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}
```

- [✅] **Step 2: Commit**

```bash
git add apps/web/components/Sidebar.tsx
git commit -m "feat: migrate Sidebar to Next.js (usePathname, useRouter, Link, UIContext)"
```

---

## Task 17: Create SidebarItem component

**Files:**
- Create: `apps/web/components/SidebarItem.tsx`

Key changes: `'use client'`, `useMenu` → `useUI`, `useLocation` → `usePathname`, `NavLink` → `Link`.

- [✅] **Step 1: Create `apps/web/components/SidebarItem.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { MenuItem } from '@/types/menu'
import { IconRenderer } from './IconRenderer'
import { useUI } from '@/context/UIContext'

interface SidebarItemProps {
  item: MenuItem
  level: number
  childrenItems: MenuItem[]
  allMenuItems: MenuItem[]
}

export const SidebarItem: React.FC<SidebarItemProps> = ({ item, level, childrenItems, allMenuItems }) => {
  const { isCollapsed } = useUI()
  const pathname = usePathname()
  const [isExpanded, setIsExpanded] = useState(item.defaultExpanded || false)

  const hasChildren = childrenItems.length > 0

  const isChildActive = (parentId: string): boolean => {
    const children = allMenuItems.filter(i => i.parentId === parentId)
    return children.some(child =>
      child.route === pathname || isChildActive(child.id)
    )
  }

  const isActive = item.route === pathname || (hasChildren && isChildActive(item.id))

  const toggleExpand = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsExpanded(!isExpanded)
  }

  const itemClasses = twMerge(
    clsx(
      'flex items-center w-full py-2 px-3 rounded-lg transition-colors duration-200 cursor-pointer group relative',
      {
        'bg-sidebar-active-bg text-sidebar-active-text font-medium': isActive && item.type === 'link',
        'text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text': !isActive || item.type === 'container',
        'justify-center': isCollapsed,
      }
    )
  )

  const paddingLeft = isCollapsed ? 0 : level * 12

  const renderContent = () => (
    <>
      {item.icon && (
        <div className={clsx('flex-shrink-0', { 'mr-3': !isCollapsed })}>
          <IconRenderer name={item.icon} size={20} className={clsx({ 'text-primary': isActive && item.type === 'link' })} />
        </div>
      )}

      {!isCollapsed && (
        <div className="flex-1 flex items-center justify-between overflow-hidden">
          <span className="truncate text-sm">{item.label}</span>
          <div className="flex items-center space-x-2">
            {hasChildren && item.collapsible && (
              <button onClick={toggleExpand} className="p-0.5 rounded-md hover:bg-sidebar-text/10">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
          </div>
        </div>
      )}

      {isCollapsed && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
          {item.label}
        </div>
      )}
    </>
  )

  return (
    <div className="mb-1">
      {item.type === 'link' && item.route ? (
        <Link href={item.route} className={itemClasses} style={{ paddingLeft: `${paddingLeft}px` }}>
          {renderContent()}
        </Link>
      ) : (
        <div className={itemClasses} style={{ paddingLeft: `${paddingLeft}px` }} onClick={hasChildren && item.collapsible ? toggleExpand : undefined}>
          {renderContent()}
        </div>
      )}

      {hasChildren && (!item.collapsible || isExpanded) && !isCollapsed && (
        <div className="mt-1">
          {childrenItems
            .sort((a, b) => a.order - b.order)
            .map(child => (
              <SidebarItem
                key={child.id}
                item={child}
                level={level + 1}
                childrenItems={allMenuItems.filter(i => i.parentId === child.id && i.visible)}
                allMenuItems={allMenuItems}
              />
            ))}
        </div>
      )}
    </div>
  )
}
```

- [✅] **Step 2: Commit**

```bash
git add apps/web/components/SidebarItem.tsx
git commit -m "feat: migrate SidebarItem to Next.js (usePathname, Link, UIContext)"
```

---

## Task 18: Create page components

**Files:**
- Create: `apps/web/components/Home.tsx`
- Create: `apps/web/components/Login.tsx`
- Create: `apps/web/components/AdminMenuBuilder.tsx`
- Create: `apps/web/components/AdminTheme.tsx`

- [✅] **Step 1: Create `apps/web/components/Home.tsx`**

Key change: `useLocation()` → `usePathname()`.

```tsx
'use client'

import React from 'react'
import { usePathname } from 'next/navigation'

export const Home: React.FC = () => {
  const pathname = usePathname()

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 capitalize">
        {pathname === '/' ? 'Dashboard' : pathname.substring(1).replace('/', ' - ')}
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Total Users</h3>
          <p className="text-3xl font-bold">12,450</p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Active Sessions</h3>
          <p className="text-3xl font-bold">1,234</p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Revenue</h3>
          <p className="text-3xl font-bold">$45,678</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 min-h-[400px]">
        <h2 className="text-xl font-semibold mb-4">Content Area</h2>
        <p className="text-gray-600 dark:text-gray-400">
          This is a placeholder page for <strong>{pathname}</strong>.
          Navigate using the sidebar to see the active state change.
        </p>
        <p className="text-gray-600 dark:text-gray-400 mt-4">
          Go to the <strong>Admin Panel</strong> (bottom of sidebar) to configure the menu structure dynamically.
        </p>
      </div>
    </div>
  )
}
```

- [✅] **Step 2: Create `apps/web/components/Login.tsx`**

Key changes: remove `Navigate`, use `useRouter` for redirect after login, `createClient` from supabase-browser.

```tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

export function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-2xl shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">Accedi</h1>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white rounded-lg py-2 font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? 'Accesso in corso...' : 'Accedi'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [✅] **Step 3: Create `apps/web/components/AdminTheme.tsx`**

Key changes: `'use client'`, `useMenu` → `useUI`, import `defaultThemeConfig` from `menu-utils`.

```tsx
'use client'

import React from 'react'
import { useUI } from '@/context/UIContext'
import { defaultThemeConfig } from '@/lib/menu-utils'
import type { ThemeConfig } from '@/types/menu'

export const AdminTheme: React.FC = () => {
  const { settings, setSettings } = useUI()

  const updateTheme = (key: keyof ThemeConfig, value: string) => {
    setSettings({
      ...settings,
      themeConfig: { ...settings.themeConfig, [key]: value }
    })
  }

  const ColorPicker = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <div className="flex items-center justify-between">
      <label className="text-sm text-gray-700 dark:text-gray-300">{label}</label>
      <div className="flex items-center space-x-2">
        <span className="text-xs text-gray-500 font-mono uppercase w-16 text-right">{value}</span>
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
        />
      </div>
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Theme & Styles</h1>
        <p className="text-gray-500 dark:text-gray-400">Customize your application appearance</p>
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h3 className="font-medium text-gray-900 dark:text-white border-b pb-2 dark:border-gray-700">Global</h3>
            <ColorPicker
              label="Primary Color (Active Icons, Buttons)"
              value={settings.themeConfig.primaryColor}
              onChange={v => updateTheme('primaryColor', v)}
            />
          </div>

          <div className="hidden md:block"></div>

          <div className="space-y-4">
            <h3 className="font-medium text-gray-900 dark:text-white border-b pb-2 dark:border-gray-700">Light Theme</h3>
            <ColorPicker label="Sidebar Background" value={settings.themeConfig.sidebarBgLight} onChange={v => updateTheme('sidebarBgLight', v)} />
            <ColorPicker label="Sidebar Text" value={settings.themeConfig.sidebarTextLight} onChange={v => updateTheme('sidebarTextLight', v)} />
            <ColorPicker label="Active Item Background" value={settings.themeConfig.activeItemBgLight} onChange={v => updateTheme('activeItemBgLight', v)} />
            <ColorPicker label="Active Item Text" value={settings.themeConfig.activeItemTextLight} onChange={v => updateTheme('activeItemTextLight', v)} />
          </div>

          <div className="space-y-4">
            <h3 className="font-medium text-gray-900 dark:text-white border-b pb-2 dark:border-gray-700">Dark Theme</h3>
            <ColorPicker label="Sidebar Background" value={settings.themeConfig.sidebarBgDark} onChange={v => updateTheme('sidebarBgDark', v)} />
            <ColorPicker label="Sidebar Text" value={settings.themeConfig.sidebarTextDark} onChange={v => updateTheme('sidebarTextDark', v)} />
            <ColorPicker label="Active Item Background" value={settings.themeConfig.activeItemBgDark} onChange={v => updateTheme('activeItemBgDark', v)} />
            <ColorPicker label="Active Item Text" value={settings.themeConfig.activeItemTextDark} onChange={v => updateTheme('activeItemTextDark', v)} />
          </div>
        </div>

        <div className="mt-8 pt-4 border-t dark:border-gray-700 flex justify-end">
          <button
            onClick={() => setSettings({ ...settings, themeConfig: defaultThemeConfig })}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors border border-gray-300 dark:border-gray-600 rounded-lg"
          >
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [✅] **Step 4: Create `apps/web/components/AdminMenuBuilder.tsx`**

Key changes: `'use client'`, receive `initialMenuItems` as prop, use `saveMenuItems` from `menu-actions`, call `router.refresh()` after save.

```tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveMenuItems } from '@/lib/menu-actions'
import type { MenuItem, MenuPosition, MenuItemType } from '@/types/menu'
import { Plus, Trash2, Edit2, ArrowUp, ArrowDown, Save } from 'lucide-react'
import { IconRenderer } from './IconRenderer'
import { IconPicker } from './IconPicker'

const PROTECTED_IDS = new Set(['14', '15', '16', '17', '18'])

interface AdminMenuBuilderProps {
  initialMenuItems: MenuItem[]
}

export const AdminMenuBuilder: React.FC<AdminMenuBuilderProps> = ({ initialMenuItems }) => {
  const router = useRouter()
  const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems)
  const [committedItems, setCommittedItems] = useState<MenuItem[]>(initialMenuItems)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)

  const handleSaveMenuItems = async (newItems: MenuItem[]) => {
    await saveMenuItems(committedItems, newItems)
    setCommittedItems(newItems)
    setMenuItems(newItems)
    router.refresh()
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingItem) return
    const newItems = menuItems.find(i => i.id === editingItem.id)
      ? menuItems.map(i => i.id === editingItem.id ? editingItem : i)
      : [...menuItems, editingItem]
    await handleSaveMenuItems(newItems)
    setEditingItem(null)
  }

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this item and all its children?')) {
      const idsToDelete = [id]
      const findChildren = (parentId: string) => {
        const children = menuItems.filter(i => i.parentId === parentId)
        children.forEach(c => {
          idsToDelete.push(c.id)
          findChildren(c.id)
        })
      }
      findChildren(id)
      await handleSaveMenuItems(menuItems.filter(i => !idsToDelete.includes(i.id)))
    }
  }

  const moveItem = async (id: string, direction: 'up' | 'down') => {
    const item = menuItems.find(i => i.id === id)
    if (!item) return

    const siblings = menuItems
      .filter(i => i.parentId === item.parentId && i.position === item.position)
      .sort((a, b) => a.order - b.order)

    const index = siblings.findIndex(i => i.id === id)
    const newSiblings = [...siblings]

    if (direction === 'up' && index > 0) {
      [newSiblings[index - 1], newSiblings[index]] = [newSiblings[index], newSiblings[index - 1]]
    } else if (direction === 'down' && index < siblings.length - 1) {
      [newSiblings[index], newSiblings[index + 1]] = [newSiblings[index + 1], newSiblings[index]]
    } else {
      return
    }

    const orderMap = new Map(newSiblings.map((s, i) => [s.id, i]))
    await handleSaveMenuItems(menuItems.map(i => orderMap.has(i.id) ? { ...i, order: orderMap.get(i.id)! } : i))
  }

  const getItemPath = (itemId: string): string => {
    const item = menuItems.find(i => i.id === itemId)
    if (!item) return ''
    if (!item.parentId) return item.label
    return `${getItemPath(item.parentId)} > ${item.label}`
  }

  const getDescendantIds = (itemId: string): string[] => {
    const children = menuItems.filter(i => i.parentId === itemId)
    return children.reduce<string[]>((acc, c) => [...acc, c.id, ...getDescendantIds(c.id)], [])
  }

  const createNewItem = () => {
    const newItem: MenuItem = {
      id: Date.now().toString(),
      label: 'New Item',
      type: 'link',
      parentId: null,
      order: menuItems.length,
      visible: true,
      active: true,
      roles: ['admin', 'user'],
      position: 'main'
    }
    setEditingItem(newItem)
  }

  const renderTree = (parentId: string | null = null, level: number = 0, position?: MenuPosition) => {
    let items = menuItems.filter(i => i.parentId === parentId)
    if (position) items = items.filter(i => i.position === position)
    items.sort((a, b) => a.order - b.order)

    return items.map((item, idx) => (
      <div key={item.id} className="mb-2">
        <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm" style={{ marginLeft: `${level * 24}px` }}>
          <div className="flex items-center space-x-3">
            <IconRenderer name={item.icon} className="text-gray-500" />
            <div>
              <span className="font-medium">{item.label}</span>
              <span className="ml-2 text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{item.type}</span>
              {!item.visible && <span className="ml-2 text-xs text-red-500 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded">Hidden</span>}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {!PROTECTED_IDS.has(item.id) && <>
              {idx > 0 && <button onClick={() => moveItem(item.id, 'up')} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ArrowUp size={16} /></button>}
              {idx < items.length - 1 && <button onClick={() => moveItem(item.id, 'down')} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ArrowDown size={16} /></button>}
              <button onClick={() => setEditingItem(item)} className="p-1 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 rounded"><Edit2 size={16} /></button>
              <button onClick={() => handleDelete(item.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 rounded"><Trash2 size={16} /></button>
            </>}
            {PROTECTED_IDS.has(item.id) && (
              <button onClick={() => setEditingItem(item)} className="p-1 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 rounded"><Edit2 size={16} /></button>
            )}
          </div>
        </div>
        <div className="mt-2">{renderTree(item.id, level + 1)}</div>
      </div>
    ))
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">Menu Builder</h1>
          <p className="text-gray-500 dark:text-gray-400">Manage your application navigation structure</p>
        </div>
        <button
          onClick={createNewItem}
          className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={20} />
          <span>Add Item</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section>
            <h2 className="text-lg font-semibold mb-4 border-b pb-2 dark:border-gray-800">Top Section</h2>
            {renderTree(null, 0, 'top')}
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-4 border-b pb-2 dark:border-gray-800">Main Navigation</h2>
            {renderTree(null, 0, 'main')}
          </section>
          <section>
            <h2 className="text-lg font-semibold mb-4 border-b pb-2 dark:border-gray-800">Bottom Section</h2>
            {renderTree(null, 0, 'bottom')}
          </section>
        </div>

        <div>
          {editingItem ? (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm sticky top-8">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                <Edit2 size={18} className="mr-2" />
                {menuItems.find(i => i.id === editingItem.id) ? 'Edit Item' : 'New Item'}
              </h2>

              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Label</label>
                  <input
                    type="text"
                    value={editingItem.label}
                    onChange={e => setEditingItem({ ...editingItem, label: e.target.value })}
                    className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Type</label>
                    <select
                      value={editingItem.type}
                      onChange={e => setEditingItem({ ...editingItem, type: e.target.value as MenuItemType })}
                      className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                    >
                      <option value="link">Link</option>
                      <option value="container">Container</option>
                      <option value="action">Action</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Position</label>
                    <select
                      value={editingItem.position}
                      onChange={e => setEditingItem({ ...editingItem, position: e.target.value as MenuPosition })}
                      className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                    >
                      <option value="top">Top</option>
                      <option value="main">Main</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Route / URL</label>
                  <input
                    type="text"
                    value={editingItem.route || ''}
                    onChange={e => setEditingItem({ ...editingItem, route: e.target.value })}
                    className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Icon (Lucide)</label>
                  <IconPicker
                    value={editingItem.icon || ''}
                    onChange={icon => setEditingItem({ ...editingItem, icon })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Parent Item</label>
                  <select
                    value={editingItem.parentId || ''}
                    onChange={e => setEditingItem({ ...editingItem, parentId: e.target.value || null })}
                    className="w-full p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700"
                  >
                    <option value="">None (Root level)</option>
                    {menuItems
                      .filter(i => i.id !== editingItem.id && !getDescendantIds(editingItem.id).includes(i.id))
                      .map(i => (
                        <option key={i.id} value={i.id}>{getItemPath(i.id)}</option>
                      ))
                    }
                  </select>
                </div>

                <div className="flex space-x-4 py-2 border-y dark:border-gray-700">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingItem.visible}
                      onChange={e => setEditingItem({ ...editingItem, visible: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm">Visible</span>
                  </label>

                  {editingItem.type === 'container' && (
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingItem.collapsible || false}
                        onChange={e => setEditingItem({ ...editingItem, collapsible: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-sm">Collapsible</span>
                    </label>
                  )}
                </div>

                <div className="flex space-x-3 pt-4">
                  <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg flex items-center justify-center space-x-2">
                    <Save size={18} />
                    <span>Save Changes</span>
                  </button>
                  <button type="button" onClick={() => setEditingItem(null)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-center text-gray-500">
              Select an item to edit or create a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [✅] **Step 5: Commit**

```bash
git add apps/web/components/Home.tsx apps/web/components/Login.tsx apps/web/components/AdminMenuBuilder.tsx apps/web/components/AdminTheme.tsx
git commit -m "feat: migrate page components to Next.js (usePathname, useRouter, UIContext)"
```

---

## Task 19: Update root package.json scripts

**Files:**
- Modify: Root `package.json`

- [✅] **Step 1: Replace the full contents of the root `package.json`**

The current root `package.json` has scripts using `cd apps/web && npm run X`. These remain valid for Next.js since the scripts in `apps/web/package.json` now use `next` commands. No changes needed to the root `package.json` — skip this task.

Verify by running:
```bash
npm run web:dev
```
From the repo root. It should start `next dev --port 3000`.

- [✅] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: update root scripts for Next.js (dev/build commands)"
```

---

## Task 20: Delete old files and install dependencies

**Files:**
- Delete: `apps/web/src/` (entire directory)
- Delete: `apps/web/vite.config.ts`
- Delete: `apps/web/index.html`

- [✅] **Step 1: Install new dependencies**

```bash
cd apps/web && npm install
```

Expected: npm installs Next.js, @supabase/ssr, @tailwindcss/postcss, postcss. Should complete without errors.

- [✅] **Step 2: Delete old files**

```bash
rm -rf apps/web/src
rm apps/web/vite.config.ts
rm apps/web/index.html
```

- [✅] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove Vite, React Router, and old src/ directory"
```

---

## Task 21: Build verification

- [✅] **Step 1: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors. If there are import errors, check that all `@/` aliases resolve correctly (paths in `tsconfig.json` must point to `./*`).

- [✅] **Step 2: Run Next.js build**

```bash
cd apps/web && npm run build
```

Expected: build succeeds, outputs route manifest. If it fails:
- `Module not found: @supabase/ssr` → run `npm install` again
- `Cannot find module '@/...'` → check `tsconfig.json` paths
- `cookies() was called outside of a Server Component` → ensure `createClient` in `supabase-server.ts` is only imported from Server Components and middleware

- [✅] **Step 3: Start dev server and verify in browser**

```bash
cd apps/web && npm run dev
```

Open `http://localhost:3000` in browser. Verify:
1. Unauthenticated visit to `/` → redirected to `/login` ✓
2. Login with valid credentials → redirected to `/` ✓
3. Sidebar renders with correct menu items ✓
4. Navigate to `/admin/menu-builder` → AdminMenuBuilder loads with items ✓
5. Navigate to `/admin/theme` → color pickers work, theme changes apply ✓
6. Theme toggle (sun/moon icon in sidebar) persists across page refresh ✓
7. Logout button works → redirected to `/login` ✓

- [✅] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Vite → Next.js App Router migration"
```
