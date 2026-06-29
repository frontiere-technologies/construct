# RBAC Phase 1 — Roles & Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Roles & Permissions admin area (`/rolesPermissions`) — roles list, create/rename/delete, and a per-role permission editor — plus the shared `DataTable` + `NavigationTree` primitives.

**Architecture:** Server Components fetch via `createAdminClient()` and pass data to Client Components; reads are driven by URL search params (App Router); mutations are server actions in `lib/rbac/roles-actions.ts`, each calling `requireAdmin()`. The trickiest logic — permission cascade/delta and tree building — lives in pure, unit-tested functions in `lib/rbac/permission-tree.ts`.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Supabase (service_role) · Tailwind v4 · Vitest (unit) · Playwright + pytest (E2E). Builds on the completed Phase 0 foundation.

## Global Constraints

- All DB access server-side via `createAdminClient()`; RLS stays enabled on every table; new DB objects go in `sources/devops/db/schema.sql`, idempotent, applied to remote Supabase via the session MCP tools (`mcp__supabase__apply_migration` / `execute_sql`).
- Every server action calls `requireAdmin()` from `@/lib/rbac/auth-guard`.
- Reserved ids: `ROOT_ID = 0`, `OPERATIONS_ID = -1`; `ITEM_TYPE_CATEGORY = 1`, `ITEM_TYPE_FUNCTIONALITY = 2`; role types `SYSTEM=1, SERVICE=2, SYNCED=3` (constants/types in `lib/rbac/types.ts`).
- **Cascade semantics (DEC-P1-1):** category toggle → set it + all descendants; leaf grant → set it + auto-set all ancestor categories true; leaf revoke → set only the leaf.
- **`role_item` = the granted set (DEC-P1-4):** grants upsert `authorized=true`; revokes DELETE the row; `hasPermissions` = role has any `role_item` row.
- **Editability matrix (DEC-P1-8), enforced server-side AND in UI:** SYSTEM → no rename/perms/delete; SERVICE → all; SYNCED → perms+delete, name read-only. `createRole` always makes SERVICE (type 2).
- **Adapter orphan-drop (DEC-P1-2):** `mapNavigationToSidebar` drops any emitted item whose `parentId` is not in the emitted set.
- Data-only i18n: tree labels resolved via `item_translation[DEFAULT_LOCALE].name ?? name` (`DEFAULT_LOCALE='EN'`).
- Run `npx tsc --noEmit`, `npm run lint`, `npm run build` clean before the final commit of any `.ts/.tsx` task; pure-logic tasks also run `npm test`.
- Work from `sources/microservices/web-construct/` unless a path says otherwise. Repo root: `/Users/mario.stefanutti/mario/programming/github-frontiere/construct`.

---

## File Structure

**Created:**
- `lib/rbac/permission-tree.ts` — pure: `buildAuthTree`, `buildAuthMap`, `applyToggle`, `computeDeltas`.
- `lib/rbac/permission-tree.test.ts` — unit tests.
- `lib/rbac/roles-service.ts` — `listRoles`, `countRoles`, `getAllRoles`, `getRole`, `getRoleAuthorizationTree`.
- `lib/rbac/roles-actions.ts` — `createRole`, `renameRole`, `updateRolePermissions`, `deleteRole`.
- `components/rbac/DataTable.tsx` — generic controlled table.
- `components/rbac/NavigationTree.tsx` — generic recursive tree.
- `components/rbac/PermissionsTree.tsx` — toggle + local delta map over `NavigationTree`.
- `components/rbac/roles/RolesTableClient.tsx`, `CreateRoleModal.tsx`, `RenameRoleModal.tsx`, `RoleDetailClient.tsx`.
- `app/(protected)/rolesPermissions/page.tsx`, `app/(protected)/rolesPermissions/[roleId]/page.tsx`.

**Modified:**
- `lib/rbac/types.ts` — add DTOs/types.
- `lib/rbac/sidebar-adapter.ts` (+ `sidebar-adapter.test.ts`) — orphan-drop.
- `sources/devops/db/schema.sql` — add `role_list_view`.

**E2E:** `sources/tests/e2e/test_roles.py` (new).

---

## Task 1: Types & DTOs

**Files:**
- Modify: `lib/rbac/types.ts`

**Interfaces:**
- Produces: `RoleType`, `RolePageItemDto`, `RoleInformationDto`, `UserNavigationTreeDto`, `PermissionDelta`, `RolesQuery`, `RolesPage`.

- [x] ✅ **Step 1: Append types to `lib/rbac/types.ts`**

```ts
export type RoleType = 'SYSTEM' | 'SERVICE' | 'SYNCED'

export interface RolePageItemDto {
  id: number
  description: string
  associatedUsers: number
  hasPermissions: boolean
  dateIns: string | null
  dateMod: string | null
  roleType: RoleType
}

export interface RoleInformationDto {
  id: number
  roleName: string
  associatedUsersCount: number
  roleType: RoleType
}

export interface UserNavigationTreeDto {
  id: number
  name: string
  type: 'CATEGORY' | 'FUNCTIONALITY'
  parentId: number | null
  authorization: boolean
  children: UserNavigationTreeDto[]
}

export interface PermissionDelta {
  idItem: number
  authorization: boolean
}

export interface RolesQuery {
  page: number
  size: number
  search?: string
  sort?: 'id' | 'description' | 'associatedUsers' | 'dateIns' | 'dateMod'
  direction?: 'ASC' | 'DESC'
  hasPermission?: boolean
  startDateIns?: string
  endDateIns?: string
}

export interface RolesPage {
  pagination: { currentElements: number; currentPage: number; totalPages: number }
  elements: RolePageItemDto[]
}
```

- [x] ✅ **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → no new errors.
```bash
git add sources/microservices/web-construct/lib/rbac/types.ts
git commit -m "feat(rbac): add Phase 1 role DTOs and query types"
```

---

## Task 2: Sidebar adapter orphan-drop

**Files:**
- Modify: `lib/rbac/sidebar-adapter.ts`
- Test: `lib/rbac/sidebar-adapter.test.ts`

**Interfaces:**
- Consumes: existing `mapNavigationToSidebar(items, authorizedIds, locale?)`.
- Produces: same signature; output now excludes orphans (an item whose `parentId` is non-null and not among emitted ids).

- [x] ✅ **Step 1: Add the failing test** (append inside the existing `describe('mapNavigationToSidebar', …)` block in `sidebar-adapter.test.ts`)

```ts
  it('drops an item whose parent is not in the emitted set (orphan)', () => {
    // authorize a leaf (3, parent 2) but NOT its parent category (2)
    const result2 = mapNavigationToSidebar(items, new Set([3]))
    expect(result2.find(i => i.id === '3')).toBeUndefined()
  })
```

- [x] ✅ **Step 2: Run, expect fail**

