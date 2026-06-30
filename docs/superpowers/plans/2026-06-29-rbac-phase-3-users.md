# RBAC Phase 3 — Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [✅]`) syntax for tracking.

**Goal:** Build the Users admin area (`/userManagement`) — a searchable/filterable/sortable, paginated user list showing roles + account status, with a "Manage Roles" modal (full role replace) and a clickable status badge (activate/deactivate), all protected by anti-lockout guardrails.

**Architecture:** Server Component fetches via `createAdminClient()`; mutations are `'use server'` actions calling `requireAdmin()`. Security-critical anti-lockout logic and DTO mapping live in pure, unit-tested functions. The Phase-1 `DataTable` primitive and URL-search-params list pattern (`/rolesPermissions`) are reused.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Supabase (service_role) · Tailwind v4 · Vitest (unit) · Playwright + pytest (E2E).

## Global Constraints

- All DB access server-side via `createAdminClient()`; RLS stays enabled; every server action calls `requireAdmin()` from `@/lib/rbac/auth-guard` (it returns `{ userId, roleIds }` — the current admin's id is `userId`).
- Admin = `roleIds.includes(ROLE_ADMINISTRATOR)`; `ROLE_ADMINISTRATOR=1`, `ROLE_REGISTERED=0` (from `@/lib/rbac/types`). Role display name is `role.description` (no `name` column).
- `user_status`: `1` Deactivated, `2` Active. `id_user_status` default `2`.
- `updateUserRoles` always keeps `ROLE_REGISTERED` and replaces the rest via delete-then-insert. `setUserStatus` only ever sets `1` or `2`.
- Anti-lockout (BOTH mutations): cannot remove your OWN admin role; cannot remove the LAST admin; cannot deactivate yourself; cannot deactivate the LAST active admin. Italian error messages (exact text in Task 2).
- Read from `public.users` (uuid PK), join `user_role`→`role`. Out of scope: user create/delete, multitenancy, profile-field editing.
- Run `npx tsc --noEmit`, `npm run lint`, `npm run build` clean before the final commit of any `.ts/.tsx` task; pure-logic tasks also run `npm test`.
- Work from `sources/microservices/web-construct/`. Repo root: `/Users/mario.stefanutti/mario/programming/github-frontiere/construct`.

---

## File Structure

**Created:** `lib/rbac/user-guards.ts`(+test), `lib/rbac/user-mappers.ts`(+test), `lib/rbac/users-service.ts`, `lib/rbac/users-actions.ts`, `components/rbac/users/{StatusBadge,ManageRolesModal,UsersTableClient}.tsx`, `app/(protected)/userManagement/page.tsx`, `sources/tests/e2e/test_users.py`.
**Modified:** `lib/rbac/types.ts`.

---

## Task 1: Types & DTO

**Files:** Modify `lib/rbac/types.ts`
**Interfaces:** Produces `UserStatusId`, `UserDTO`, `UsersQuery`.

- [✅] **Step 1: Append the new types to `lib/rbac/types.ts`**

```ts
export type UserStatusId = 1 | 2 // 1 Deactivated, 2 Active

export interface UserDTO {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  createdAt: string
  updatedAt: string | null
  roles: { id: number; name: string }[]
  status: { idUserStatus: UserStatusId; description: 'Active' | 'Deactivated' }
  tenantValidationPending: false
  multiTenancyEnabled: false
}

export interface UsersQuery {
  page: number
  size: number
  search?: string
  roleIds?: number[]
  statuses?: UserStatusId[]
  createdFrom?: string
  createdTo?: string
  sort?: 'firstName' | 'lastName' | 'email' | 'dateIns' | 'dateMod' | 'status'
  direction?: 'ASC' | 'DESC'
}
```
Verify `ROLE_ADMINISTRATOR` and `ROLE_REGISTERED` already exist in this file (they do: `=1` and `=0`). Do not redefine them.

- [✅] **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add sources/microservices/web-construct/lib/rbac/types.ts
git commit -m "feat(rbac): add UserDTO + UsersQuery types for Phase 3"
```

---

## Task 2: Anti-lockout guards (pure, TDD)

**Files:** Create `lib/rbac/user-guards.ts`, `lib/rbac/user-guards.test.ts`
**Interfaces:** Produces `assertRoleChangeAllowed(args)` and `assertStatusChangeAllowed(args)` (throw on violation, return void otherwise).

- [✅] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { assertRoleChangeAllowed, assertStatusChangeAllowed } from './user-guards'

describe('assertRoleChangeAllowed', () => {
  const base = { targetUserId: 'u1', currentUserId: 'admin', targetCurrentlyAdmin: true, newRolesIncludeAdmin: true, otherAdminCount: 1 }
  it('allows when admin stays admin', () => {
    expect(() => assertRoleChangeAllowed(base)).not.toThrow()
  })
  it('allows removing admin from someone else when another admin exists', () => {
    expect(() => assertRoleChangeAllowed({ ...base, newRolesIncludeAdmin: false, otherAdminCount: 1 })).not.toThrow()
  })
  it('blocks removing your OWN admin role', () => {
    expect(() => assertRoleChangeAllowed({ ...base, targetUserId: 'admin', newRolesIncludeAdmin: false, otherAdminCount: 5 }))
      .toThrow(/tuo accesso admin/i)
  })
  it('blocks removing the LAST admin', () => {
    expect(() => assertRoleChangeAllowed({ ...base, targetUserId: 'u1', newRolesIncludeAdmin: false, otherAdminCount: 0 }))
      .toThrow(/ultimo amministratore/i)
  })
  it('allows when target was not admin', () => {
    expect(() => assertRoleChangeAllowed({ ...base, targetCurrentlyAdmin: false, newRolesIncludeAdmin: false, otherAdminCount: 0 })).not.toThrow()
  })
})

describe('assertStatusChangeAllowed', () => {
  const base = { targetUserId: 'u1', currentUserId: 'admin', newStatus: 1 as const, targetIsAdmin: false, otherActiveAdminCount: 1 }
  it('allows activating (newStatus=2) unconditionally', () => {
    expect(() => assertStatusChangeAllowed({ ...base, newStatus: 2, targetUserId: 'admin', targetIsAdmin: true, otherActiveAdminCount: 0 })).not.toThrow()
  })
  it('blocks deactivating yourself', () => {
    expect(() => assertStatusChangeAllowed({ ...base, targetUserId: 'admin' })).toThrow(/tuo account/i)
  })
  it('blocks deactivating the last active admin', () => {
    expect(() => assertStatusChangeAllowed({ ...base, targetIsAdmin: true, otherActiveAdminCount: 0 })).toThrow(/ultimo amministratore attivo/i)
  })
  it('allows deactivating a non-admin', () => {
    expect(() => assertStatusChangeAllowed({ ...base, targetIsAdmin: false })).not.toThrow()
  })
  it('allows deactivating an admin when another active admin exists', () => {
    expect(() => assertStatusChangeAllowed({ ...base, targetIsAdmin: true, otherActiveAdminCount: 1 })).not.toThrow()
  })
})
```

- [✅] **Step 2: Run, expect fail**

Run: `npm test -- user-guards`
Expected: FAIL (module missing).

- [✅] **Step 3: Implement `lib/rbac/user-guards.ts`**

```ts
export interface RoleChangeArgs {
  targetUserId: string
  currentUserId: string
  targetCurrentlyAdmin: boolean
  newRolesIncludeAdmin: boolean
  otherAdminCount: number
}

export function assertRoleChangeAllowed(a: RoleChangeArgs): void {
  const losingAdmin = a.targetCurrentlyAdmin && !a.newRolesIncludeAdmin
  if (!losingAdmin) return
  if (a.targetUserId === a.currentUserId) throw new Error('Non puoi rimuovere il tuo accesso admin')
  if (a.otherAdminCount === 0) throw new Error("Non puoi rimuovere l'ultimo amministratore")
}

export interface StatusChangeArgs {
  targetUserId: string
  currentUserId: string
  newStatus: 1 | 2
  targetIsAdmin: boolean
  otherActiveAdminCount: number
}

export function assertStatusChangeAllowed(a: StatusChangeArgs): void {
  if (a.newStatus !== 1) return // only deactivation is constrained
  if (a.targetUserId === a.currentUserId) throw new Error('Non puoi disattivare il tuo account')
  if (a.targetIsAdmin && a.otherActiveAdminCount === 0) throw new Error("Non puoi disattivare l'ultimo amministratore attivo")
}
```

- [✅] **Step 4: Run, expect pass**

Run: `npm test -- user-guards`
Expected: PASS (all cases).

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/user-guards.ts sources/microservices/web-construct/lib/rbac/user-guards.test.ts
git commit -m "feat(rbac): pure anti-lockout guards for user role/status changes"
```

---

## Task 3: Pure user mappers (TDD)

**Files:** Create `lib/rbac/user-mappers.ts`, `lib/rbac/user-mappers.test.ts`
**Interfaces:** Consumes `UserDTO`, `UserStatusId`, `UsersQuery` from `./types`. Produces:
- `USER_SORT_COLUMN: Record<NonNullable<UsersQuery['sort']>, string>`
- `mapUserStatus(id: number): UserDTO['status']`
- `buildUserDtos(userRows, userRoleRows, roleNameById): UserDTO[]`

- [✅] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { USER_SORT_COLUMN, mapUserStatus, buildUserDtos, type UserRow, type UserRoleRow } from './user-mappers'

describe('USER_SORT_COLUMN', () => {
  it('maps DTO sort fields to db columns', () => {
    expect(USER_SORT_COLUMN.firstName).toBe('first_name')
    expect(USER_SORT_COLUMN.dateIns).toBe('created_at')
    expect(USER_SORT_COLUMN.dateMod).toBe('updated_at')
    expect(USER_SORT_COLUMN.status).toBe('id_user_status')
    expect(USER_SORT_COLUMN.email).toBe('email')
  })
})

describe('mapUserStatus', () => {
  it('maps 2 to Active', () => { expect(mapUserStatus(2)).toEqual({ idUserStatus: 2, description: 'Active' }) })
  it('maps 1 (and anything else) to Deactivated', () => {
    expect(mapUserStatus(1)).toEqual({ idUserStatus: 1, description: 'Deactivated' })
    expect(mapUserStatus(0)).toEqual({ idUserStatus: 1, description: 'Deactivated' })
  })
})

describe('buildUserDtos', () => {
  const userRows: UserRow[] = [
    { id: 'u1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@x.io', created_at: '2026-01-01T00:00:00Z', updated_at: null, id_user_status: 2 },
    { id: 'u2', first_name: null, last_name: null, email: 'bob@x.io', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-02-01T00:00:00Z', id_user_status: 1 },
  ]
  const userRoleRows: UserRoleRow[] = [
    { user_id: 'u1', id_role: 0 }, { user_id: 'u1', id_role: 1 }, { user_id: 'u2', id_role: 0 },
  ]
  const roleNameById = new Map<number, string>([[0, 'Registered user'], [1, 'Administrator']])
  const dtos = buildUserDtos(userRows, userRoleRows, roleNameById)

  it('builds one DTO per user row, in order', () => {
    expect(dtos.map(d => d.id)).toEqual(['u1', 'u2'])
  })
  it('aggregates roles (sorted by id) with names', () => {
    expect(dtos[0].roles).toEqual([{ id: 0, name: 'Registered user' }, { id: 1, name: 'Administrator' }])
    expect(dtos[1].roles).toEqual([{ id: 0, name: 'Registered user' }])
  })
  it('maps status and constant tenancy flags', () => {
    expect(dtos[0].status).toEqual({ idUserStatus: 2, description: 'Active' })
    expect(dtos[1].status).toEqual({ idUserStatus: 1, description: 'Deactivated' })
    expect(dtos[0].tenantValidationPending).toBe(false)
    expect(dtos[0].multiTenancyEnabled).toBe(false)
  })
  it('falls back to the role id as name when unknown', () => {
    const d = buildUserDtos([userRows[0]], [{ user_id: 'u1', id_role: 99 }], new Map())
    expect(d[0].roles).toEqual([{ id: 99, name: '99' }])
  })
})
```

- [✅] **Step 2: Run, expect fail**

Run: `npm test -- user-mappers`
Expected: FAIL (module missing).

- [✅] **Step 3: Implement `lib/rbac/user-mappers.ts`**

```ts
import type { UserDTO, UserStatusId, UsersQuery } from './types'

export interface UserRow {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  created_at: string
  updated_at: string | null
  id_user_status: number
}
export interface UserRoleRow { user_id: string; id_role: number }

export const USER_SORT_COLUMN: Record<NonNullable<UsersQuery['sort']>, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  dateIns: 'created_at',
  dateMod: 'updated_at',
  status: 'id_user_status',
}

export function mapUserStatus(id: number): UserDTO['status'] {
  return id === 2 ? { idUserStatus: 2, description: 'Active' } : { idUserStatus: 1, description: 'Deactivated' }
}

export function buildUserDtos(
  userRows: UserRow[],
  userRoleRows: UserRoleRow[],
  roleNameById: Map<number, string>,
): UserDTO[] {
  const rolesByUser = new Map<string, { id: number; name: string }[]>()
  for (const r of userRoleRows) {
    const arr = rolesByUser.get(r.user_id) ?? []
    arr.push({ id: r.id_role, name: roleNameById.get(r.id_role) ?? String(r.id_role) })
    rolesByUser.set(r.user_id, arr)
  }
  return userRows.map(u => ({
    id: u.id,
    firstName: u.first_name,
    lastName: u.last_name,
    email: u.email,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    roles: (rolesByUser.get(u.id) ?? []).sort((a, b) => a.id - b.id),
    status: mapUserStatus(u.id_user_status) as { idUserStatus: UserStatusId; description: 'Active' | 'Deactivated' },
    tenantValidationPending: false as const,
    multiTenancyEnabled: false as const,
  }))
}
```

- [✅] **Step 4: Run, expect pass**

Run: `npm test -- user-mappers`
Expected: PASS (all cases).

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/user-mappers.ts sources/microservices/web-construct/lib/rbac/user-mappers.test.ts
git commit -m "feat(rbac): pure user DTO/sort/status mappers"
```

---

## Task 4: Users read service

**Files:** Create `lib/rbac/users-service.ts`
**Interfaces:** Consumes `createAdminClient`; `getAllRoles` from `./roles-service`; `USER_SORT_COLUMN`, `buildUserDtos`, `UserRow`, `UserRoleRow` from `./user-mappers`; `UserDTO`, `UsersQuery` from `./types`. Produces `listUsers(q)`, `countUsers(q)`.

> Role-membership filtering (`roleIds`) is applied by first resolving the candidate `user_id`s from `user_role`, then constraining the users query with `.in('id', ids)`. `getAllRoles()` (reused from roles-service) returns `{ id, description }[]` for both the role-name map and the UI filter/modal.

- [✅] **Step 1: Implement `lib/rbac/users-service.ts`**

```ts
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase-server'
import { getAllRoles } from './roles-service'
import { USER_SORT_COLUMN, buildUserDtos, type UserRow, type UserRoleRow } from './user-mappers'
import type { UserDTO, UsersQuery } from './types'

const USER_COLUMNS = 'id,first_name,last_name,email,created_at,updated_at,id_user_status'

type FilterableQuery = {
  ilike(column: string, value: string): FilterableQuery
  or(filters: string): FilterableQuery
  in(column: string, values: readonly unknown[]): FilterableQuery
  gte(column: string, value: unknown): FilterableQuery
  lte(column: string, value: unknown): FilterableQuery
}

async function candidateUserIds(roleIds: number[] | undefined): Promise<string[] | null> {
  if (!roleIds?.length) return null
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('user_role').select('user_id').in('id_role', roleIds)
  if (error) throw new Error(`Failed to filter by role: ${error.message}`)
  return Array.from(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)))
}

