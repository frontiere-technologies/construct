# Theme Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize the light/dark color combinations that are currently hardcoded as Tailwind `dark:` classes across 25 components into 10 new semantic CSS tokens, expose them as customizable color pickers on the "Theme & Styles" page, and migrate every affected component to use the new tokens.

**Architecture:** Follows the existing pattern already used for the 5 current tokens (`primaryColor`, sidebar bg/text, active item bg/text): CSS custom properties in `app/globals.css`, mapped into Tailwind's `@theme` so they generate utility classes (`bg-surface`, `border-border`, `text-foreground-muted`, ...), applied at runtime by `context/UIContext.tsx`, persisted via `lib/theme-actions.ts` into the existing `users.theme_config` `jsonb` column, edited from `components/AdminTheme.tsx`.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS v4, TypeScript, Vitest.

Spec: `docs/superpowers/specs/2026-07-04-theme-tokens-design.md`

## Global Constraints

- No DB migration needed: `theme_config` is `jsonb`; `UIContext.tsx` already merges saved config with `defaultThemeConfig`, so old saved configs missing the new fields keep working.
- The 10 new tokens must NOT reuse the name `primary` or collide with any existing `--color-*` key in `app/globals.css`.
- Every component migration must leave any `dark:` class that doesn't exactly match a rule below untouched (out of scope: status colors, `dark:bg-primary`, dashed dropzone borders, focus-within borders, toggle-switch track colors, and the handful of one-off/asymmetric `dark:` classes with no explicit light-mode counterpart).
- Run from `sources/microservices/web-construct/` for every command in this plan.

## Global Replacement Rules