Run: `npm test -- sidebar-adapter`
Expected: FAIL (item '3' is currently emitted with parentId '2' though 2 isn't emitted).

- [x] ✅ **Step 3: Add the orphan-drop pass**

In `lib/rbac/sidebar-adapter.ts`, replace the final `return out` of `mapNavigationToSidebar` with:
```ts
  const emitted = new Set(out.map(m => m.id))
  return out.filter(m => m.parentId === null || emitted.has(m.parentId))
```

- [x] ✅ **Step 4: Run, expect pass**

Run: `npm test -- sidebar-adapter`
Expected: PASS (all prior cases still pass; the new orphan case passes).

- [x] ✅ **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/sidebar-adapter.ts sources/microservices/web-construct/lib/rbac/sidebar-adapter.test.ts
git commit -m "fix(rbac): drop orphaned items in sidebar adapter (CARRY-1)"
```

---

## Task 3: Pure permission-tree logic

**Files:**
- Create: `lib/rbac/permission-tree.ts`
- Test: `lib/rbac/permission-tree.test.ts`

**Interfaces:**
- Consumes: `NavigationItemRow`, `UserNavigationTreeDto`, `PermissionDelta`, `Locale`, `DEFAULT_LOCALE`, `ITEM_TYPE_CATEGORY` from `./types`.
- Produces:
  - `buildAuthTree(items: NavigationItemRow[], authorizedIds: Set<number>, rootId: number, locale?: Locale): UserNavigationTreeDto[]`
  - `buildAuthMap(trees: UserNavigationTreeDto[]): Map<number, boolean>`
  - `applyToggle(trees: UserNavigationTreeDto[], map: Map<number, boolean>, itemId: number, on: boolean): Map<number, boolean>`
  - `computeDeltas(loaded: Map<number, boolean>, current: Map<number, boolean>): PermissionDelta[]`

- [x] ✅ **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildAuthTree, buildAuthMap, applyToggle, computeDeltas } from './permission-tree'
import type { NavigationItemRow, UserNavigationTreeDto } from './types'

const row = (id: number, parent: number | null, type: number, name: string): NavigationItemRow => ({
  id_item: id, name, id_item_type: type, id_functionality_type: type === 2 ? 3 : null,
  functionality_link: null, icon_path: null, id_item_parent: parent, order_position: id,
  navbar_position: null, item_translation: { EN: { name } }, is_immutable: 0,
  config_visibility: 0, no_permission_need_for_navigation: 0,
})

// root(0) > RBAC(2,cat) > Users(3,leaf), Funcs(4,leaf);  root(0) > Home(1,cat)
const items: NavigationItemRow[] = [
  row(0, null, 1, 'root'), row(1, 0, 1, 'Home'),
  row(2, 0, 1, 'RBAC'), row(3, 2, 2, 'Users'), row(4, 2, 2, 'Funcs'),
]

describe('buildAuthTree', () => {
  const trees = buildAuthTree(items, new Set([2, 3]), 0)
  it('builds children of the root, ordered, with authorization + label', () => {
    expect(trees.map(t => t.id)).toEqual([1, 2])
    const rbac = trees.find(t => t.id === 2)!
    expect(rbac.type).toBe('CATEGORY')
    expect(rbac.authorization).toBe(true)
    expect(rbac.children.map(c => c.id)).toEqual([3, 4])
    expect(rbac.children.find(c => c.id === 3)!.authorization).toBe(true)
    expect(rbac.children.find(c => c.id === 4)!.authorization).toBe(false)
    expect(rbac.name).toBe('RBAC')
  })
})

describe('buildAuthMap', () => {
  it('flattens authorization across all nodes', () => {
    const trees = buildAuthTree(items, new Set([2, 3]), 0)
    const map = buildAuthMap(trees)
    expect(map.get(2)).toBe(true)
    expect(map.get(3)).toBe(true)
    expect(map.get(4)).toBe(false)
    expect(map.get(1)).toBe(false)
  })
})

describe('applyToggle', () => {
  const trees = buildAuthTree(items, new Set(), 0)
  const base = buildAuthMap(trees)

  it('category ON sets it and all descendants', () => {
    const next = applyToggle(trees, base, 2, true)
    expect(next.get(2)).toBe(true)
    expect(next.get(3)).toBe(true)
    expect(next.get(4)).toBe(true)
  })
  it('category OFF clears it and all descendants', () => {
    const on = applyToggle(trees, base, 2, true)
    const off = applyToggle(trees, on, 2, false)
    expect(off.get(2)).toBe(false)
    expect(off.get(3)).toBe(false)
    expect(off.get(4)).toBe(false)
  })
  it('leaf ON auto-authorizes ancestor categories', () => {
    const next = applyToggle(trees, base, 3, true)
    expect(next.get(3)).toBe(true)
    expect(next.get(2)).toBe(true)   // ancestor
    expect(next.get(4)).toBe(false)  // sibling untouched
  })
  it('leaf OFF leaves ancestors untouched', () => {
    const on = applyToggle(trees, base, 3, true)   // 3 true, 2 true
    const off = applyToggle(trees, on, 3, false)
    expect(off.get(3)).toBe(false)
    expect(off.get(2)).toBe(true)    // ancestor stays
  })
  it('does not set the (out-of-tree) root id when walking ancestors', () => {
    const next = applyToggle(trees, base, 3, true)
    expect(next.has(0)).toBe(false)
  })
})

describe('computeDeltas', () => {
  it('returns only changed ids with their new value', () => {
    const loaded = new Map<number, boolean>([[2, true], [3, true], [4, false]])
    const current = new Map<number, boolean>([[2, true], [3, false], [4, true]])
    const deltas = computeDeltas(loaded, current).sort((a, b) => a.idItem - b.idItem)
    expect(deltas).toEqual([
      { idItem: 3, authorization: false },
      { idItem: 4, authorization: true },
    ])
  })
  it('no-op toggles produce no deltas', () => {
    const m = new Map<number, boolean>([[2, true]])
    expect(computeDeltas(m, new Map(m))).toEqual([])
  })
})
```

- [x] ✅ **Step 2: Run, expect fail**

Run: `npm test -- permission-tree`
Expected: FAIL (module missing).

- [x] ✅ **Step 3: Implement `lib/rbac/permission-tree.ts`**

```ts
import {
  type NavigationItemRow, type UserNavigationTreeDto, type PermissionDelta,
  type Locale, DEFAULT_LOCALE, ITEM_TYPE_CATEGORY,
} from './types'

function labelFor(it: NavigationItemRow, locale: Locale): string {
  return it.item_translation?.[locale]?.name ?? it.item_translation?.[DEFAULT_LOCALE]?.name ?? it.name ?? ''
}

export function buildAuthTree(
  items: NavigationItemRow[],
  authorizedIds: Set<number>,
  rootId: number,
  locale: Locale = DEFAULT_LOCALE,
): UserNavigationTreeDto[] {
  const childrenByParent = new Map<number | null, NavigationItemRow[]>()
  for (const it of items) {
    const arr = childrenByParent.get(it.id_item_parent) ?? []
    arr.push(it)
    childrenByParent.set(it.id_item_parent, arr)
  }
  const build = (parentId: number): UserNavigationTreeDto[] =>
    (childrenByParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.order_position - b.order_position)
      .map(it => ({
        id: it.id_item,
        name: labelFor(it, locale),
        type: it.id_item_type === ITEM_TYPE_CATEGORY ? 'CATEGORY' : 'FUNCTIONALITY',
        parentId: it.id_item_parent,
        authorization: authorizedIds.has(it.id_item),
        children: build(it.id_item),
      }))
  return build(rootId)
}

function indexTree(trees: UserNavigationTreeDto[]) {
  const byId = new Map<number, UserNavigationTreeDto>()
  const walk = (nodes: UserNavigationTreeDto[]) => {
    for (const n of nodes) { byId.set(n.id, n); walk(n.children) }
  }
  walk(trees)
  return byId
}

function descendantIds(node: UserNavigationTreeDto): number[] {
  const out: number[] = []
  const walk = (nodes: UserNavigationTreeDto[]) => {
    for (const n of nodes) { out.push(n.id); walk(n.children) }
  }
  walk(node.children)
  return out
}

export function buildAuthMap(trees: UserNavigationTreeDto[]): Map<number, boolean> {
  const map = new Map<number, boolean>()
  const byId = indexTree(trees)
  for (const [id, node] of byId) map.set(id, node.authorization)
  return map
}

export function applyToggle(
  trees: UserNavigationTreeDto[],
  map: Map<number, boolean>,
  itemId: number,
  on: boolean,
): Map<number, boolean> {
  const byId = indexTree(trees)
  const node = byId.get(itemId)
  const next = new Map(map)
  if (!node) return next

  if (node.type === 'CATEGORY') {
    next.set(itemId, on)
    for (const d of descendantIds(node)) next.set(d, on)
  } else {
    next.set(itemId, on)
    if (on) {
      let p = node.parentId
      while (p != null && byId.has(p)) {
        next.set(p, true)
        p = byId.get(p)!.parentId
      }
    }
  }
  return next
}

export function computeDeltas(
  loaded: Map<number, boolean>,
  current: Map<number, boolean>,
): PermissionDelta[] {
  const ids = new Set<number>([...loaded.keys(), ...current.keys()])
  const deltas: PermissionDelta[] = []
  for (const id of ids) {
    const was = loaded.get(id) ?? false
    const now = current.get(id) ?? false
    if (was !== now) deltas.push({ idItem: id, authorization: now })
  }
  return deltas
}
```

- [x] ✅ **Step 4: Run, expect pass**

Run: `npm test -- permission-tree`
Expected: PASS (all cases).

- [x] ✅ **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/permission-tree.ts sources/microservices/web-construct/lib/rbac/permission-tree.test.ts
git commit -m "feat(rbac): pure permission-tree cascade/delta logic"
```

---

## Task 4: Roles read-side service + role_list_view

**Files:**
- Modify: `sources/devops/db/schema.sql`
- Create: `lib/rbac/roles-service.ts`

**Interfaces:**
- Consumes: `createAdminClient`; `buildAuthTree` from `./permission-tree`; types from `./types`; `ROOT_ID`, `OPERATIONS_ID`.
- Produces:
  - `listRoles(query: RolesQuery): Promise<RolesPage>`
  - `countRoles(query: RolesQuery): Promise<number>`
  - `getAllRoles(roleTypes?: RoleType[]): Promise<{ id: number; description: string }[]>`
  - `getRole(roleId: number): Promise<RoleInformationDto>`
  - `getRoleAuthorizationTree(roleId: number, rootName: 'ROOT' | 'OPERATIONS'): Promise<UserNavigationTreeDto[]>`

- [x] ✅ **Step 1: Append `role_list_view` to `schema.sql`**

```sql
-- ============================================================
-- RBAC: role list view (counts for the roles table)
-- ============================================================
create or replace view role_list_view as
select
  r.id_role                                                            as id,
  r.description                                                        as description,
  rt.description                                                       as role_type,
  r.date_ins                                                           as date_ins,
  r.date_mod                                                           as date_mod,
  (select count(*) from user_role ur where ur.id_role = r.id_role)     as associated_users,
  exists(select 1 from role_item ri where ri.id_role = r.id_role)      as has_permissions
from role r
left join role_type rt on rt.id_role_type = r.id_role_type;
```

- [x] ✅ **Step 2: Apply to remote DB and verify**

Load tools: ToolSearch `select:mcp__supabase__apply_migration,mcp__supabase__execute_sql`. Apply the full `schema.sql` via `apply_migration` (name `rbac_phase1_role_list_view`). Then verify:
```sql
select id, description, role_type, associated_users, has_permissions
from role_list_view where id in (0,1,2) order by id;
```
Expected: rows for ids 0/1/2; role 1 (Administrator) `role_type=SYSTEM`, `has_permissions=true`. Paste into the report.

- [x] ✅ **Step 3: Implement `lib/rbac/roles-service.ts`**

```ts
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase-server'
import { buildAuthTree } from './permission-tree'
import {
  type RolesQuery, type RolesPage, type RolePageItemDto, type RoleInformationDto,
  type RoleType, type UserNavigationTreeDto, type NavigationItemRow,
  ROOT_ID, OPERATIONS_ID,
} from './types'

const NAV_COLUMNS =
  'id_item,name,id_item_type,id_functionality_type,functionality_link,icon_path,id_item_parent,order_position,navbar_position,item_translation,is_immutable,config_visibility,no_permission_need_for_navigation'

const SORT_COLUMN: Record<NonNullable<RolesQuery['sort']>, string> = {
  id: 'id', description: 'description', associatedUsers: 'associated_users',
  dateIns: 'date_ins', dateMod: 'date_mod',
}

function applyFilters<T extends { ilike: Function; eq: Function; gte: Function; lte: Function }>(q: T, query: RolesQuery): T {
  let r = q
  if (query.search) r = r.ilike('description', `%${query.search}%`) as T
  if (query.hasPermission) r = r.eq('has_permissions', true) as T
  if (query.startDateIns) r = r.gte('date_ins', query.startDateIns) as T
  if (query.endDateIns) r = r.lte('date_ins', query.endDateIns) as T
  return r
}

export const listRoles = cache(async (query: RolesQuery): Promise<RolesPage> => {
  const supabase = createAdminClient()
  const sortCol = SORT_COLUMN[query.sort ?? 'id']
  const ascending = (query.direction ?? 'ASC') === 'ASC'
  const from = query.page * query.size
  const to = from + query.size - 1

  let q = supabase.from('role_list_view').select('*', { count: 'exact' })
  q = applyFilters(q, query)
  const { data, error, count } = await q.order(sortCol, { ascending }).range(from, to)
  if (error) throw new Error(`Failed to list roles: ${error.message}`)

  const elements: RolePageItemDto[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    description: String(r.description ?? ''),
    associatedUsers: Number(r.associated_users ?? 0),
    hasPermissions: Boolean(r.has_permissions),
    dateIns: (r.date_ins as string) ?? null,
    dateMod: (r.date_mod as string) ?? null,
    roleType: (r.role_type as RoleType) ?? 'SERVICE',
  }))
  const total = count ?? 0
  return {
    pagination: {
      currentElements: elements.length,
      currentPage: query.page,
      totalPages: Math.max(1, Math.ceil(total / query.size)),
    },
    elements,
  }
})