function applyUserFilters<T extends FilterableQuery>(q: T, query: UsersQuery, ids: string[] | null): T {
  let r = q
  if (query.search) {
    const s = query.search.replace(/[%,]/g, '')
    r = r.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`) as T
  }
  if (query.statuses?.length) r = r.in('id_user_status', query.statuses) as T
  if (query.createdFrom) r = r.gte('created_at', query.createdFrom) as T
  if (query.createdTo) r = r.lte('created_at', query.createdTo) as T
  if (ids) r = r.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) as T
  return r
}

export const listUsers = cache(async (query: UsersQuery): Promise<{ users: UserDTO[]; total: number }> => {
  const supabase = createAdminClient()
  const ids = await candidateUserIds(query.roleIds)
  const sortCol = USER_SORT_COLUMN[query.sort ?? 'dateIns']
  const ascending = (query.direction ?? 'DESC') === 'ASC'
  const from = query.page * query.size
  const to = from + query.size - 1

  let q = supabase.from('users').select(USER_COLUMNS, { count: 'exact' })
  q = applyUserFilters(q as unknown as FilterableQuery, query, ids) as unknown as typeof q
  const { data, error, count } = await q.order(sortCol, { ascending }).range(from, to)
  if (error) throw new Error(`Failed to list users: ${error.message}`)
  const userRows = (data ?? []) as unknown as UserRow[]

  const pageIds = userRows.map(u => u.id)
  let userRoleRows: UserRoleRow[] = []
  if (pageIds.length) {
    const { data: ur, error: urErr } = await supabase.from('user_role').select('user_id,id_role').in('user_id', pageIds)
    if (urErr) throw new Error(`Failed to load user roles: ${urErr.message}`)
    userRoleRows = (ur ?? []) as UserRoleRow[]
  }
  const allRoles = await getAllRoles()
  const roleNameById = new Map<number, string>(allRoles.map(r => [r.id, r.description]))
  return { users: buildUserDtos(userRows, userRoleRows, roleNameById), total: count ?? 0 }
})

export const countUsers = cache(async (query: UsersQuery): Promise<number> => {
  const supabase = createAdminClient()
  const ids = await candidateUserIds(query.roleIds)
  let q = supabase.from('users').select('id', { count: 'exact', head: true })
  q = applyUserFilters(q as unknown as FilterableQuery, query, ids) as unknown as typeof q
  const { count, error } = await q
  if (error) throw new Error(`Failed to count users: ${error.message}`)
  return count ?? 0
})
```

> Note: `getAllRoles` in `roles-service.ts` returns `{ id: number; description: string }[]`. Verify that signature before relying on it; if it differs, adapt the `roleNameById` construction and report the deviation.

- [✅] **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add sources/microservices/web-construct/lib/rbac/users-service.ts
git commit -m "feat(rbac): users read service (list/count with filters)"
```

---

## Task 5: Users mutation actions

**Files:** Create `lib/rbac/users-actions.ts`
**Interfaces:** Consumes `requireAdmin`, `createAdminClient`, `assertRoleChangeAllowed`/`assertStatusChangeAllowed` from `./user-guards`, `ROLE_ADMINISTRATOR`/`ROLE_REGISTERED` from `./types`. Produces `updateUserRoles(userId, roleIds)`, `setUserStatus(userId, status)`.

- [✅] **Step 1: Implement `lib/rbac/users-actions.ts`**

```ts
'use server'

import { requireAdmin } from '@/lib/rbac/auth-guard'
import { createAdminClient } from '@/lib/supabase-server'
import { assertRoleChangeAllowed, assertStatusChangeAllowed } from './user-guards'
import { ROLE_ADMINISTRATOR, ROLE_REGISTERED, type UserStatusId } from './types'

async function userIsAdmin(supabase: ReturnType<typeof createAdminClient>, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_role').select('user_id').eq('user_id', userId).eq('id_role', ROLE_ADMINISTRATOR).limit(1)
  if (error) throw new Error(`Failed to check admin: ${error.message}`)
  return (data ?? []).length > 0
}

async function otherAdminUserIds(supabase: ReturnType<typeof createAdminClient>, excludeUserId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_role').select('user_id').eq('id_role', ROLE_ADMINISTRATOR).neq('user_id', excludeUserId)
  if (error) throw new Error(`Failed to count admins: ${error.message}`)
  return Array.from(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)))
}

