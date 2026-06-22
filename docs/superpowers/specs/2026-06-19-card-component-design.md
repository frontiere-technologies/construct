# Card Component — Design Spec

**Date:** 2026-06-19  
**Status:** Approved

## Problem

Three pages use inconsistent card styles:
- `ProfileForm`: `rounded-2xl shadow-md p-8`, no border
- `AdminTheme`: `rounded-xl border shadow-sm p-6` ← target style
- `AdminMenuBuilder` edit panel: already matches target

The style is also duplicated inline with no single source of truth.

## Solution

Create a shared `<Card>` React component that encapsulates the standard card style. Replace inline class strings in all three components.

## Standard Card Style

```
bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm
```

## Component API

```tsx
// components/Card.tsx
interface CardProps {
  children: React.ReactNode
  className?: string  // for layout overrides (max-w-sm, sticky top-8, etc.)
}

export function Card({ children, className }: CardProps)
```

`className` is appended to the base style, allowing per-use layout overrides without breaking the visual standard.

## Changes

| File | Change |
|---|---|
| `components/Card.tsx` | Create — new component |
| `components/ProfileForm.tsx:38` | Replace outer div with `<Card className="w-full max-w-sm">` |
| `components/AdminTheme.tsx:49` | Replace outer div with `<Card>` |
| `components/AdminMenuBuilder.tsx:211` | Replace outer div with `<Card className="sticky top-8">` |
| `components/AdminMenuBuilder.tsx:393` | No change — intentional dashed empty-state style |

## Out of Scope

- The dashed empty-state panel in `AdminMenuBuilder` (intentionally different)
- Menu item rows in `AdminMenuBuilder` (list items, not page cards)
- Login page card (different context — unauthenticated, centered full-screen)