export const countRoles = cache(async (query: RolesQuery): Promise<number> => {
  const supabase = createAdminClient()
  let q = supabase.from('role_list_view').select('id', { count: 'exact', head: true })
  q = applyFilters(q, query)
  const { count, error } = await q
  if (error) throw new Error(`Failed to count roles: ${error.message}`)
  return count ?? 0
})

export const getAllRoles = cache(async (roleTypes?: RoleType[]): Promise<{ id: number; description: string }[]> => {
  const supabase = createAdminClient()
  let q = supabase.from('role_list_view').select('id,description,role_type').order('description')
  if (roleTypes?.length) q = q.in('role_type', roleTypes)
  const { data, error } = await q
  if (error) throw new Error(`Failed to load roles: ${error.message}`)
  return (data ?? []).map((r: Record<string, unknown>) => ({ id: Number(r.id), description: String(r.description ?? '') }))
})

export const getRole = cache(async (roleId: number): Promise<RoleInformationDto> => {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('role_list_view').select('id,description,role_type,associated_users')
    .eq('id', roleId).single()
  if (error) throw new Error(`Failed to load role: ${error.message}`)
  return {
    id: Number(data.id),
    roleName: String(data.description ?? ''),
    associatedUsersCount: Number(data.associated_users ?? 0),
    roleType: (data.role_type as RoleType) ?? 'SERVICE',
  }
})