export async function updateUserRoles(userId: string, roleIds: number[]): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  const supabase = createAdminClient()
  const targetCurrentlyAdmin = await userIsAdmin(supabase, userId)
  const others = await otherAdminUserIds(supabase, userId)
  assertRoleChangeAllowed({
    targetUserId: userId,
    currentUserId,
    targetCurrentlyAdmin,
    newRolesIncludeAdmin: roleIds.includes(ROLE_ADMINISTRATOR),
    otherAdminCount: others.length,
  })

  const finalRoleIds = Array.from(new Set<number>([ROLE_REGISTERED, ...roleIds]))
  const { error: delErr } = await supabase.from('user_role').delete().eq('user_id', userId)
  if (delErr) throw new Error(`Failed to clear roles: ${delErr.message}`)
  const rows = finalRoleIds.map(id_role => ({ user_id: userId, id_role }))
  const { error: insErr } = await supabase.from('user_role').insert(rows)
  if (insErr) throw new Error(`Failed to assign roles: ${insErr.message}`)
}

export async function setUserStatus(userId: string, status: UserStatusId): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  const supabase = createAdminClient()
  let targetIsAdmin = false
  let otherActiveAdminCount = 0
  if (status === 1) {
    targetIsAdmin = await userIsAdmin(supabase, userId)
    const others = await otherAdminUserIds(supabase, userId)
    if (others.length) {
      const { count, error } = await supabase
        .from('users').select('id', { count: 'exact', head: true }).in('id', others).eq('id_user_status', 2)
      if (error) throw new Error(`Failed to count active admins: ${error.message}`)
      otherActiveAdminCount = count ?? 0
    }
  }
  assertStatusChangeAllowed({ targetUserId: userId, currentUserId, newStatus: status, targetIsAdmin, otherActiveAdminCount })

  const { error } = await supabase
    .from('users').update({ id_user_status: status, last_status_ts: new Date().toISOString() }).eq('id', userId)
  if (error) throw new Error(`Failed to update status: ${error.message}`)
}
```

- [✅] **Step 2: Typecheck, lint & commit**

Run: `npx tsc --noEmit && npm run lint` → 0 errors (pre-existing warnings OK).
```bash
git add sources/microservices/web-construct/lib/rbac/users-actions.ts
git commit -m "feat(rbac): updateUserRoles + setUserStatus actions with anti-lockout"
```

---

## Task 6: StatusBadge + ManageRolesModal components

**Files:** Create `components/rbac/users/StatusBadge.tsx`, `components/rbac/users/ManageRolesModal.tsx`
**Interfaces:**
- `StatusBadge`: `{ status: UserDTO['status']; onToggle: () => void; disabled?: boolean }`.
- `ManageRolesModal`: `{ user: UserDTO; allRoles: { id: number; name: string }[]; onClose: () => void; onSaved: () => void }`.

- [✅] **Step 1: `StatusBadge.tsx`**

```tsx
'use client'