Ordered, exact substring replacements (all non-overlapping — order doesn't matter, but apply all of them):

| # | Find | Replace |
|---|---|---|
| R1 | `bg-gray-50 dark:bg-gray-950` | `bg-page` |
| R2 | `bg-white dark:bg-gray-800` | `bg-surface` |
| R3 | `bg-white dark:bg-gray-900` | `bg-surface-overlay` |
| R4 | `hover:bg-gray-100 dark:hover:bg-gray-800` | `hover:bg-surface-hover` |
| R5 | `hover:bg-gray-50 dark:hover:bg-gray-800` | `hover:bg-surface-hover` |
| R6 | `border-gray-200 dark:border-gray-700` | `border-border` |
| R7 | `border-gray-100 dark:border-gray-800` | `border-border-subtle` |
| R8 | `border-gray-200 dark:border-gray-800` | `border-border-subtle` |
| R9 | `text-gray-700 dark:text-gray-300` | `text-foreground-secondary` |
| R10 | `text-gray-500 dark:text-gray-400` | `text-foreground-muted` |
| R11 | `text-gray-600 dark:text-gray-400` | `text-foreground-muted` |
| R12 | `text-gray-400 dark:text-gray-500` | `text-foreground-faint` |
| R13 | `text-gray-900 dark:text-white` | `text-foreground` |
| R14 | `text-gray-900 dark:text-gray-100` | `text-foreground` |

As a single `sed` invocation (BSD sed, macOS default — used verbatim in every migration task below):

```bash
sed -i '' \
  -e 's/bg-gray-50 dark:bg-gray-950/bg-page/g' \
  -e 's/bg-white dark:bg-gray-800/bg-surface/g' \
  -e 's/bg-white dark:bg-gray-900/bg-surface-overlay/g' \
  -e 's/hover:bg-gray-100 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/hover:bg-gray-50 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/border-gray-200 dark:border-gray-700/border-border/g' \
  -e 's/border-gray-100 dark:border-gray-800/border-border-subtle/g' \
  -e 's/border-gray-200 dark:border-gray-800/border-border-subtle/g' \
  -e 's/text-gray-700 dark:text-gray-300/text-foreground-secondary/g' \
  -e 's/text-gray-500 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-600 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-400 dark:text-gray-500/text-foreground-faint/g' \
  -e 's/text-gray-900 dark:text-white/text-foreground/g' \
  -e 's/text-gray-900 dark:text-gray-100/text-foreground/g' \
  FILE1 FILE2 ...
```

---

### Task 1: Extend `ThemeConfig` and add CSS tokens

**Files:**
- Modify: `types/menu.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: 20 new `ThemeConfig` fields (`pageLight`, `pageDark`, `surfaceLight`, `surfaceDark`, `surfaceOverlayLight`, `surfaceOverlayDark`, `surfaceHoverLight`, `surfaceHoverDark`, `borderLight`, `borderDark`, `borderSubtleLight`, `borderSubtleDark`, `foregroundLight`, `foregroundDark`, `foregroundSecondaryLight`, `foregroundSecondaryDark`, `foregroundMutedLight`, `foregroundMutedDark`, `foregroundFaintLight`, `foregroundFaintDark`), each a hex string, all present on `defaultThemeConfig`. Later tasks (2, 4, and the migration tasks) rely on these exact field names and on the Tailwind utilities `bg-page`, `bg-surface`, `bg-surface-overlay`, `bg-surface-hover`, `border-border`, `border-border-subtle`, `text-foreground`, `text-foreground-secondary`, `text-foreground-muted`, `text-foreground-faint`.

- [ ] **Step 1: Extend `ThemeConfig` and `defaultThemeConfig` in `types/menu.ts`**

Replace the interface and default object:

```ts
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
```

- [ ] **Step 2: Add the new CSS variables to `app/globals.css`**

Replace the file with:

```css
@import "tailwindcss";
@source "../**/*.{ts,tsx,js,jsx}";

:root {
  --theme-primary: #2563eb;
  --theme-sidebar-bg: #ffffff;
  --theme-sidebar-text: #4b5563;
  --theme-active-bg: #f3f4f6;
  --theme-active-text: #111827;
  --theme-page: #f9fafb;
  --theme-surface: #ffffff;
  --theme-surface-overlay: #ffffff;
  --theme-surface-hover: #f3f4f6;
  --theme-border: #e5e7eb;
  --theme-border-subtle: #f3f4f6;
  --theme-foreground: #111827;
  --theme-foreground-secondary: #374151;
  --theme-foreground-muted: #6b7280;
  --theme-foreground-faint: #9ca3af;
}

@theme {
  --color-primary: var(--theme-primary);
  --color-sidebar-bg: var(--theme-sidebar-bg);
  --color-sidebar-text: var(--theme-sidebar-text);
  --color-sidebar-active-bg: var(--theme-active-bg);
  --color-sidebar-active-text: var(--theme-active-text);
  --color-brand-blue: #0f5a8a;
  --color-page: var(--theme-page);
  --color-surface: var(--theme-surface);
  --color-surface-overlay: var(--theme-surface-overlay);
  --color-surface-hover: var(--theme-surface-hover);
  --color-border: var(--theme-border);
  --color-border-subtle: var(--theme-border-subtle);
  --color-foreground: var(--theme-foreground);
  --color-foreground-secondary: var(--theme-foreground-secondary);
  --color-foreground-muted: var(--theme-foreground-muted);
  --color-foreground-faint: var(--theme-foreground-faint);
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript or CSS errors.

- [ ] **Step 4: Commit**

```bash
git add types/menu.ts app/globals.css
git commit -m "feat(theme): add 10 new semantic color tokens to ThemeConfig and globals.css"
```

---

### Task 2: `lib/theme-vars.ts` — pure CSS variable resolver (TDD)

**Files:**
- Create: `lib/theme-vars.ts`
- Test: `lib/theme-vars.test.ts`

**Interfaces:**
- Consumes: `ThemeConfig`, `defaultThemeConfig` from `types/menu.ts` (Task 1).
- Produces: `resolveThemeVars(config: ThemeConfig, isDark: boolean): Record<string, string>` — used by Task 3.

- [ ] **Step 1: Write the failing test**

Create `lib/theme-vars.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveThemeVars } from './theme-vars'
import { defaultThemeConfig } from '@/types/menu'

describe('resolveThemeVars', () => {
  it('resolves light values when isDark is false', () => {
    const vars = resolveThemeVars(defaultThemeConfig, false)
    expect(vars['--theme-primary']).toBe(defaultThemeConfig.primaryColor)
    expect(vars['--theme-sidebar-bg']).toBe(defaultThemeConfig.sidebarBgLight)
    expect(vars['--theme-surface']).toBe(defaultThemeConfig.surfaceLight)
    expect(vars['--theme-foreground-muted']).toBe(defaultThemeConfig.foregroundMutedLight)
  })

  it('resolves dark values when isDark is true', () => {
    const vars = resolveThemeVars(defaultThemeConfig, true)
    expect(vars['--theme-sidebar-bg']).toBe(defaultThemeConfig.sidebarBgDark)
    expect(vars['--theme-surface']).toBe(defaultThemeConfig.surfaceDark)
    expect(vars['--theme-foreground-muted']).toBe(defaultThemeConfig.foregroundMutedDark)
  })

  it('falls back to the default color when a saved value is not a valid hex', () => {
    const broken = { ...defaultThemeConfig, surfaceLight: 'not-a-color' }
    const vars = resolveThemeVars(broken, false)
    expect(vars['--theme-surface']).toBe(defaultThemeConfig.surfaceLight)
  })

  it('falls back to the default primary color when invalid', () => {
    const broken = { ...defaultThemeConfig, primaryColor: 'nope' }
    const vars = resolveThemeVars(broken, false)
    expect(vars['--theme-primary']).toBe(defaultThemeConfig.primaryColor)
  })

  it('resolves all 15 CSS variables', () => {
    const vars = resolveThemeVars(defaultThemeConfig, false)
    expect(Object.keys(vars).sort()).toEqual([
      '--theme-active-bg',
      '--theme-active-text',
      '--theme-border',
      '--theme-border-subtle',
      '--theme-foreground',
      '--theme-foreground-faint',
      '--theme-foreground-muted',
      '--theme-foreground-secondary',
      '--theme-page',
      '--theme-primary',
      '--theme-sidebar-bg',
      '--theme-sidebar-text',
      '--theme-surface',
      '--theme-surface-hover',
      '--theme-surface-overlay',
    ])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/theme-vars.test.ts`
Expected: FAIL — `Cannot find module './theme-vars'`

- [ ] **Step 3: Implement `lib/theme-vars.ts`**

```ts
import { defaultThemeConfig, type ThemeConfig } from '@/types/menu'

const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v)
const safeColor = (v: string, fallback: string) => (isHex(v) ? v : fallback)

interface PairedToken {
  cssVar: string
  lightKey: keyof ThemeConfig
  darkKey: keyof ThemeConfig
}

const PAIRED_TOKENS: PairedToken[] = [
  { cssVar: '--theme-sidebar-bg', lightKey: 'sidebarBgLight', darkKey: 'sidebarBgDark' },
  { cssVar: '--theme-sidebar-text', lightKey: 'sidebarTextLight', darkKey: 'sidebarTextDark' },
  { cssVar: '--theme-active-bg', lightKey: 'activeItemBgLight', darkKey: 'activeItemBgDark' },
  { cssVar: '--theme-active-text', lightKey: 'activeItemTextLight', darkKey: 'activeItemTextDark' },
  { cssVar: '--theme-page', lightKey: 'pageLight', darkKey: 'pageDark' },
  { cssVar: '--theme-surface', lightKey: 'surfaceLight', darkKey: 'surfaceDark' },
  { cssVar: '--theme-surface-overlay', lightKey: 'surfaceOverlayLight', darkKey: 'surfaceOverlayDark' },
  { cssVar: '--theme-surface-hover', lightKey: 'surfaceHoverLight', darkKey: 'surfaceHoverDark' },
  { cssVar: '--theme-border', lightKey: 'borderLight', darkKey: 'borderDark' },
  { cssVar: '--theme-border-subtle', lightKey: 'borderSubtleLight', darkKey: 'borderSubtleDark' },
  { cssVar: '--theme-foreground', lightKey: 'foregroundLight', darkKey: 'foregroundDark' },
  { cssVar: '--theme-foreground-secondary', lightKey: 'foregroundSecondaryLight', darkKey: 'foregroundSecondaryDark' },
  { cssVar: '--theme-foreground-muted', lightKey: 'foregroundMutedLight', darkKey: 'foregroundMutedDark' },
  { cssVar: '--theme-foreground-faint', lightKey: 'foregroundFaintLight', darkKey: 'foregroundFaintDark' },
]

export function resolveThemeVars(config: ThemeConfig, isDark: boolean): Record<string, string> {
  const vars: Record<string, string> = {
    '--theme-primary': safeColor(config.primaryColor, defaultThemeConfig.primaryColor),
  }
  for (const token of PAIRED_TOKENS) {
    const key = isDark ? token.darkKey : token.lightKey
    vars[token.cssVar] = safeColor(config[key], defaultThemeConfig[key])
  }
  return vars
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/theme-vars.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/theme-vars.ts lib/theme-vars.test.ts
git commit -m "feat(theme): add resolveThemeVars pure function with tests"
```

---

### Task 3: Wire `UIContext.tsx` to `resolveThemeVars`

**Files:**
- Modify: `context/UIContext.tsx`

**Interfaces:**
- Consumes: `resolveThemeVars(config, isDark)` from Task 2.

- [ ] **Step 1: Replace the manual `setProperty` block**

In `context/UIContext.tsx`, replace the second `useEffect` body (the one that currently does `isHex`/`safeColor`/five `root.style.setProperty` calls) with:

```ts
  useEffect(() => {
    localStorage.setItem('appSettings', JSON.stringify(settings))
    const isDark = settings.theme === 'dark'
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    const root = document.documentElement
    const vars = resolveThemeVars(settings.themeConfig || defaultThemeConfig, isDark)
    for (const [cssVar, value] of Object.entries(vars)) {
      root.style.setProperty(cssVar, value)
    }
  }, [settings])
```

Add the import at the top of the file:

```ts
import { resolveThemeVars } from '@/lib/theme-vars'
```

- [ ] **Step 2: Verify the build and existing tests**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all vitest suites pass (including `lib/theme-vars.test.ts` from Task 2).

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev`, open the app in a browser, toggle Theme Mode in the sidebar. Expected: sidebar and active-item colors still switch correctly between light and dark (unchanged behavior — this task only refactors *how* they're computed).

- [ ] **Step 4: Commit**

```bash
git add context/UIContext.tsx
git commit -m "refactor(theme): drive UIContext CSS variables from resolveThemeVars"
```

---

### Task 4: Redesign the "Theme & Styles" page

**Files:**
- Modify: `components/AdminTheme.tsx`

**Interfaces:**
- Consumes: `ThemeConfig` fields from Task 1, `useUI()` from `context/UIContext.tsx` (unchanged), `saveThemeConfig` from `lib/theme-actions.ts` (unchanged).

- [ ] **Step 1: Replace `components/AdminTheme.tsx` in full**

```tsx
'use client'

import React, { useState } from 'react'
import { useUI } from '@/context/UIContext'
import { defaultThemeConfig } from '@/types/menu'
import { saveThemeConfig } from '@/lib/theme-actions'
import type { ThemeConfig } from '@/types/menu'
import { Card } from '@/components/Card'

interface ColorPickerProps {
  label: string
  value: string
  onChange: (v: string) => void
}

const ColorPicker: React.FC<ColorPickerProps> = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between">
    <label className="text-sm text-foreground-secondary">{label}</label>
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

interface TokenRowProps {
  label: string
  lightValue: string
  darkValue: string
  onChangeLight: (v: string) => void
  onChangeDark: (v: string) => void
}

const TokenRow: React.FC<TokenRowProps> = ({ label, lightValue, darkValue, onChangeLight, onChangeDark }) => (
  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4">
    <span className="text-sm text-foreground-secondary">{label}</span>
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase text-foreground-faint w-8">Light</span>
      <input type="color" value={lightValue} onChange={e => onChangeLight(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent" />
    </div>
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase text-foreground-faint w-8">Dark</span>
      <input type="color" value={darkValue} onChange={e => onChangeDark(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent" />
    </div>
  </div>
)

interface TokenGroup {
  title: string
  rows: { label: string; lightKey: keyof ThemeConfig; darkKey: keyof ThemeConfig }[]
}

const TOKEN_GROUPS: TokenGroup[] = [
  {
    title: 'Sfondi',
    rows: [
      { label: 'Page Background', lightKey: 'pageLight', darkKey: 'pageDark' },
      { label: 'Surface', lightKey: 'surfaceLight', darkKey: 'surfaceDark' },
      { label: 'Surface Overlay', lightKey: 'surfaceOverlayLight', darkKey: 'surfaceOverlayDark' },
      { label: 'Surface Hover', lightKey: 'surfaceHoverLight', darkKey: 'surfaceHoverDark' },
    ],
  },
  {
    title: 'Border',
    rows: [
      { label: 'Border', lightKey: 'borderLight', darkKey: 'borderDark' },
      { label: 'Border Subtle', lightKey: 'borderSubtleLight', darkKey: 'borderSubtleDark' },
    ],
  },
  {
    title: 'Testo',
    rows: [
      { label: 'Foreground', lightKey: 'foregroundLight', darkKey: 'foregroundDark' },
      { label: 'Foreground Secondary', lightKey: 'foregroundSecondaryLight', darkKey: 'foregroundSecondaryDark' },
      { label: 'Foreground Muted', lightKey: 'foregroundMutedLight', darkKey: 'foregroundMutedDark' },
      { label: 'Foreground Faint', lightKey: 'foregroundFaintLight', darkKey: 'foregroundFaintDark' },
    ],
  },
]

export const AdminTheme: React.FC = () => {
  const { settings, setSettings } = useUI()
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const updateTheme = (key: keyof ThemeConfig, value: string) => {
    setSettings({
      ...settings,
      themeConfig: { ...settings.themeConfig, [key]: value }
    })
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Theme & Styles</h1>
        <p className="text-foreground-muted">Customize your application appearance</p>
      </div>

      <Card className="space-y-8">
        <div className="space-y-4">
          <h3 className="font-medium text-foreground border-b pb-2 border-border">Global</h3>
          <ColorPicker
            label="Primary Color (Active Icons, Buttons)"
            value={settings.themeConfig.primaryColor}
            onChange={v => updateTheme('primaryColor', v)}
          />
        </div>

        {TOKEN_GROUPS.map(group => (
          <details key={group.title} open>
            <summary className="cursor-pointer font-medium text-foreground border-b pb-2 border-border">
              {group.title}
            </summary>
            <div className="space-y-3 mt-4">
              {group.rows.map(row => (
                <TokenRow
                  key={row.label}
                  label={row.label}
                  lightValue={settings.themeConfig[row.lightKey]}
                  darkValue={settings.themeConfig[row.darkKey]}
                  onChangeLight={v => updateTheme(row.lightKey, v)}
                  onChangeDark={v => updateTheme(row.darkKey, v)}
                />
              ))}
            </div>
          </details>
        ))}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h3 className="font-medium text-foreground border-b pb-2 border-border">Light Theme — Sidebar & Active Item</h3>
            <ColorPicker label="Sidebar Background" value={settings.themeConfig.sidebarBgLight} onChange={v => updateTheme('sidebarBgLight', v)} />
            <ColorPicker label="Sidebar Text" value={settings.themeConfig.sidebarTextLight} onChange={v => updateTheme('sidebarTextLight', v)} />
            <ColorPicker label="Active Item Background" value={settings.themeConfig.activeItemBgLight} onChange={v => updateTheme('activeItemBgLight', v)} />
            <ColorPicker label="Active Item Text" value={settings.themeConfig.activeItemTextLight} onChange={v => updateTheme('activeItemTextLight', v)} />
          </div>

          <div className="space-y-4">
            <h3 className="font-medium text-foreground border-b pb-2 border-border">Dark Theme — Sidebar & Active Item</h3>
            <ColorPicker label="Sidebar Background" value={settings.themeConfig.sidebarBgDark} onChange={v => updateTheme('sidebarBgDark', v)} />
            <ColorPicker label="Sidebar Text" value={settings.themeConfig.sidebarTextDark} onChange={v => updateTheme('sidebarTextDark', v)} />
            <ColorPicker label="Active Item Background" value={settings.themeConfig.activeItemBgDark} onChange={v => updateTheme('activeItemBgDark', v)} />
            <ColorPicker label="Active Item Text" value={settings.themeConfig.activeItemTextDark} onChange={v => updateTheme('activeItemTextDark', v)} />
          </div>
        </div>

        <div className="pt-4 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            {saveStatus === 'success' && (
              <span className="text-sm text-green-600 dark:text-green-400">Theme saved.</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm text-red-600 dark:text-red-400">Save failed. Please try again.</span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setSettings({ ...settings, themeConfig: defaultThemeConfig })}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors border border-gray-300 dark:border-gray-600 rounded-lg"
            >
              Reset to Defaults
            </button>
            <button
              onClick={async () => {
                setSaving(true)
                setSaveStatus('idle')
                const { error } = await saveThemeConfig(settings.themeConfig)
                setSaving(false)
                setSaveStatus(error ? 'error' : 'success')
                setTimeout(() => setSaveStatus('idle'), 3000)
              }}
              disabled={saving}
              className="px-4 py-2 text-sm text-white bg-[var(--theme-primary)] hover:opacity-90 disabled:opacity-50 rounded-lg transition-opacity"
            >
              {saving ? 'Saving…' : 'Save Theme'}
            </button>
          </div>
        </div>
      </Card>
    </div>
  )
}
```

Note: `border-b`/`border-t` here rely on Tailwind's `border` width utilities plus the new `border-border` *color* utility (same pattern Tailwind already uses elsewhere in this codebase, e.g. `border-b border-gray-200 dark:border-gray-700` before this refactor).

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual verification in the browser**

Run: `npm run dev`, log in, go to Admin → Theme. Expected:
- "Global", "Sfondi", "Border", "Testo" and the Sidebar/Active Item sections are all visible; "Sfondi"/"Border"/"Testo" are collapsible via the native `<details>` disclosure triangle.
- Changing any new color picker (e.g. "Surface") immediately changes the corresponding UI area at runtime (e.g. Card backgrounds).
- Toggling Theme Mode (light/dark) in the sidebar still updates the picker values shown (each `TokenRow` shows both Light and Dark swatches regardless of active mode — confirm both are editable independently).
- "Save Theme" persists without error; reloading the page keeps the customized values.
- "Reset to Defaults" restores every one of the 29 fields (including the 20 new ones) to `defaultThemeConfig`.

- [ ] **Step 4: Commit**

```bash
git add components/AdminTheme.tsx
git commit -m "feat(theme): expose 10 new color tokens on the Theme & Styles page"
```

---

### Task 5: Migrate global chrome components

**Files:**
- Modify: `components/Layout.tsx`, `components/Card.tsx`, `components/Home.tsx`, `components/IconPicker.tsx`

- [ ] **Step 1: Apply the replacement rules**

```bash
sed -i '' \
  -e 's/bg-gray-50 dark:bg-gray-950/bg-page/g' \
  -e 's/bg-white dark:bg-gray-800/bg-surface/g' \
  -e 's/bg-white dark:bg-gray-900/bg-surface-overlay/g' \
  -e 's/hover:bg-gray-100 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/hover:bg-gray-50 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/border-gray-200 dark:border-gray-700/border-border/g' \
  -e 's/border-gray-100 dark:border-gray-800/border-border-subtle/g' \
  -e 's/border-gray-200 dark:border-gray-800/border-border-subtle/g' \
  -e 's/text-gray-700 dark:text-gray-300/text-foreground-secondary/g' \
  -e 's/text-gray-500 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-600 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-400 dark:text-gray-500/text-foreground-faint/g' \
  -e 's/text-gray-900 dark:text-white/text-foreground/g' \
  -e 's/text-gray-900 dark:text-gray-100/text-foreground/g' \
  components/Layout.tsx components/Card.tsx components/Home.tsx components/IconPicker.tsx
```

- [ ] **Step 2: Verify — only expected `dark:` classes remain**

Run: `grep -n "dark:" components/Layout.tsx components/Card.tsx components/Home.tsx components/IconPicker.tsx`

Expected output (untouched, out-of-scope classes — asymmetric/one-off, left as-is on purpose):

```
components/IconPicker.tsx:52:        className="w-full flex items-center space-x-2 p-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
components/IconPicker.tsx:62:          <div className="p-2 border-b dark:border-gray-700">
components/IconPicker.tsx:69:              className="w-full p-2 text-sm border rounded-lg dark:bg-gray-800 dark:border-gray-700 focus:outline-none"
components/IconPicker.tsx:77:              className={`flex flex-col items-center justify-center p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 gap-1 ${!value ? 'bg-blue-100 dark:bg-blue-900/50' : ''}`}
components/IconPicker.tsx:88:                  className={`flex flex-col items-center justify-center p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 gap-1 ${value === name ? 'bg-blue-100 dark:bg-blue-900/50' : ''}`}
```
(`Layout.tsx`, `Card.tsx`, `Home.tsx` should have zero `dark:` matches left.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/Layout.tsx components/Card.tsx components/Home.tsx components/IconPicker.tsx
git commit -m "refactor(theme): migrate global chrome components to semantic color tokens"
```

---

### Task 6: Migrate forms

**Files:**
- Modify: `components/ProfileForm.tsx`, `components/ChangePasswordForm.tsx`, `app/(protected)/error.tsx`

- [ ] **Step 1: Apply the replacement rules**

```bash
sed -i '' \
  -e 's/bg-gray-50 dark:bg-gray-950/bg-page/g' \
  -e 's/bg-white dark:bg-gray-800/bg-surface/g' \
  -e 's/bg-white dark:bg-gray-900/bg-surface-overlay/g' \
  -e 's/hover:bg-gray-100 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/hover:bg-gray-50 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/border-gray-200 dark:border-gray-700/border-border/g' \
  -e 's/border-gray-100 dark:border-gray-800/border-border-subtle/g' \
  -e 's/border-gray-200 dark:border-gray-800/border-border-subtle/g' \
  -e 's/text-gray-700 dark:text-gray-300/text-foreground-secondary/g' \
  -e 's/text-gray-500 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-600 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-400 dark:text-gray-500/text-foreground-faint/g' \
  -e 's/text-gray-900 dark:text-white/text-foreground/g' \
  -e 's/text-gray-900 dark:text-gray-100/text-foreground/g' \
  components/ProfileForm.tsx components/ChangePasswordForm.tsx "app/(protected)/error.tsx"
```

- [ ] **Step 2: Verify — only expected `dark:` classes remain**

Run: `grep -n "dark:" components/ProfileForm.tsx components/ChangePasswordForm.tsx "app/(protected)/error.tsx"`

Expected output (untouched status colors and one-off disabled-input background, left as-is on purpose):

```
components/ProfileForm.tsx:74:                className="w-full px-3 py-2 rounded-lg border border-border bg-gray-100 dark:bg-gray-700 text-foreground-faint cursor-not-allowed text-sm"
components/ProfileForm.tsx:145:                ? 'text-green-600 dark:text-green-400'
components/ProfileForm.tsx:146:                : 'text-red-600 dark:text-red-400'
components/ChangePasswordForm.tsx:110:              ? 'text-green-600 dark:text-green-400'
components/ChangePasswordForm.tsx:111:              : 'text-red-600 dark:text-red-400'
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/ProfileForm.tsx components/ChangePasswordForm.tsx "app/(protected)/error.tsx"
git commit -m "refactor(theme): migrate form components to semantic color tokens"
```

---

### Task 7: Migrate RBAC shared/list components

**Files:**
- Modify: `components/rbac/DataTable.tsx`, `components/rbac/CustomSelect.tsx`, `components/rbac/FilterDrawer.tsx`, `components/rbac/roles/DateRangeFilter.tsx`, `components/rbac/NavigationTree.tsx`

- [ ] **Step 1: Apply the replacement rules**

```bash
sed -i '' \
  -e 's/bg-gray-50 dark:bg-gray-950/bg-page/g' \
  -e 's/bg-white dark:bg-gray-800/bg-surface/g' \
  -e 's/bg-white dark:bg-gray-900/bg-surface-overlay/g' \
  -e 's/hover:bg-gray-100 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/hover:bg-gray-50 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/border-gray-200 dark:border-gray-700/border-border/g' \
  -e 's/border-gray-100 dark:border-gray-800/border-border-subtle/g' \
  -e 's/border-gray-200 dark:border-gray-800/border-border-subtle/g' \
  -e 's/text-gray-700 dark:text-gray-300/text-foreground-secondary/g' \
  -e 's/text-gray-500 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-600 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-400 dark:text-gray-500/text-foreground-faint/g' \
  -e 's/text-gray-900 dark:text-white/text-foreground/g' \
  -e 's/text-gray-900 dark:text-gray-100/text-foreground/g' \
  components/rbac/DataTable.tsx components/rbac/CustomSelect.tsx components/rbac/FilterDrawer.tsx components/rbac/roles/DateRangeFilter.tsx components/rbac/NavigationTree.tsx
```

- [ ] **Step 2: Verify — only expected `dark:` classes remain**

Run: `grep -n "dark:" components/rbac/DataTable.tsx components/rbac/CustomSelect.tsx components/rbac/FilterDrawer.tsx components/rbac/roles/DateRangeFilter.tsx components/rbac/NavigationTree.tsx`

Expected output (untouched: focus ring one-off, hover border one-off, hover text one-off — left as-is on purpose):

```
components/rbac/CustomSelect.tsx:48:            ? 'border-gray-400 dark:border-gray-500 ring-2 ring-gray-100 dark:ring-gray-800'
components/rbac/CustomSelect.tsx:52:            : 'hover:border-gray-300 dark:hover:border-gray-600 cursor-pointer'}`}
components/rbac/FilterDrawer.tsx:25:            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
```

`DataTable.tsx` lines 184 and 198 (`hover:bg-gray-100 dark:hover:bg-gray-800`) are matched and replaced by R4, so they must NOT appear in the grep output — confirm they now read `hover:bg-surface-hover`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/rbac/DataTable.tsx components/rbac/CustomSelect.tsx components/rbac/FilterDrawer.tsx components/rbac/roles/DateRangeFilter.tsx components/rbac/NavigationTree.tsx
git commit -m "refactor(theme): migrate RBAC shared/list components to semantic color tokens"
```

---

### Task 8: Migrate RBAC roles/users components

**Files:**
- Modify: `components/rbac/roles/RenameRoleModal.tsx`, `components/rbac/roles/CreateRoleModal.tsx`, `components/rbac/roles/RolesTableClient.tsx`, `components/rbac/roles/RoleDetailClient.tsx`, `components/rbac/users/ManageRolesModal.tsx`, `components/rbac/users/UsersTableClient.tsx`

- [ ] **Step 1: Apply the replacement rules**

```bash
sed -i '' \
  -e 's/bg-gray-50 dark:bg-gray-950/bg-page/g' \
  -e 's/bg-white dark:bg-gray-800/bg-surface/g' \
  -e 's/bg-white dark:bg-gray-900/bg-surface-overlay/g' \
  -e 's/hover:bg-gray-100 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/hover:bg-gray-50 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/border-gray-200 dark:border-gray-700/border-border/g' \
  -e 's/border-gray-100 dark:border-gray-800/border-border-subtle/g' \
  -e 's/border-gray-200 dark:border-gray-800/border-border-subtle/g' \
  -e 's/text-gray-700 dark:text-gray-300/text-foreground-secondary/g' \
  -e 's/text-gray-500 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-600 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-400 dark:text-gray-500/text-foreground-faint/g' \
  -e 's/text-gray-900 dark:text-white/text-foreground/g' \
  -e 's/text-gray-900 dark:text-gray-100/text-foreground/g' \
  components/rbac/roles/RenameRoleModal.tsx components/rbac/roles/CreateRoleModal.tsx components/rbac/roles/RolesTableClient.tsx components/rbac/roles/RoleDetailClient.tsx components/rbac/users/ManageRolesModal.tsx components/rbac/users/UsersTableClient.tsx
```

- [ ] **Step 2: Verify — only expected `dark:` classes remain**

Run: `grep -n "dark:" components/rbac/roles/RenameRoleModal.tsx components/rbac/roles/CreateRoleModal.tsx components/rbac/roles/RolesTableClient.tsx components/rbac/roles/RoleDetailClient.tsx components/rbac/users/ManageRolesModal.tsx components/rbac/users/UsersTableClient.tsx`

Expected output (untouched one-off active-tab border indicator, left as-is on purpose):

```
components/rbac/roles/RoleDetailClient.tsx:81:            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-gray-900 text-foreground dark:border-white' : 'border-transparent text-gray-500'}`}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/rbac/roles/RenameRoleModal.tsx components/rbac/roles/CreateRoleModal.tsx components/rbac/roles/RolesTableClient.tsx components/rbac/roles/RoleDetailClient.tsx components/rbac/users/ManageRolesModal.tsx components/rbac/users/UsersTableClient.tsx
git commit -m "refactor(theme): migrate RBAC roles/users components to semantic color tokens"
```

---

### Task 9: Migrate RBAC functionalities components

**Files:**
- Modify: `components/rbac/functionalities/FunctionalitiesTreeClient.tsx`, `components/rbac/functionalities/FunctionalityForm.tsx`, `components/rbac/functionalities/TranslationsAccordion.tsx`, `components/rbac/functionalities/IconPicker.tsx`, `components/rbac/functionalities/TagInput.tsx`, `components/rbac/users/RoleMultiSelect.tsx`

- [ ] **Step 1: Apply the replacement rules**

```bash
sed -i '' \
  -e 's/bg-gray-50 dark:bg-gray-950/bg-page/g' \
  -e 's/bg-white dark:bg-gray-800/bg-surface/g' \
  -e 's/bg-white dark:bg-gray-900/bg-surface-overlay/g' \
  -e 's/hover:bg-gray-100 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/hover:bg-gray-50 dark:hover:bg-gray-800/hover:bg-surface-hover/g' \
  -e 's/border-gray-200 dark:border-gray-700/border-border/g' \
  -e 's/border-gray-100 dark:border-gray-800/border-border-subtle/g' \
  -e 's/border-gray-200 dark:border-gray-800/border-border-subtle/g' \
  -e 's/text-gray-700 dark:text-gray-300/text-foreground-secondary/g' \
  -e 's/text-gray-500 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-600 dark:text-gray-400/text-foreground-muted/g' \
  -e 's/text-gray-400 dark:text-gray-500/text-foreground-faint/g' \
  -e 's/text-gray-900 dark:text-white/text-foreground/g' \
  -e 's/text-gray-900 dark:text-gray-100/text-foreground/g' \
  components/rbac/functionalities/FunctionalitiesTreeClient.tsx components/rbac/functionalities/FunctionalityForm.tsx components/rbac/functionalities/TranslationsAccordion.tsx components/rbac/functionalities/IconPicker.tsx components/rbac/functionalities/TagInput.tsx components/rbac/users/RoleMultiSelect.tsx
```

- [ ] **Step 2: Verify — only expected `dark:` classes remain**

Run: `grep -n "dark:" components/rbac/functionalities/FunctionalitiesTreeClient.tsx components/rbac/functionalities/FunctionalityForm.tsx components/rbac/functionalities/TranslationsAccordion.tsx components/rbac/functionalities/IconPicker.tsx components/rbac/functionalities/TagInput.tsx components/rbac/users/RoleMultiSelect.tsx`

Expected output (untouched: active-tab border indicator, dashed dropzone borders, static (non-hover) chip backgrounds, focus-within border — left as-is on purpose):

```
components/rbac/functionalities/FunctionalitiesTreeClient.tsx:105:            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-gray-900 text-foreground dark:border-white' : 'border-transparent text-gray-500'}`}>
components/rbac/functionalities/IconPicker.tsx:112:        className={`group relative flex items-center justify-center rounded-lg border border-dashed cursor-pointer transition-colors hover:border-gray-400 dark:hover:border-gray-500
components/rbac/functionalities/IconPicker.tsx:114:            ? 'w-[38px] h-[38px] border-gray-300 dark:border-gray-600'
components/rbac/functionalities/IconPicker.tsx:115:            : 'flex-col gap-1 p-3 w-full border-gray-300 dark:border-gray-600'
components/rbac/functionalities/IconPicker.tsx:120:          : <ImageOff size={compact ? 16 : 24} className="text-gray-300 dark:text-gray-600" />}
components/rbac/functionalities/IconPicker.tsx:142:                  className={`text-xs font-medium pb-1 border-b-2 transition-colors ${tab === t ? 'border-gray-900 dark:border-white text-foreground' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
components/rbac/functionalities/IconPicker.tsx:157:                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-gray-50 dark:bg-gray-800">
components/rbac/functionalities/IconPicker.tsx:203:                className="flex flex-col items-center justify-center gap-2 p-5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:border-gray-400 transition-colors"
components/rbac/functionalities/IconPicker.tsx:215:              <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2 text-[10px] text-gray-500 leading-relaxed space-y-0.5">
components/rbac/users/RoleMultiSelect.tsx:27:      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border focus-within:border-gray-400 dark:focus-within:border-gray-500">
components/rbac/users/RoleMultiSelect.tsx:29:          <span key={r.id} className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">
components/rbac/functionalities/TagInput.tsx:16:        <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs">
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/rbac/functionalities/FunctionalitiesTreeClient.tsx components/rbac/functionalities/FunctionalityForm.tsx components/rbac/functionalities/TranslationsAccordion.tsx components/rbac/functionalities/IconPicker.tsx components/rbac/functionalities/TagInput.tsx components/rbac/users/RoleMultiSelect.tsx
git commit -m "refactor(theme): migrate RBAC functionalities components to semantic color tokens"
```

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full lint, build, and unit test run**

Run: `npm run lint && npm run build && npx vitest run`
Expected: all three succeed with zero errors/failures.

- [ ] **Step 2: Confirm no unintended leftover matches repo-wide**

Run:
```bash
grep -rn "text-gray-900 dark:text-white\|text-gray-900 dark:text-gray-100\|border-gray-200 dark:border-gray-700\|bg-white dark:bg-gray-900\|bg-white dark:bg-gray-800\|bg-gray-50 dark:bg-gray-950" --include="*.tsx" components app | grep -v node_modules
```
Expected: no output (every occurrence of these 6 rules was migrated across Tasks 5–9).

- [ ] **Step 3: Manual browser check — light and dark mode**

Run: `npm run dev`, then in the browser check both Theme Mode settings on:
- `/` (Home) — stat cards use `bg-surface`/`border-border-subtle`.
- Sidebar — unaffected by this plan, still themeable via existing Sidebar/Active Item pickers.
- `/user-management`, `/roles-permissions`, `/functionalities` — tables, filter drawers, dropdowns, and modals (Create/Rename Role, Manage Roles) render correctly in both modes, no invisible text or missing borders.
- `/profile` and the change-password form — inputs and labels render correctly in both modes.
- `/admin/theme` — full walkthrough from Task 4, Step 3.

Expected: no visual regressions; colors match what was hardcoded before (aside from the three documented micro-consistency fixes: `border-gray-200`→`border-gray-100`-equivalent on 6 borders, `text-gray-600`→`text-gray-500`-equivalent on 3 texts, `hover:bg-gray-50`→`hover:bg-gray-100`-equivalent on 3 hovers — all described in the spec).

- [ ] **Step 4: Existing e2e suite (unrelated flows must still pass)**

Run: `cd /Users/mario.stefanutti/mario/programming/github-frontiere/construct && uv run pytest sources/tests/e2e/test_sidebar.py`
Expected: PASS (confirms the sidebar theme toggle and navigation still work end-to-end after the `UIContext` refactor in Task 3).

- [ ] **Step 5: Update the design spec's status and commit**

```bash
cd sources/microservices/web-construct
git add -A
git status
```

If Step 2 or any build/lint/test command surfaced fixes, commit them now with a descriptive message ending in:

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

If nothing changed, no commit is needed for this task.