export const getRoleAuthorizationTree = cache(
  async (roleId: number, rootName: 'ROOT' | 'OPERATIONS'): Promise<UserNavigationTreeDto[]> => {
    const supabase = createAdminClient()
    const [{ data: navRows, error: navErr }, { data: riRows, error: riErr }] = await Promise.all([
      supabase.from('navigation_item').select(NAV_COLUMNS).order('order_position'),
      supabase.from('role_item').select('id_item,authorized').eq('id_role', roleId),
    ])
    if (navErr) throw new Error(`Failed to load navigation: ${navErr.message}`)
    if (riErr) throw new Error(`Failed to load permissions: ${riErr.message}`)
    const authorized = new Set<number>(
      (riRows ?? []).filter((r: { authorized: boolean }) => r.authorized).map((r: { id_item: number }) => r.id_item)
    )
    const rootId = rootName === 'ROOT' ? ROOT_ID : OPERATIONS_ID
    return buildAuthTree((navRows ?? []) as NavigationItemRow[], authorized, rootId)
  }
)
```

- [x] ✅ **Step 4: Typecheck & commit**

Run: `npx tsc --noEmit` → no new errors.
```bash
git add sources/devops/db/schema.sql sources/microservices/web-construct/lib/rbac/roles-service.ts
git commit -m "feat(rbac): roles read-side service + role_list_view"
```

---

## Task 5: Roles mutation actions

**Files:**
- Create: `lib/rbac/roles-actions.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/rbac/auth-guard`; `createAdminClient`; `PermissionDelta`, `RoleType` from `./types`.
- Produces (all server actions):
  - `createRole(roleName: string): Promise<{ id: number }>`
  - `renameRole(roleId: number, roleName: string): Promise<void>`
  - `updateRolePermissions(roleId: number, deltas: PermissionDelta[]): Promise<void>`
  - `deleteRole(roleId: number): Promise<void>`

- [x] ✅ **Step 1: Implement `lib/rbac/roles-actions.ts`**

```ts
'use server'

import { requireAdmin } from '@/lib/rbac/auth-guard'
import { createAdminClient } from '@/lib/supabase-server'
import type { PermissionDelta, RoleType } from './types'

const ROLE_TYPE_SERVICE = 2

async function getRoleType(supabase: ReturnType<typeof createAdminClient>, roleId: number): Promise<RoleType> {
  const { data, error } = await supabase
    .from('role').select('role_type:role_type(description)').eq('id_role', roleId).single()
  if (error) throw new Error(`Role not found: ${error.message}`)
  const desc = (data as { role_type?: { description?: string } })?.role_type?.description
  return (desc as RoleType) ?? 'SERVICE'
}

export async function createRole(roleName: string): Promise<{ id: number }> {
  await requireAdmin()
  const name = roleName.trim()
  if (!name) throw new Error('Role name is required')
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('role').insert({ description: name, id_role_type: ROLE_TYPE_SERVICE })
    .select('id_role').single()
  if (error) throw new Error(`Failed to create role: ${error.message}`)
  return { id: Number(data.id_role) }
}

export async function renameRole(roleId: number, roleName: string): Promise<void> {
  await requireAdmin()
  const name = roleName.trim()
  if (!name) throw new Error('Role name is required')
  const supabase = createAdminClient()
  if (await getRoleType(supabase, roleId) !== 'SERVICE') throw new Error('This role cannot be renamed')
  const { error } = await supabase.from('role').update({ description: name }).eq('id_role', roleId)
  if (error) throw new Error(`Failed to rename role: ${error.message}`)
}

export async function updateRolePermissions(roleId: number, deltas: PermissionDelta[]): Promise<void> {
  await requireAdmin()
  const supabase = createAdminClient()
  if (await getRoleType(supabase, roleId) === 'SYSTEM') throw new Error('System roles cannot be edited')

  const grants = deltas.filter(d => d.authorization).map(d => ({ id_role: roleId, id_item: d.idItem, authorized: true }))
  const revokeIds = deltas.filter(d => !d.authorization).map(d => d.idItem)

  if (grants.length) {
    const { error } = await supabase.from('role_item').upsert(grants, { onConflict: 'id_role,id_item' })
    if (error) throw new Error(`Failed to grant permissions: ${error.message}`)
  }
  if (revokeIds.length) {
    const { error } = await supabase.from('role_item').delete().eq('id_role', roleId).in('id_item', revokeIds)
    if (error) throw new Error(`Failed to revoke permissions: ${error.message}`)
  }
}

export async function deleteRole(roleId: number): Promise<void> {
  await requireAdmin()
  const supabase = createAdminClient()
  if (await getRoleType(supabase, roleId) === 'SYSTEM') throw new Error('System roles cannot be deleted')
  const { error } = await supabase.from('role').delete().eq('id_role', roleId)
  if (error) throw new Error(`Failed to delete role: ${error.message}`)
}
```

- [x] ✅ **Step 2: Typecheck**

Run: `npx tsc --noEmit` → no new errors. (If the `role_type:role_type(description)` embedded-select typing is awkward, the `as` casts above handle it; do not change the query shape.)

- [x] ✅ **Step 3: Verify the SERVICE/SYSTEM guards against the live DB**

Load `mcp__supabase__execute_sql`. Confirm role 1 is SYSTEM (so guards will fire) and there are no SERVICE seeds yet:
```sql
select r.id_role, r.description, rt.description as role_type
from role r join role_type rt on rt.id_role_type = r.id_role_type order by r.id_role;
```
Expected: ids 0,1,2 all SYSTEM. (Functional create/rename/delete behavior is covered by E2E in Task 11.) Paste into the report.

- [x] ✅ **Step 4: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/roles-actions.ts
git commit -m "feat(rbac): role create/rename/updatePermissions/delete actions"
```