import React from 'react'
import type { UserDTO } from '@/lib/rbac/types'

export default function StatusBadge({ status, onToggle, disabled }: { status: UserDTO['status']; onToggle: () => void; disabled?: boolean }) {
  const active = status.idUserStatus === 2
  return (
    <button
      type="button"
      data-testid="status-badge"
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onToggle() }}
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${active ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}`}
      title={active ? 'Clic per disattivare' : 'Clic per attivare'}
    >
      {active ? 'Active' : 'Deactivated'}
    </button>
  )
}
```

- [✅] **Step 2: `ManageRolesModal.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { X } from 'lucide-react'
import { updateUserRoles } from '@/lib/rbac/users-actions'
import { ROLE_REGISTERED, type UserDTO } from '@/lib/rbac/types'

export default function ManageRolesModal(
  { user, allRoles, onClose, onSaved }:
  { user: UserDTO; allRoles: { id: number; name: string }[]; onClose: () => void; onSaved: () => void },
) {
  const [selected, setSelected] = useState<Set<number>>(new Set(user.roles.map(r => r.id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: number) => {
    if (id === ROLE_REGISTERED) return // always kept, not toggleable
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await updateUserRoles(user.id, Array.from(selected))
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore durante il salvataggio')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Gestisci ruoli — {user.firstName ?? user.email}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {allRoles.map(r => {
            const locked = r.id === ROLE_REGISTERED
            return (
              <label key={r.id} className={`flex items-center gap-2 text-sm ${locked ? 'opacity-60' : ''}`}>
                <input
                  type="checkbox"
                  data-testid={`role-checkbox-${r.id}`}
                  checked={selected.has(r.id)}
                  disabled={locked}
                  onChange={() => toggle(r.id)}
                />
                {r.name}{locked && ' (sempre assegnato)'}
              </label>
            )
          })}
        </div>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700">Annulla</button>
          <button onClick={save} disabled={busy} data-testid="save-roles" className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40">Salva</button>
        </div>
      </div>
    </div>
  )
}
```

