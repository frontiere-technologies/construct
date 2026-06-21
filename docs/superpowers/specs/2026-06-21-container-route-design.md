# Design: Route/URL for Container Menu Items

**Date:** 2026-06-21
**Status:** Approved

## Problem

Container menu items (type `container`) cannot have a Route/URL in the Admin Menu Builder. The field is hidden behind a `type === 'link'` guard. Admins who want a Container to act as both a navigable link and a group header (with children) have no way to configure it.

## Goal

Allow Container items to optionally have a Route/URL. When a Container with a route is clicked in the sidebar, it navigates to the route **and** opens the children panel simultaneously.

## Non-Goals

- No changes to the `MenuItem` type or database schema — `route` and `target` are already optional fields on all items.
- No changes to `handleL1Click`, `handleL2Click`, active-highlight logic, or any other Sidebar state management.
- No visual differentiation (e.g. link icon) to indicate a Container has a route — the existing active-state highlight suffices.

## Data Model

`MenuItem` in `types/menu.ts` already has:

```ts
route?: string;
target?: '_blank' | '_self';
```

These fields are type-agnostic — no schema change needed.

## Changes

### 1. `apps/web/components/AdminMenuBuilder.tsx`

Remove the `editingItem.type === 'link'` condition that wraps the **Route / URL** and **Open In** fields. Both fields become visible for `link` and `container` types alike.

Before (pseudo):
```tsx
{editingItem.type === 'link' && <RouteField />}
{editingItem.type === 'link' && <OpenInField />}
```

After:
```tsx
<RouteField />
<OpenInField />
```

No changes to save/upsert logic — `upsertMenuItem` already persists `route` and `target` for all item types.

### 2. `apps/web/components/Sidebar.tsx` — `L1Item`

**Current condition** (line 70):
```tsx
if (!hasChildren && item.route) { ... render <Link> ... }
```

**New condition:**
```tsx
if (item.route) { ... render <Link> ... }
```

`<Link>` keeps `onClick={onClick}` (which is `handleL1Click`). When the Container has children, `handleL1Click` opens the col2 panel; Next.js navigation happens in parallel via the `<Link>`. When the Container has no children, behavior is identical to a link item.

### 3. `apps/web/components/Sidebar.tsx` — `SubItem`

**Current logic:**
```
hasChildren → <button onClick={onContainerClick}>
item.route  → <Link>
otherwise   → <div>
```

**New logic:**
```
hasChildren && item.route → <Link onClick={onContainerClick}>  (navigates + toggles col3)
hasChildren only          → <button onClick={onContainerClick}>  (unchanged)
item.route only           → <Link>                               (unchanged)
otherwise                 → <div>                                (unchanged)
```

The `hasChildren && item.route` branch must be checked first.

## Behavior Summary

| Container config        | Click action in col1/col2        |
|------------------------|----------------------------------|
| No route, has children | Opens children panel (unchanged) |
| Route, no children     | Navigates (already worked)       |
| Route, has children    | Navigates + opens children panel |
| No route, no children  | No action (unchanged)            |

## Files Changed

1. `apps/web/components/AdminMenuBuilder.tsx` — 2 conditional blocks removed
2. `apps/web/components/Sidebar.tsx` — `L1Item` and `SubItem` rendering logic updated

## Testing

- Admin Menu Builder: create/edit a Container item, verify Route/URL and Open In fields appear and save correctly.
- Sidebar: Container with route + children → clicking navigates and opens col2/col3.
- Sidebar: Container with route, no children → clicking navigates (regression check).
- Sidebar: Container without route, with children → clicking only opens panel (regression check).
- Active-state highlighting: navigating to a Container's route highlights it correctly.