---

## Task 6: DataTable primitive

**Files:**
- Create: `components/rbac/DataTable.tsx`

**Interfaces:**
- Produces: `DataTable<T>` (default export) + exported `Column<T>` type.
  - `Column<T> = { key: string; header: string; sortable?: boolean; render?: (row: T) => React.ReactNode }`
  - Props: `{ columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number; sort?: { field: string; direction: 'ASC' | 'DESC' }; onSortChange?: (field: string) => void; page: number; totalPages: number; onPageChange: (page: number) => void; search: string; onSearchChange: (v: string) => void; filtersSlot?: React.ReactNode; actionButton?: React.ReactNode; rowMenu?: (row: T) => { label: string; onClick: () => void; disabled?: boolean }[]; onRowClick?: (row: T) => void }`

- [x] ✅ **Step 1: Implement `components/rbac/DataTable.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { Search, SlidersHorizontal, Columns3, MoreHorizontal, ChevronUp, ChevronDown, ChevronRight } from 'lucide-react'

export interface Column<T> {
  key: string
  header: string
  sortable?: boolean
  render?: (row: T) => React.ReactNode
}

interface RowMenuItem { label: string; onClick: () => void; disabled?: boolean }

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  sort?: { field: string; direction: 'ASC' | 'DESC' }
  onSortChange?: (field: string) => void
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  search: string
  onSearchChange: (v: string) => void
  filtersSlot?: React.ReactNode
  actionButton?: React.ReactNode
  rowMenu?: (row: T) => RowMenuItem[]
  onRowClick?: (row: T) => void
}

export default function DataTable<T>(props: DataTableProps<T>) {
  const { columns, rows, rowKey, sort, onSortChange, page, totalPages, onPageChange,
    search, onSearchChange, filtersSlot, actionButton, rowMenu, onRowClick } = props
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [showCols, setShowCols] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [openMenu, setOpenMenu] = useState<string | number | null>(null)

  const visibleCols = columns.filter(c => !hidden.has(c.key))
  const toggleCol = (key: string) =>
    setHidden(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  const pages: (number | '…')[] = []
  for (let i = 0; i < totalPages; i++) {
    if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1) pages.push(i)
    else if (pages[pages.length - 1] !== '…') pages.push('…')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Cerca"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowCols(s => !s)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700">
              <Columns3 size={16} /> Colonne
            </button>
            {showCols && (
              <div className="absolute right-0 mt-1 z-20 w-48 p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow">
                {columns.map(c => (
                  <label key={c.key} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleCol(c.key)} />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
          {filtersSlot && (
            <button onClick={() => setShowFilters(s => !s)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700">
              <SlidersHorizontal size={16} /> Filtri
            </button>
          )}
          {actionButton}
        </div>
      </div>

      {showFilters && filtersSlot && (
        <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">{filtersSlot}</div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-white">
            <tr>
              {visibleCols.map(c => (
                <th key={c.key} className="text-left font-medium px-4 py-3">
                  <button
                    disabled={!c.sortable}
                    onClick={() => c.sortable && onSortChange?.(c.key)}
                    className={`flex items-center gap-1 ${c.sortable ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    {c.header}
                    {c.sortable && sort?.field === c.key && (sort.direction === 'ASC' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                </th>
              ))}
              {rowMenu && <th className="w-10 px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const k = rowKey(row)
              return (
                <tr
                  key={k}
                  onClick={() => onRowClick?.(row)}
                  className={`border-t border-gray-100 dark:border-gray-800 ${onRowClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50' : ''}`}
                >
                  {visibleCols.map(c => (
                    <td key={c.key} className="px-4 py-3">{c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}</td>
                  ))}
                  {rowMenu && (
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="relative">
                        <button data-testid="row-menu" onClick={() => setOpenMenu(openMenu === k ? null : k)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                          <MoreHorizontal size={16} />
                        </button>
                        {openMenu === k && (
                          <div className="absolute right-0 mt-1 z-20 w-40 p-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow">
                            {rowMenu(row).map(item => (
                              <button
                                key={item.label}
                                disabled={item.disabled}
                                onClick={() => { setOpenMenu(null); item.onClick() }}
                                className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center gap-1">
        {pages.map((p, i) => p === '…'
          ? <span key={`e${i}`} className="px-2 text-gray-400">…</span>
          : <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`min-w-8 h-8 px-2 rounded-lg text-sm ${p === page ? 'bg-gray-900 text-white' : 'border border-gray-200 dark:border-gray-700'}`}
            >{p + 1}</button>
        )}
        <button
          onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
          className="min-w-8 h-8 px-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40"
        ><ChevronRight size={16} /></button>
      </div>
    </div>
  )
}
```

- [x] ✅ **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → no new errors. (Behavior verified via the list page + E2E in later tasks.)
```bash
git add sources/microservices/web-construct/components/rbac/DataTable.tsx
git commit -m "feat(rbac): generic controlled DataTable primitive"
```

---

## Task 7: NavigationTree primitive

**Files:**
- Create: `components/rbac/NavigationTree.tsx`

**Interfaces:**
- Consumes: `UserNavigationTreeDto` from `@/lib/rbac/types`.
- Produces: `NavigationTree` (default export).
  - Props: `{ nodes: UserNavigationTreeDto[]; renderTrailing?: (node: UserNavigationTreeDto) => React.ReactNode; expandedByDefault?: boolean }`

- [x] ✅ **Step 1: Implement `components/rbac/NavigationTree.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

interface NavigationTreeProps {
  nodes: UserNavigationTreeDto[]
  renderTrailing?: (node: UserNavigationTreeDto) => React.ReactNode
  expandedByDefault?: boolean
}

interface RowProps {
  node: UserNavigationTreeDto
  depth: number
  renderTrailing?: (node: UserNavigationTreeDto) => React.ReactNode
  expandedByDefault: boolean
}

const TreeRow: React.FC<RowProps> = ({ node, depth, renderTrailing, expandedByDefault }) => {
  const isCategory = node.type === 'CATEGORY'
  const hasChildren = node.children.length > 0
  const [open, setOpen] = useState(expandedByDefault)

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2.5 px-3 border-b border-gray-100 dark:border-gray-800"
        style={{ paddingLeft: 12 + depth * 24 }}
      >
        {isCategory && hasChildren ? (
          <button data-testid="tree-toggle" onClick={() => setOpen(o => !o)} className="p-0.5 text-gray-500">
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <span className={`flex-1 text-sm ${isCategory ? 'font-medium' : ''}`}>{node.name}</span>
        {renderTrailing?.(node)}
      </div>
      {hasChildren && open && node.children.map(c => (
        <TreeRow key={c.id} node={c} depth={depth + 1} renderTrailing={renderTrailing} expandedByDefault={expandedByDefault} />
      ))}
    </div>
  )
}

export default function NavigationTree({ nodes, renderTrailing, expandedByDefault = true }: NavigationTreeProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800">
      {nodes.map(n => (
        <TreeRow key={n.id} node={n} depth={0} renderTrailing={renderTrailing} expandedByDefault={expandedByDefault} />
      ))}
    </div>
  )
}
```

- [x] ✅ **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → no new errors.
```bash
git add sources/microservices/web-construct/components/rbac/NavigationTree.tsx
git commit -m "feat(rbac): generic NavigationTree primitive"
```

---

## Task 8: PermissionsTree component

**Files:**
- Create: `components/rbac/PermissionsTree.tsx`

**Interfaces:**
- Consumes: `NavigationTree`; `applyToggle`, `buildAuthMap` from `@/lib/rbac/permission-tree`; `UserNavigationTreeDto` from `@/lib/rbac/types`.
- Produces: `PermissionsTree` (default export).
  - Props: `{ trees: UserNavigationTreeDto[]; map: Map<number, boolean>; onChange: (next: Map<number, boolean>) => void; editable: boolean }`
  - The parent owns the `map` state (so it can compute deltas across both root tabs and reset on cancel).

- [x] ✅ **Step 1: Implement `components/rbac/PermissionsTree.tsx`**

```tsx
'use client'

import React from 'react'
import NavigationTree from './NavigationTree'
import { applyToggle } from '@/lib/rbac/permission-tree'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

interface PermissionsTreeProps {
  trees: UserNavigationTreeDto[]
  map: Map<number, boolean>
  onChange: (next: Map<number, boolean>) => void
  editable: boolean
}

const Toggle: React.FC<{ on: boolean; disabled: boolean; onToggle: () => void }> = ({ on, disabled, onToggle }) => (
  <button
    data-testid="perm-toggle"
    role="switch"
    aria-checked={on}
    disabled={disabled}
    onClick={onToggle}
    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${on ? 'bg-gray-900 dark:bg-primary' : 'bg-gray-300 dark:bg-gray-600'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
  >
    <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-1'}`} />
  </button>
)

export default function PermissionsTree({ trees, map, onChange, editable }: PermissionsTreeProps) {
  return (
    <NavigationTree
      nodes={trees}
      renderTrailing={node => (
        <Toggle
          on={map.get(node.id) ?? false}
          disabled={!editable}
          onToggle={() => onChange(applyToggle(trees, map, node.id, !(map.get(node.id) ?? false)))}
        />
      )}
    />
  )
}
```

- [x] ✅ **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → no new errors.
```bash
git add sources/microservices/web-construct/components/rbac/PermissionsTree.tsx
git commit -m "feat(rbac): PermissionsTree toggle component"
```

---

## Task 9: Roles list page + modals

**Files:**
- Create: `components/rbac/roles/CreateRoleModal.tsx`
- Create: `components/rbac/roles/RenameRoleModal.tsx`
- Create: `components/rbac/roles/RolesTableClient.tsx`
- Create: `app/(protected)/rolesPermissions/page.tsx`

**Interfaces:**
- Consumes: `listRoles`, `getAllRoles` from `@/lib/rbac/roles-service`; `createRole`, `renameRole`, `deleteRole` from `@/lib/rbac/roles-actions`; `DataTable`; types.
- Produces: the `/rolesPermissions` route.

- [x] ✅ **Step 1: `CreateRoleModal.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRole } from '@/lib/rbac/roles-actions'

export default function CreateRoleModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const { id } = await createRole(name)
      router.push(`/rolesPermissions/${id}`)
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-2">Crea nuovo ruolo</h2>
        <p className="text-sm text-gray-500 mb-4">Per procedere con la creazione di un nuovo ruolo, inserisci il nome del ruolo desiderato</p>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Nome ruolo"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 mb-6"
        />
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="text-sm font-medium">Annulla</button>
          <button
            onClick={submit} disabled={!name.trim() || busy}
            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >Crea nuovo ruolo</button>
        </div>
      </div>
    </div>
  )
}
```

- [x] ✅ **Step 2: `RenameRoleModal.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { renameRole } from '@/lib/rbac/roles-actions'

export default function RenameRoleModal({ roleId, currentName, onClose }: { roleId: number; currentName: string; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState(currentName)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try { await renameRole(roleId, name); router.refresh(); onClose() }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">Rinomina ruolo</h2>
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Nome ruolo"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 mb-6"
        />
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="text-sm font-medium">Annulla</button>
          <button onClick={submit} disabled={!name.trim() || busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40">Salva</button>
        </div>
      </div>
    </div>
  )
}
```

- [x] ✅ **Step 3: `RolesTableClient.tsx`** (URL-driven state; the page re-renders on searchParam changes)

```tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import DataTable, { type Column } from '@/components/rbac/DataTable'
import CreateRoleModal from './CreateRoleModal'
import RenameRoleModal from './RenameRoleModal'
import { deleteRole } from '@/lib/rbac/roles-actions'
import type { RolePageItemDto } from '@/lib/rbac/types'

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface Props {
  rows: RolePageItemDto[]
  page: number
  totalPages: number
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  hasPermission: boolean
}

export default function RolesTableClient(props: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [search, setSearch] = useState(props.search)
  const [showCreate, setShowCreate] = useState(false)
  const [renaming, setRenaming] = useState<RolePageItemDto | null>(null)

  const setParam = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(updates)) v === null ? next.delete(k) : next.set(k, v)
    router.push(`/rolesPermissions?${next.toString()}`)
  }, [params, router])

  // Debounced search → URL
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== props.search) setParam({ search: search || null, page: '0' })
    }, 350)
    return () => clearTimeout(t)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSort = (field: string) => {
    const dir = props.sortField === field && props.sortDir === 'ASC' ? 'DESC' : 'ASC'
    setParam({ sort: field, direction: dir })
  }

  const columns: Column<RolePageItemDto>[] = [
    { key: 'id', header: 'ID', sortable: true },
    { key: 'description', header: 'Nome ruolo', sortable: true, render: r => <span className="font-medium">{r.description}</span> },
    { key: 'associatedUsers', header: 'Utenti associati', sortable: true },
    { key: 'hasPermissions', header: 'Ha permessi', render: r => (
        <span className={`px-2 py-0.5 rounded-full text-xs ${r.hasPermissions ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {r.hasPermissions ? 'Sì' : 'No'}
        </span>
      ) },
    { key: 'dateIns', header: 'Data di creazione', sortable: true, render: r => fmtDate(r.dateIns) },
    { key: 'dateMod', header: 'Ultimo aggiornamento', sortable: true, render: r => fmtDate(r.dateMod) },
  ]

  const filters = (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox" checked={props.hasPermission}
        onChange={e => setParam({ hasPermission: e.target.checked ? 'true' : null, page: '0' })}
      />
      Ha permessi
    </label>
  )

  return (
    <>
      <DataTable
        columns={columns}
        rows={props.rows}
        rowKey={r => r.id}
        sort={{ field: props.sortField, direction: props.sortDir }}
        onSortChange={onSort}
        page={props.page}
        totalPages={props.totalPages}
        onPageChange={p => setParam({ page: String(p) })}
        search={search}
        onSearchChange={setSearch}
        filtersSlot={filters}
        actionButton={<button onClick={() => setShowCreate(true)} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Nuovo ruolo</button>}
        onRowClick={r => router.push(`/rolesPermissions/${r.id}`)}
        rowMenu={r => [
          { label: 'Rinomina', disabled: r.roleType !== 'SERVICE', onClick: () => setRenaming(r) },
          { label: 'Elimina', disabled: r.roleType === 'SYSTEM', onClick: async () => {
              if (confirm(`Eliminare il ruolo "${r.description}"?`)) { await deleteRole(r.id); router.refresh() }
            } },
        ]}
      />
      {showCreate && <CreateRoleModal onClose={() => setShowCreate(false)} />}
      {renaming && <RenameRoleModal roleId={renaming.id} currentName={renaming.description} onClose={() => setRenaming(null)} />}
    </>
  )
}
```

- [x] ✅ **Step 4: `app/(protected)/rolesPermissions/page.tsx`**

```tsx
import { listRoles } from '@/lib/rbac/roles-service'
import RolesTableClient from '@/components/rbac/roles/RolesTableClient'
import type { RolesQuery } from '@/lib/rbac/types'

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const query: RolesQuery = {
    page: Number(sp.page ?? '0'),
    size: 10,
    search: sp.search,
    sort: (sp.sort as RolesQuery['sort']) ?? 'id',
    direction: (sp.direction as 'ASC' | 'DESC') ?? 'ASC',
    hasPermission: sp.hasPermission === 'true' || undefined,
  }
  const { elements, pagination } = await listRoles(query)

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Ruoli &amp; permessi</h1>
      <RolesTableClient
        rows={elements}
        page={pagination.currentPage}
        totalPages={pagination.totalPages}
        sortField={query.sort ?? 'id'}
        sortDir={query.direction ?? 'ASC'}
        search={query.search ?? ''}
        hasPermission={Boolean(query.hasPermission)}
      />
    </div>
  )
}
```

- [x] ✅ **Step 5: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean; `/rolesPermissions` appears in the route list.

- [x] ✅ **Step 6: Commit**

```bash
git add "sources/microservices/web-construct/app/(protected)/rolesPermissions/page.tsx" sources/microservices/web-construct/components/rbac/roles/
git commit -m "feat(rbac): roles list page with create/rename/delete"
```

---

## Task 10: Role detail page

**Files:**
- Create: `components/rbac/roles/RoleDetailClient.tsx`
- Create: `app/(protected)/rolesPermissions/[roleId]/page.tsx`

**Interfaces:**
- Consumes: `getRole`, `getRoleAuthorizationTree` from `@/lib/rbac/roles-service`; `updateRolePermissions` from `@/lib/rbac/roles-actions`; `PermissionsTree`; `buildAuthMap`, `computeDeltas` from `@/lib/rbac/permission-tree`; `RenameRoleModal`; types.
- Produces: the `/rolesPermissions/[roleId]` route.

- [x] ✅ **Step 1: `RoleDetailClient.tsx`**

```tsx
'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import PermissionsTree from '@/components/rbac/PermissionsTree'
import RenameRoleModal from './RenameRoleModal'
import { buildAuthMap, computeDeltas } from '@/lib/rbac/permission-tree'
import { updateRolePermissions } from '@/lib/rbac/roles-actions'
import type { RoleInformationDto, UserNavigationTreeDto } from '@/lib/rbac/types'

interface Props {
  role: RoleInformationDto
  sezioniTree: UserNavigationTreeDto[]
  operazioniTree: UserNavigationTreeDto[]
}

export default function RoleDetailClient({ role, sezioniTree, operazioniTree }: Props) {
  const router = useRouter()
  const allTrees = useMemo(() => [...sezioniTree, ...operazioniTree], [sezioniTree, operazioniTree])
  const loaded = useMemo(() => buildAuthMap(allTrees), [allTrees])

  const [tab, setTab] = useState<'sezioni' | 'operazioni'>('sezioni')
  const [editing, setEditing] = useState(false)
  const [map, setMap] = useState<Map<number, boolean>>(loaded)
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState(false)

  const isSystem = role.roleType === 'SYSTEM'
  const canRename = role.roleType === 'SERVICE'

  const startEdit = () => { setMap(new Map(loaded)); setEditing(true) }
  const cancel = () => { setMap(new Map(loaded)); setEditing(false) }
  const save = async () => {
    setBusy(true)
    try {
      const deltas = computeDeltas(loaded, map)
      if (deltas.length) await updateRolePermissions(role.id, deltas)
      setEditing(false)
      router.refresh()
    } finally { setBusy(false) }
  }

  const trees = tab === 'sezioni' ? sezioniTree : operazioniTree

  return (
    <div className="max-w-5xl mx-auto">
      <div className="text-sm text-gray-500 mb-2">Ruoli &amp; permessi / Dettagli</div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">#{role.id} {role.roleName}</h1>
            {canRename && (
              <button onClick={() => setRenaming(true)} className="text-gray-400 hover:text-gray-700"><Pencil size={18} /></button>
            )}
          </div>
          <p className="text-sm text-gray-500">{role.associatedUsersCount} Utenti associati</p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={cancel} className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700">Annulla</button>
              <button onClick={save} disabled={busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40">Salva</button>
            </>
          ) : (
            <button
              onClick={startEdit} disabled={isSystem}
              title={isSystem ? 'I ruoli di sistema non sono modificabili' : undefined}
              className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >Modifica</button>
          )}
        </div>
      </div>

      <div className="flex gap-6 border-b border-gray-200 dark:border-gray-800 mb-4">
        {(['sezioni', 'operazioni'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-gray-900 text-gray-900 dark:text-white dark:border-white' : 'border-transparent text-gray-500'}`}
          >{t === 'sezioni' ? 'Sezioni' : 'Operazioni'}</button>
        ))}
      </div>

      <PermissionsTree trees={trees} map={map} onChange={setMap} editable={editing} />

      {renaming && <RenameRoleModal roleId={role.id} currentName={role.roleName} onClose={() => setRenaming(false)} />}
    </div>
  )
}
```

- [x] ✅ **Step 2: `app/(protected)/rolesPermissions/[roleId]/page.tsx`**

```tsx
import { getRole, getRoleAuthorizationTree } from '@/lib/rbac/roles-service'
import RoleDetailClient from '@/components/rbac/roles/RoleDetailClient'