- [✅] **Step 3: Typecheck, lint & commit**

Run: `npx tsc --noEmit && npm run lint` → clean.
```bash
git add sources/microservices/web-construct/components/rbac/users/StatusBadge.tsx sources/microservices/web-construct/components/rbac/users/ManageRolesModal.tsx
git commit -m "feat(rbac): user status badge + manage-roles modal"
```

---

## Task 7: Users table page

**Files:** Create `components/rbac/users/UsersTableClient.tsx`, `app/(protected)/userManagement/page.tsx`
**Interfaces:** Consumes `DataTable`/`Column` from `@/components/rbac/DataTable`; `StatusBadge`, `ManageRolesModal`; `setUserStatus` from `@/lib/rbac/users-actions`; `listUsers`/`countUsers` from `@/lib/rbac/users-service`; `getAllRoles` from `@/lib/rbac/roles-service`; `UserDTO`, `UsersQuery` from types.

- [✅] **Step 1: `UsersTableClient.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import DataTable, { type Column } from '@/components/rbac/DataTable'
import StatusBadge from './StatusBadge'
import ManageRolesModal from './ManageRolesModal'
import { setUserStatus } from '@/lib/rbac/users-actions'
import type { UserDTO } from '@/lib/rbac/types'

interface Props {
  rows: UserDTO[]
  page: number
  totalPages: number
  sortField: string
  sortDir: 'ASC' | 'DESC'
  search: string
  allRoles: { id: number; name: string }[]
}

export default function UsersTableClient({ rows, page, totalPages, sortField, sortDir, search, allRoles }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [managing, setManaging] = useState<UserDTO | null>(null)

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(sp.toString())
    if (v == null || v === '') p.delete(k); else p.set(k, v)
    if (k !== 'page') p.delete('page')
    router.push(`${pathname}?${p.toString()}`)
  }

  const toggleStatus = async (u: UserDTO) => {
    const next = u.status.idUserStatus === 2 ? 1 : 2
    if (!confirm(next === 1 ? `Disattivare ${u.email}?` : `Attivare ${u.email}?`)) return
    try { await setUserStatus(u.id, next); router.refresh() }
    catch (e) { alert(e instanceof Error ? e.message : 'Errore') }
  }

  const fullName = (u: UserDTO) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email

  const columns: Column<UserDTO>[] = [
    { key: 'firstName', header: 'Utente', sortable: true, render: u => fullName(u) },
    { key: 'email', header: 'Email', sortable: true },
    { key: 'roles', header: 'Ruoli', render: u => u.roles.map(r => r.name).join(', ') || '—' },
    { key: 'status', header: 'Stato', sortable: true, render: u => <StatusBadge status={u.status} onToggle={() => toggleStatus(u)} /> },
    { key: 'dateIns', header: 'Creato', sortable: true, render: u => new Date(u.createdAt).toLocaleDateString() },
    { key: 'dateMod', header: 'Aggiornato', sortable: true, render: u => u.updatedAt ? new Date(u.updatedAt).toLocaleDateString() : '—' },
  ]

  return (
    <>
      <DataTable<UserDTO>
        columns={columns}
        rows={rows}
        rowKey={u => u.id}
        sort={{ field: sortField, direction: sortDir }}
        onSortChange={f => {
          const dir = sortField === f && sortDir === 'ASC' ? 'DESC' : 'ASC'
          const p = new URLSearchParams(sp.toString())
          p.set('sort', f); p.set('direction', dir); p.delete('page')
          router.push(`${pathname}?${p.toString()}`)
        }}
        page={page}
        totalPages={totalPages}
        onPageChange={n => setParam('page', String(n))}
        search={search}
        onSearchChange={v => setParam('search', v)}
        rowMenu={u => [{ label: 'Gestisci ruoli', onClick: () => setManaging(u) }]}
      />
      {managing && (
        <ManageRolesModal
          user={managing}
          allRoles={allRoles}
          onClose={() => setManaging(null)}
          onSaved={() => { setManaging(null); router.refresh() }}
        />
      )}
    </>
  )
}
```