export default async function RoleDetailPage({ params }: { params: Promise<{ roleId: string }> }) {
  const { roleId } = await params
  const id = Number(roleId)
  const [role, sezioniTree, operazioniTree] = await Promise.all([
    getRole(id),
    getRoleAuthorizationTree(id, 'ROOT'),
    getRoleAuthorizationTree(id, 'OPERATIONS'),
  ])
  return <RoleDetailClient role={role} sezioniTree={sezioniTree} operazioniTree={operazioniTree} />
}
```

- [x] ✅ **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean; `/rolesPermissions/[roleId]` appears in the route list.

- [x] ✅ **Step 4: Commit**

```bash
git add "sources/microservices/web-construct/app/(protected)/rolesPermissions/[roleId]/page.tsx" sources/microservices/web-construct/components/rbac/roles/RoleDetailClient.tsx
git commit -m "feat(rbac): role detail page with PermissionsTree editor"
```

---

## Task 11: E2E tests & browser verification

**Files:**
- Create: `sources/tests/e2e/test_roles.py`

**Prerequisites:** dev server running with `AUTH_TEST_CREDENTIALS=true`; `.env.test` has `TEST_EMAIL` (admin). Start (from `sources/microservices/web-construct/`): `AUTH_TEST_CREDENTIALS=true npm run dev`, wait until `http://localhost:3000/login` returns 200.

- [x] ✅ **Step 1: Write `sources/tests/e2e/test_roles.py`**

```python
import time


def test_roles_list_loads(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/rolesPermissions")
    page.wait_for_load_state("networkidle")
    assert page.get_by_text("Ruoli & permessi").first.is_visible()
    # Administrator (id 1) is seeded and must appear
    assert page.get_by_text("Administrator", exact=True).first.is_visible()


def test_create_rename_delete_role(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/rolesPermissions")
    page.wait_for_load_state("networkidle")

    name = f"E2E Role {int(time.time())}"
    page.get_by_role("button", name="Nuovo ruolo").click()
    page.get_by_placeholder("Nome ruolo").fill(name)
    page.get_by_role("button", name="Crea nuovo ruolo").click()
    # Redirects to the detail page of the new SERVICE role
    page.wait_for_url("**/rolesPermissions/**", timeout=10_000)
    assert name in page.inner_text("h1")

    # Rename via the pencil (SERVICE roles are renamable)
    renamed = name + " R"
    page.locator("h1").get_by_role("button").click()
    page.get_by_placeholder("Nome ruolo").fill(renamed)
    page.get_by_role("button", name="Salva").click()
    page.wait_for_load_state("networkidle")
    assert renamed in page.inner_text("h1")

    # Back to list, delete it
    page.goto(f"{base_url}/rolesPermissions?search={renamed.replace(' ', '%20')}")
    page.wait_for_load_state("networkidle")
    page.locator('[data-testid="row-menu"]').first.click()
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Elimina").click()
    page.wait_for_timeout(1000)
    page.reload()
    page.wait_for_load_state("networkidle")
    assert renamed not in page.content()


def test_toggle_permission_persists(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E Perm {int(time.time())}"
    page.goto(f"{base_url}/rolesPermissions")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Nuovo ruolo").click()
    page.get_by_placeholder("Nome ruolo").fill(name)
    page.get_by_role("button", name="Crea nuovo ruolo").click()
    page.wait_for_url("**/rolesPermissions/**", timeout=10_000)
    detail_url = page.url

    page.get_by_role("button", name="Modifica").click()
    page.locator('[data-testid="perm-toggle"]').first.click()
    page.get_by_role("button", name="Salva").click()
    page.wait_for_load_state("networkidle")

    # Reload: at least one toggle must be ON (aria-checked=true)
    page.goto(detail_url)
    page.wait_for_load_state("networkidle")
    assert page.locator('[data-testid="perm-toggle"][aria-checked="true"]').count() >= 1


def test_system_role_not_editable(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/rolesPermissions/1")  # Administrator = SYSTEM
    page.wait_for_load_state("networkidle")
    edit = page.get_by_role("button", name="Modifica")
    assert edit.is_disabled()
```