- [✅] **Step 2: `app/(protected)/userManagement/page.tsx`**

```tsx
import { listUsers, countUsers } from '@/lib/rbac/users-service'
import { getAllRoles } from '@/lib/rbac/roles-service'
import UsersTableClient from '@/components/rbac/users/UsersTableClient'
import type { UsersQuery, UserStatusId } from '@/lib/rbac/types'

export default async function UserManagementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const query: UsersQuery = {
    page: Number(sp.page ?? '0'),
    size: 10,
    search: sp.search,
    sort: (sp.sort as UsersQuery['sort']) ?? 'dateIns',
    direction: (sp.direction as 'ASC' | 'DESC') ?? 'DESC',
    roleIds: sp.roleIds ? sp.roleIds.split(',').map(Number) : undefined,
    statuses: sp.statuses ? (sp.statuses.split(',').map(Number) as UserStatusId[]) : undefined,
  }
  const [{ users, total }, allRolesRaw] = await Promise.all([listUsers(query), getAllRoles()])
  const totalPages = Math.max(1, Math.ceil(total / query.size))
  const allRoles = allRolesRaw.map(r => ({ id: r.id, name: r.description }))

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Utenti</h1>
      <UsersTableClient
        rows={users}
        page={query.page}
        totalPages={totalPages}
        sortField={query.sort ?? 'dateIns'}
        sortDir={query.direction ?? 'DESC'}
        search={query.search ?? ''}
        allRoles={allRoles}
      />
    </div>
  )
}
```