- [x] ✅ **Step 2: Run the roles E2E**

Run (repo root): `HEADLESS=true uv run pytest sources/tests/e2e/test_roles.py -v`
Expected: all 4 tests PASS.

- [x] ✅ **Step 3: Run the full E2E suite (no regressions)**

Run: `HEADLESS=true uv run pytest sources/tests/e2e -v`
Expected: all PASS (Phase 0 suite + new roles tests).

- [x] ✅ **Step 4: Browser verification**

Manually (or with `webapp-testing`): open `/rolesPermissions`, confirm the table (sort a column, toggle a filter, paginate if >10 roles); open a SERVICE role, enter Modifica, toggle a category and confirm its children flip (cascade), Salva, reload, confirm persisted; confirm Administrator shows Modifica disabled.

- [x] ✅ **Step 5: Commit**

```bash
git add sources/tests/e2e/test_roles.py
git commit -m "test(e2e): roles list, create/rename/delete, permission toggle, system-locked"
```

---

## Self-Review (completed during planning)

**Spec coverage (spec → task):**
- DTOs/types (spec §6) → Task 1. ✓
- Cascade semantics DEC-P1-1 + pure logic DEC-P1-9 (spec §3) → Task 3. ✓
- Adapter orphan-drop DEC-P1-2 (spec §3.1) → Task 2. ✓
- `role_item` granted-set DEC-P1-4, editability DEC-P1-8 (spec §4) → Task 5. ✓
- Read-side: listRoles/countRoles/getAllRoles/getRole/getRoleAuthorizationTree (spec §4) → Task 4. ✓
- DataTable controlled DEC-P1-6 (spec §2.1) → Task 6. ✓
- NavigationTree generic, no DnD DEC-P1-7 (spec §2.2) → Task 7. ✓
- PermissionsTree (spec §2/§5.2) → Task 8. ✓
- List page + create/rename/delete (spec §5.1) → Task 9. ✓
- Detail page + tabs + edit/save (spec §5.2) → Task 10. ✓
- Strictly-gated non-admin DEC-P1-3 → no change required (no task; documented). ✓
- Testing (spec §7) → Tasks 2,3 (unit) + Task 11 (E2E + browser). ✓

**Placeholder scan:** none — every code/SQL/test step is complete.

**Type consistency:** `RolesQuery`/`RolesPage`/`RolePageItemDto`/`RoleInformationDto`/`UserNavigationTreeDto`/`PermissionDelta` defined in Task 1 and used identically in Tasks 4/5/8/9/10. `buildAuthTree`/`buildAuthMap`/`applyToggle`/`computeDeltas` signatures defined in Task 3 match their use in Tasks 4/8/10. `DataTable`/`Column` props (Task 6) match the use in Task 9. `NavigationTree` props (Task 7) match Task 8. `getRoleAuthorizationTree(id,'ROOT'|'OPERATIONS')` (Task 4) matches Task 10.