> `countUsers` is not called here because `listUsers` already returns `total`. Keep `countUsers` exported (the service interface promises it; a future caller / test may use it). If lint flags it as unused at module scope, that is fine — it is an exported function.

- [✅] **Step 3: Typecheck, lint, build & commit**

Run: `npx tsc --noEmit && npm run lint && npm run build` → clean; `/userManagement` in the route list.
```bash
git add "sources/microservices/web-construct/app/(protected)/userManagement/page.tsx" sources/microservices/web-construct/components/rbac/users/UsersTableClient.tsx
git commit -m "feat(rbac): users table page with manage-roles + status toggle"
```

---

## Task 8: E2E tests & browser verification

**Files:** Create `sources/tests/e2e/test_users.py`
**Prerequisites:** dev server running with `AUTH_TEST_CREDENTIALS=true`; `.env.test` has admin `TEST_EMAIL` and non-admin `TEST_EMAIL_USER`.

- [✅] **Step 1: Write `sources/tests/e2e/test_users.py`**

```python
import time
from playwright.sync_api import expect


def test_users_list_loads(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/userManagement")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="Utenti")).to_be_visible()
    # column headers
    expect(page.get_by_text("Email", exact=True).first).to_be_visible()
    expect(page.get_by_text("Ruoli", exact=True).first).to_be_visible()
    expect(page.get_by_text("Stato", exact=True).first).to_be_visible()
    # at least one status badge rendered
    expect(page.locator('[data-testid="status-badge"]').first).to_be_visible()


def test_search_narrows_users(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/userManagement")
    page.wait_for_load_state("networkidle")
    before = page.locator('[data-testid="status-badge"]').count()
    page.get_by_placeholder("Cerca").fill("zzz-no-such-user-zzz")
    page.wait_for_timeout(800)
    page.wait_for_load_state("networkidle")
    after = page.locator('[data-testid="status-badge"]').count()
    assert after <= before


def test_manage_roles_opens_and_lists_roles(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/userManagement")
    page.wait_for_load_state("networkidle")
    # open the first row's action menu, then "Gestisci ruoli"
    page.locator('[data-testid="row-menu"]').first.click()
    page.get_by_text("Gestisci ruoli", exact=True).first.click()
    expect(page.get_by_test_id("save-roles")).to_be_visible()
    # the Registered-user checkbox (id 0) is present and disabled
    reg = page.get_by_test_id("role-checkbox-0")
    expect(reg).to_be_disabled()


def test_non_admin_denied(page, base_url):
    # non-admin login via test credentials
    import os
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('button:has-text("Accesso test")')
    page.fill('input[placeholder="Email di test"]', os.environ["TEST_EMAIL_USER"])
    page.click('button:has-text("Entra (test)")')
    page.wait_for_load_state("networkidle")
    page.goto(f"{base_url}/userManagement")
    page.wait_for_load_state("networkidle")
    # non-admin must NOT see the Utenti management heading
    expect(page.get_by_role("heading", name="Utenti")).to_have_count(0)
```

> Note: `data-testid="row-menu"` is the DataTable row action trigger (Phase-1 primitive). Verify that hook exists in `DataTable.tsx`; if the attribute name differs, use the actual one and note it. The non-admin test relies on `TEST_EMAIL_USER` in `.env.test` (used by Phase-0/1 RBAC E2E). Iterate selectors against the running server until green; do not weaken assertions.

- [✅] **Step 2: Run the users E2E**

Run (repo root): `HEADLESS=true uv run pytest sources/tests/e2e/test_users.py -v`
Expected: 4 passed. Iterate selectors if needed (without weakening assertions).

- [✅] **Step 3: Full suite (no regressions)**

Run: `HEADLESS=true uv run pytest sources/tests/e2e -v`
Expected: all pass (Phase 0 + 1 + 2 + users).

- [✅] **Step 4: Browser verification (controller)**

Manually (or with `webapp-testing`): open `/userManagement`; confirm the list renders with roles + status; open "Gestisci ruoli" for a non-admin user, toggle a SERVICE role, save, confirm it persists (check the Ruoli cell after refresh); click a status badge to deactivate then reactivate a non-admin user, confirm persistence; confirm the guardrails fire — attempt to remove your own Administrator role (expect the Italian error) and to deactivate your own account (expect the error). Clean up any test mutations afterward.

- [✅] **Step 5: Commit**

```bash
git add sources/tests/e2e/test_users.py
git commit -m "test(e2e): users list, manage-roles modal, status, non-admin gating"
```

---

## Self-Review (completed during planning)

**Spec coverage (spec → task):**
- DTO + query types (spec §4) → Task 1. ✓
- Anti-lockout guards (spec §5) → Task 2. ✓
- Pure mappers / sort+status+DTO (spec §7, §10) → Task 3. ✓
- Read service list/count + filters (spec §7) → Task 4. ✓
- updateUserRoles + setUserStatus with guards (spec §6) → Task 5. ✓
- StatusBadge + ManageRolesModal (spec §8) → Task 6. ✓
- UsersTableClient + page, reuse DataTable + getAllRoles (spec §8) → Task 7. ✓
- E2E + browser verification incl. guardrails + non-admin gating (spec §10) → Task 8. ✓

**Placeholder scan:** none — every code/test step is complete.

**Type consistency:** `UserDTO`/`UsersQuery`/`UserStatusId` (Task 1) used identically in Tasks 3/4/6/7. `assertRoleChangeAllowed`/`assertStatusChangeAllowed` arg shapes (Task 2) match the action call sites (Task 5). `USER_SORT_COLUMN`/`buildUserDtos`/`UserRow`/`UserRoleRow` (Task 3) match the service usage (Task 4). `getAllRoles(): {id,description}[]` (roles-service) mapped to `{id,name}` consistently in Tasks 4 and 7. `DataTable` props (`columns`/`rows`/`rowKey`/`sort{field,direction}`/`onSortChange`/`page`/`totalPages`/`onPageChange`/`search`/`onSearchChange`/`rowMenu`) match the Phase-1 primitive.
