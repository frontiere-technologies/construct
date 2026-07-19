# Supabase SDK → Drizzle ORM Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@supabase/supabase-js` (PostgREST) with Drizzle ORM over the `postgres.js` driver as the Postgres client for `sources/microservices/web-construct/`, without moving or changing the database.

**Architecture:** A module-level Drizzle client (`lib/db.ts`) wraps a `postgres.js` connection to the same Supabase cloud Postgres, routed through the Supavisor pooler in transaction mode (port 6543). A hand-written `lib/db/schema.ts` mirrors every table in `sources/devops/db/schema.sql` for type-safe querying; `schema.sql` remains the sole source of DDL truth. Every call site that currently uses `createAdminClient()` is rewritten to use `db`, module by module, in increasing order of risk, each verified before the next starts.

**Tech Stack:** `drizzle-orm`, `postgres` (postgres.js driver), `drizzle-kit` (introspection only, dev dependency). Existing: Next.js 16, NextAuth v5, Vitest, Playwright/pytest.

**Source spec:** `docs/superpowers/specs/2026-07-18-drizzle-migration-design.md`

## Global Constraints

- Full scope: every one of the 18 files below that imports `createAdminClient` or `@supabase/supabase-js` must be migrated — no subset (DEC-1).
- Connection: Supavisor pooler, transaction mode, port `6543`, `prepare: false` on the `postgres.js` client — never a direct `5432` connection (DEC-2).
- The 3 Postgres RPC functions (`replace_user_roles`, `apply_role_permission_deltas`, `replace_item_tags`) stay as-is in `schema.sql` and are invoked via `db.execute(sql\`select ...\`)` — never reimplemented as Drizzle transactions (DEC-3).
- `sources/devops/db/schema.sql` remains the only source of DDL truth. `lib/db/schema.ts` is a hand-maintained, read/write type layer only — `drizzle-kit` is never used as a migration engine (DEC-4).
- No database, environment, or Supabase project change — same cloud Postgres instance used today for local dev and E2E (DEC-5).
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (+ `NEXT_PUBLIC_SUPABASE_ANON_KEY`, unused server-side) are replaced by a single `DATABASE_URL` in `.env.template` and `sources/devops/k8s/dev/secret.env.example` (DEC-6).
- Single branch, migrated module-by-module in the fixed order below, each module verified before the next starts. `@supabase/supabase-js` is removed from `package.json` only in the last task (DEC-7).
- Error handling: postgres.js throws (`PostgresError`) instead of returning `{ data, error }`. Every existing `if (error) throw new Error('Failed to X: ' + error.message)` becomes a `try { ... } catch (err) { throw new Error('Failed to X: ' + (err instanceof Error ? err.message : String(err))) }` around the Drizzle call, preserving the exact message prefix.
- No `.single()` equivalent: where PostgREST's `.single()` turned "zero rows" into a thrown error automatically, Drizzle's `.limit(1)` returns an empty array — every such call site gets an explicit `if (!row) throw new Error(...)` check.
- No centralized DB-error-wrapping helper is introduced (out of scope) — try/catch stays inline per call site, matching the existing repeated pattern.

---

## Task 1: Drizzle client, hand-written schema, and env var migration

**Files:**
- Create: `lib/db/schema.ts`
- Create: `lib/db.ts`
- Create: `drizzle.config.ts`
- Modify: `package.json` (add `drizzle-orm`, `postgres`, `drizzle-kit`)
- Modify: `.env.template`
- Modify: `sources/devops/k8s/dev/secret.env.example` (repo-relative to `sources/microservices/web-construct/`: `../../devops/k8s/dev/secret.env.example`)

**Interfaces:**
- Produces: `db` (Drizzle instance) from `lib/db.ts`; typed tables `users`, `passwordSetTokens`, `allowedDomains`, `roleType`, `navigationItemType`, `functionalityType`, `userStatus`, `role`, `roleHistory`, `userRole`, `navigationItem`, `navigationItemTag`, `roleItem`, `userInfo`, and view `roleListView` from `lib/db/schema.ts`. Every later task imports `db` from `@/lib/db` and the tables it needs from `@/lib/db/schema`.
- All timestamp columns use `{ withTimezone: true, mode: 'string' }` — Drizzle returns/accepts ISO strings, matching what PostgREST returned today and what every DTO in the codebase already expects (e.g. `UserRow.created_at: string`). This is load-bearing for every later task: do not switch any timestamp column to `mode: 'date'`.
- All `bigint` PK/FK columns (`id_role`, `id_item`, `id_role_type`, etc.) use `{ mode: 'number' }` — matching the existing `number`-typed ids used throughout `lib/rbac/types.ts`.

- [ ] **Step 1: Install dependencies**

```bash
cd sources/microservices/web-construct
npm install drizzle-orm postgres
npm install -D drizzle-kit
```

- [ ] **Step 2: Write `lib/db/schema.ts`**

```ts
import { sql } from 'drizzle-orm'
import {
  pgTable, pgView, uuid, text, jsonb, timestamp, bigint, integer, smallint,
  boolean, varchar, primaryKey, type AnyPgColumn,
} from 'drizzle-orm/pg-core'

export const userStatus = pgTable('user_status', {
  idUserStatus: bigint('id_user_status', { mode: 'number' }).primaryKey(),
  description: text('description').notNull(),
})

export const roleType = pgTable('role_type', {
  idRoleType: bigint('id_role_type', { mode: 'number' }).primaryKey(),
  description: text('description').notNull(),
})

export const navigationItemType = pgTable('navigation_item_type', {
  idItemType: bigint('id_item_type', { mode: 'number' }).primaryKey(),
  description: text('description').notNull(),
})

export const functionalityType = pgTable('functionality_type', {
  idFunctionalityType: bigint('id_functionality_type', { mode: 'number' }).primaryKey(),
  description: text('description').notNull(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email').unique(),
  avatar: text('avatar'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  username: text('username'),
  phone: text('phone'),
  themeConfig: jsonb('theme_config'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  passwordHash: text('password_hash'),
  authProvider: text('auth_provider'),
  sub: text('sub'),
  country: varchar('country', { length: 3 }),
  branch: text('branch'),
  flow: text('flow'),
  uomRole: text('uom_role'),
  additionalCompany: text('additional_company'),
  ownerCompany: text('owner_company'),
  features: text('features'),
  pictureUrl: text('picture_url'),
  idUserStatus: bigint('id_user_status', { mode: 'number' }).references(() => userStatus.idUserStatus).default(2),
  lastStatusTs: timestamp('last_status_ts', { withTimezone: true, mode: 'string' }),
})

export const passwordSetTokens = pgTable('password_set_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

export const allowedDomains = pgTable('allowed_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

export const role = pgTable('role', {
  idRole: bigint('id_role', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_role')`),
  idRoleType: bigint('id_role_type', { mode: 'number' }).references(() => roleType.idRoleType),
  description: text('description').notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).defaultNow(),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }),
})

export const roleHistory = pgTable('role_history', {
  idRole: bigint('id_role', { mode: 'number' }).notNull(),
  hDateIns: timestamp('h_date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  description: text('description').notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }),
}, (t) => [primaryKey({ columns: [t.idRole, t.hDateIns] })])

export const userRole = pgTable('user_role', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  idRole: bigint('id_role', { mode: 'number' }).notNull().references(() => role.idRole, { onDelete: 'cascade' }),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.idRole] })])

export const navigationItem = pgTable('navigation_item', {
  idItem: bigint('id_item', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_navigation_item')`),
  name: text('name'),
  idItemType: bigint('id_item_type', { mode: 'number' }).notNull().references(() => navigationItemType.idItemType),
  idFunctionalityType: bigint('id_functionality_type', { mode: 'number' }).references(() => functionalityType.idFunctionalityType),
  functionalityLink: text('functionality_link'),
  iconPath: text('icon_path'),
  idItemParent: bigint('id_item_parent', { mode: 'number' }).references((): AnyPgColumn => navigationItem.idItem, { onDelete: 'cascade' }),
  orderPosition: integer('order_position').notNull().default(0),
  description: text('description'),
  navbarPosition: text('navbar_position', { enum: ['TOP', 'BOTTOM'] }),
  itemTranslation: jsonb('item_translation'),
  isImmutable: smallint('is_immutable').notNull().default(0),
  configVisibility: smallint('config_visibility').notNull().default(0),
  noPermissionNeedForNavigation: smallint('no_permission_need_for_navigation').notNull().default(0),
  externalId: text('external_id'),
  clickCount: bigint('click_count', { mode: 'number' }).default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

export const navigationItemTag = pgTable('navigation_item_tag', {
  idItem: bigint('id_item', { mode: 'number' }).notNull().references(() => navigationItem.idItem, { onDelete: 'cascade' }),
  tagLan: varchar('tag_lan', { length: 5 }).notNull(),
  tag: varchar('tag', { length: 50 }).notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.idItem, t.tagLan, t.tag] })])

export const roleItem = pgTable('role_item', {
  idRole: bigint('id_role', { mode: 'number' }).notNull().references(() => role.idRole, { onDelete: 'cascade' }),
  idItem: bigint('id_item', { mode: 'number' }).notNull().references(() => navigationItem.idItem, { onDelete: 'cascade' }),
  authorized: boolean('authorized').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.idRole, t.idItem] })])

export const userInfo = pgTable('user_info', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  attributeType: varchar('attribute_type', { length: 30 }).notNull(),
  attributeValue: text('attribute_value').notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).defaultNow(),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }),
}, (t) => [primaryKey({ columns: [t.userId, t.attributeType] })])

// Read-only — created by schema.sql, never migrated by drizzle-kit (DEC-4).
export const roleListView = pgView('role_list_view', {
  id: bigint('id', { mode: 'number' }),
  description: text('description'),
  roleType: text('role_type'),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }),
  associatedUsers: bigint('associated_users', { mode: 'number' }),
  hasPermissions: boolean('has_permissions'),
}).existing()
```

- [ ] **Step 3: Write `lib/db.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './db/schema'

// Supavisor transaction-mode pooling does not support prepared statements
// across the pooled connection — prepare: false is required, not optional.
// Long-running Node pod per instance ⇒ one client for the pod's lifetime,
// not re-created per request.
const client = postgres(process.env.DATABASE_URL!, { prepare: false })

export const db = drizzle(client, { schema })
```

- [ ] **Step 4: Write `drizzle.config.ts`** (used only for one-off `drizzle-kit introspect` sanity checks against the live DB — never for migrations, per DEC-4)

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

- [ ] **Step 5: Update `.env.template`**

Replace:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```
with:
```
# Postgres connection string via Supabase's Supavisor pooler (transaction mode, port 6543).
# Dashboard Supabase → Project Settings → Database → Connection string → "Transaction pooler".
DATABASE_URL=postgresql://postgres.xxxxxxxx:password@aws-0-region.pooler.supabase.com:6543/postgres
```

- [ ] **Step 6: Update `sources/devops/k8s/dev/secret.env.example`**

From `sources/microservices/web-construct/`, replace in `../../devops/k8s/dev/secret.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
AUTH_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
```
with:
```
DATABASE_URL=
AUTH_SECRET=
```

Note (manual, not part of this commit): the real `sources/devops/k8s/dev/secret.env` is gitignored and contains live credentials — whoever runs this plan must add their own `DATABASE_URL` (Supavisor pooler string, port 6543) to it by hand; do not read or write that file from this plan.

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: build succeeds — `lib/db.ts` and `lib/db/schema.ts` compile and type-check even though nothing imports them yet.

- [ ] **Step 8: Commit**

```bash
git add lib/db.ts lib/db/schema.ts drizzle.config.ts package.json package-lock.json .env.template ../../devops/k8s/dev/secret.env.example
git commit -m "feat(db): add Drizzle ORM client and hand-written schema for Supabase Postgres"
```

---

## Task 2: Migrate `lib/theme-actions.ts`

**Files:**
- Modify: `lib/theme-actions.ts`

**Interfaces:**
- Consumes: `db`, `users` from Task 1.
- No test file exists for this module today (confirmed: no `lib/theme-actions.test.ts`) and none is added — out of scope, matching spec §5.

- [ ] **Step 1: Replace `lib/theme-actions.ts` in full**

```ts
'use server'

import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import type { ThemeConfig } from '@/types/menu'

export async function saveThemeConfig(config: ThemeConfig): Promise<{ error: string | null }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Not authenticated' }
  try {
    await db.update(users).set({ themeConfig: config }).where(eq(users.id, session.user.id))
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function loadThemeConfig(): Promise<ThemeConfig | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  const [row] = await db
    .select({ themeConfig: users.themeConfig })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)
  return (row?.themeConfig as ThemeConfig) ?? null
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev`, log in, go to Admin → Theme, change a color token, click "Save Theme", reload the page.
Expected: the customized value persists after reload (same behavior as before the migration).

- [ ] **Step 4: Commit**

```bash
git add lib/theme-actions.ts
git commit -m "refactor(theme): migrate theme-actions.ts to Drizzle"
```

---

## Task 3: Migrate `lib/profile-actions.ts` and the profile page

**Files:**
- Modify: `lib/profile-actions.ts`
- Modify: `app/(protected)/profile/page.tsx`

**Interfaces:**
- Consumes: `db`, `users` from Task 1.
- No unit test exists for `profile-actions.ts` today — none added, out of scope. E2E coverage exists: `sources/tests/e2e/test_profile.py`.

- [ ] **Step 1: Replace `lib/profile-actions.ts` in full**

```ts
'use server'

import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { phoneSchema } from '@/lib/validations'

export interface UserProfile {
  first_name: string | null
  last_name: string | null
  username: string | null
  phone: string | null
}

export async function saveProfile(profile: UserProfile): Promise<{ error: string | null }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Not authenticated' }

  let phone = profile.phone
  if (phone) {
    const parsed = phoneSchema.safeParse(phone)
    if (!parsed.success) return { error: parsed.error.issues[0].message }
    phone = parsed.data
  }

  try {
    await db
      .insert(users)
      .values({
        id: session.user.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        username: profile.username,
        phone,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          firstName: profile.first_name,
          lastName: profile.last_name,
          username: profile.username,
          phone,
          updatedAt: new Date().toISOString(),
        },
      })
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 2: Replace `app/(protected)/profile/page.tsx` in full**

```tsx
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import ProfileForm from '@/components/ProfileForm'
import type { UserProfile } from '@/lib/profile-actions'

export default async function ProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [profile] = await db
    .select({ firstName: users.firstName, lastName: users.lastName, username: users.username, phone: users.phone })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)

  const initialProfile: UserProfile = {
    first_name: profile?.firstName ?? null,
    last_name: profile?.lastName ?? null,
    username: profile?.username ?? null,
    phone: profile?.phone ?? null,
  }

  return (
    <ProfileForm
      email={session.user.email ?? ''}
      avatarUrl={session.user.image ?? null}
      initialProfile={initialProfile}
      provider={session.user.provider ?? ''}
    />
  )
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Run the profile E2E suite**

Run: `uv run pytest sources/tests/e2e/test_profile.py`
Expected: all tests pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/profile-actions.ts "app/(protected)/profile/page.tsx"
git commit -m "refactor(profile): migrate profile-actions.ts and profile page to Drizzle"
```

---

## Task 4: Migrate `navigation-service.ts` and `functionalities-service.ts`

**Files:**
- Create: `lib/rbac/nav-row-mapper.ts`
- Modify: `lib/rbac/navigation-service.ts`
- Modify: `lib/rbac/functionalities-service.ts`

**Interfaces:**
- Consumes: `db`, `navigationItem`, `navigationItemTag`, `roleItem` from Task 1. `resolveAuthorizedItemIds`/`mapNavigationToSidebar` (`sidebar-adapter.ts`), `buildNavTree`/`mapRowToDto` (`nav-tree-builder.ts`) — all unchanged, they consume the existing snake_case `NavigationItemRow`/`RoleItemRow` shape from `lib/rbac/types.ts`.
- Produces: `toNavigationItemRow(row: typeof navigationItem.$inferSelect): NavigationItemRow` from `lib/rbac/nav-row-mapper.ts` — the single place that converts a Drizzle `navigation_item` row into the row shape the untouched pure helpers expect. Reused by Tasks 6 and 7.
- Neither file has a unit test today; none added.

- [ ] **Step 1: Write `lib/rbac/nav-row-mapper.ts`**

```ts
import type { navigationItem } from '@/lib/db/schema'
import type { NavigationItemRow } from './types'

export function toNavigationItemRow(r: typeof navigationItem.$inferSelect): NavigationItemRow {
  return {
    id_item: r.idItem,
    name: r.name,
    id_item_type: r.idItemType,
    id_functionality_type: r.idFunctionalityType,
    functionality_link: r.functionalityLink,
    icon_path: r.iconPath,
    id_item_parent: r.idItemParent,
    order_position: r.orderPosition,
    navbar_position: r.navbarPosition as 'TOP' | 'BOTTOM' | null,
    item_translation: r.itemTranslation as NavigationItemRow['item_translation'],
    is_immutable: r.isImmutable,
    config_visibility: r.configVisibility,
    no_permission_need_for_navigation: r.noPermissionNeedForNavigation,
  }
}
```

- [ ] **Step 2: Replace `lib/rbac/navigation-service.ts` in full**

```ts
import { cache } from 'react'
import { asc, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { navigationItem, roleItem } from '@/lib/db/schema'
import { toNavigationItemRow } from './nav-row-mapper'
import { resolveAuthorizedItemIds, mapNavigationToSidebar } from './sidebar-adapter'
import type { RoleItemRow } from './types'
import type { MenuItem } from '@/types/menu'

export const getSidebarMenu = cache(async (roleIds: number[]): Promise<MenuItem[]> => {
  const [navRows, roleRows] = await Promise.all([
    db.select().from(navigationItem).orderBy(asc(navigationItem.orderPosition)),
    roleIds.length
      ? db
          .select({ id_role: roleItem.idRole, id_item: roleItem.idItem, authorized: roleItem.authorized })
          .from(roleItem)
          .where(inArray(roleItem.idRole, roleIds))
      : Promise.resolve([]),
  ])

  const items = navRows.map(toNavigationItemRow)
  const roleItems = roleRows as RoleItemRow[]
  const authorized = resolveAuthorizedItemIds(items, roleItems, roleIds)
  return mapNavigationToSidebar(items, authorized)
})
```

- [ ] **Step 3: Replace `lib/rbac/functionalities-service.ts` in full**

```ts
import { cache } from 'react'
import { asc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { navigationItem, navigationItemTag } from '@/lib/db/schema'
import { toNavigationItemRow } from './nav-row-mapper'
import { buildNavTree, mapRowToDto } from './nav-tree-builder'
import {
  type UserNavigationTreeDto, type NavigationItemRow,
  DEFAULT_LOCALE, ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY,
} from './types'

async function loadNavAndTags() {
  const [navRows, tagRows] = await Promise.all([
    db.select().from(navigationItem).orderBy(asc(navigationItem.orderPosition)),
    db.select().from(navigationItemTag),
  ])
  const tagsByItem = new Map<number, { tag_lan: string; tag: string }[]>()
  for (const t of tagRows) {
    const arr = tagsByItem.get(t.idItem) ?? []
    arr.push({ tag_lan: t.tagLan, tag: t.tag })
    tagsByItem.set(t.idItem, arr)
  }
  return { items: navRows.map(toNavigationItemRow), tagsByItem }
}

export const getNavigationSubtree = cache(async (root: 'root' | 'operations'): Promise<UserNavigationTreeDto[]> => {
  const { items, tagsByItem } = await loadNavAndTags()
  return buildNavTree(items, tagsByItem, root === 'root' ? ROOT_ID : OPERATIONS_ID)
})

export const getNavigationItem = cache(async (id: number): Promise<UserNavigationTreeDto> => {
  const { items, tagsByItem } = await loadNavAndTags()
  const it = items.find(i => i.id_item === id)
  if (!it) throw new Error(`Navigation item ${id} not found`)
  const tagTranslations: Record<string, string[]> = {}
  for (const t of tagsByItem.get(id) ?? []) (tagTranslations[t.tag_lan] ??= []).push(t.tag)
  return mapRowToDto(it, { tagTranslations, children: [] })
})

export const getParentList = cache(async (): Promise<{ id: number; name: string }[]> => {
  const { items } = await loadNavAndTags()
  return items
    .filter((i: NavigationItemRow) => i.id_item_type === ITEM_TYPE_CATEGORY && i.id_item !== ROOT_ID && i.id_item !== OPERATIONS_ID)
    .map((i: NavigationItemRow) => ({ id: i.id_item, name: i.item_translation?.[DEFAULT_LOCALE]?.name ?? i.name ?? '' }))
})
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Run the RBAC E2E suites touching navigation**

Run: `uv run pytest sources/tests/e2e/test_sidebar.py sources/tests/e2e/test_functionalities.py sources/tests/e2e/test_rbac.py`
Expected: all tests pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/rbac/nav-row-mapper.ts lib/rbac/navigation-service.ts lib/rbac/functionalities-service.ts
git commit -m "refactor(rbac): migrate navigation-service.ts and functionalities-service.ts to Drizzle"
```

---

## Task 5: Migrate `users-service.ts`

**Files:**
- Modify: `lib/rbac/users-service.ts`
- Modify: `lib/rbac/users-service.test.ts`

**Interfaces:**
- Consumes: `db`, `users`, `userRole` from Task 1; `USER_SORT_COLUMN`, `buildUserDtos`, `UserRow`, `UserRoleRow` from `lib/rbac/user-mappers.ts` (unchanged — still snake_case, `USER_SORT_COLUMN` still maps to snake_case column-name strings); `getAllRoles` from `lib/rbac/roles-service.ts` (unchanged signature).
- Produces: `applyUserFilters(query: UsersQuery, ids: string[] | null): SQL[]` — signature change from the old `applyUserFilters(q, query, ids)` that mutated a chained query builder. It now returns an array of Drizzle conditions to be combined with `and(...)`. This is the pattern reused identically by `roles-service.ts` (Task 6).

- [ ] **Step 1: Update the failing test for the new `applyUserFilters` signature**

Replace `lib/rbac/users-service.test.ts` in full:

```ts
import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { applyUserFilters } from './users-service'
import type { UsersQuery } from './types'

const dialect = new PgDialect()
function render(query: UsersQuery, ids: string[] | null) {
  return applyUserFilters(query, ids).map(c => dialect.sqlToQuery(c))
}

const baseQuery: UsersQuery = { page: 0, size: 10 }

describe('applyUserFilters', () => {
  it('applies gte on created_at when createdFrom is set', () => {
    const [rendered] = render({ ...baseQuery, createdFrom: '2026-06-01' }, null)
    expect(rendered.sql).toContain('"users"."created_at" >=')
    expect(rendered.params).toEqual(['2026-06-01'])
  })

  it('applies lt on created_at with the next-day value when createdTo is set, to include the full end day', () => {
    const [rendered] = render({ ...baseQuery, createdTo: '2026-06-30' }, null)
    expect(rendered.sql).toContain('"users"."created_at" <')
    expect(rendered.params).toEqual(['2026-07-01'])
  })

  it('applies in(id_user_status) when statuses is set', () => {
    const [rendered] = render({ ...baseQuery, statuses: [2] }, null)
    expect(rendered.sql).toContain('"users"."id_user_status"')
    expect(rendered.params).toEqual([2])
  })

  it('applies in(id) when a candidate id list is passed', () => {
    const [rendered] = render(baseQuery, ['abc', 'def'])
    expect(rendered.sql).toContain('"users"."id"')
    expect(rendered.params).toEqual(['abc', 'def'])
  })

  it('applies nothing when no filters are set', () => {
    expect(applyUserFilters(baseQuery, null)).toEqual([])
  })
})
```

Note: the `.toContain` assertions check the shape of Drizzle's generated SQL (quoted `"table"."column"` identifiers). If the actual rendered text from `dialect.sqlToQuery(...)` differs (e.g. operator spacing), update the assertion to match what the failing test run actually prints — the `params` assertions are the load-bearing check and should not need adjustment.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/rbac/users-service.test.ts`
Expected: FAIL — `applyUserFilters` still has the old 3-argument, builder-mutating signature.

- [ ] **Step 3: Replace `lib/rbac/users-service.ts` in full**

```ts
import { cache } from 'react'
import { and, asc, desc, count, gte, ilike, inArray, lt, or, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, userRole } from '@/lib/db/schema'
import { getAllRoles } from './roles-service'
import { nextDay } from './date-utils'
import { USER_SORT_COLUMN, buildUserDtos, type UserRow, type UserRoleRow } from './user-mappers'
import type { UserDTO, UsersQuery } from './types'

const SORT_COLUMNS = {
  first_name: users.firstName,
  last_name: users.lastName,
  email: users.email,
  created_at: users.createdAt,
  updated_at: users.updatedAt,
  id_user_status: users.idUserStatus,
} as const

async function candidateUserIds(roleIds: number[] | undefined): Promise<string[] | null> {
  if (!roleIds?.length) return null
  try {
    const rows = await db.select({ userId: userRole.userId }).from(userRole).where(inArray(userRole.idRole, roleIds))
    return Array.from(new Set(rows.map(r => r.userId)))
  } catch (err) {
    throw new Error(`Failed to filter by role: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function applyUserFilters(query: UsersQuery, ids: string[] | null): SQL[] {
  const conditions: SQL[] = []
  if (query.search) {
    const s = query.search.replace(/[%,()&]/g, '')
    conditions.push(or(
      ilike(users.firstName, `%${s}%`),
      ilike(users.lastName, `%${s}%`),
      ilike(users.email, `%${s}%`),
    )!)
  }
  if (query.statuses?.length) conditions.push(inArray(users.idUserStatus, query.statuses))
  if (query.createdFrom) conditions.push(gte(users.createdAt, query.createdFrom))
  if (query.createdTo) conditions.push(lt(users.createdAt, nextDay(query.createdTo)))
  if (ids) conditions.push(inArray(users.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']))
  return conditions
}

export const listUsers = cache(async (query: UsersQuery): Promise<{ users: UserDTO[]; total: number }> => {
  const ids = await candidateUserIds(query.roleIds)
  const conditions = applyUserFilters(query, ids)
  const where = conditions.length ? and(...conditions) : undefined
  const ascending = (query.direction ?? 'DESC') === 'ASC'
  const from = query.page * query.size
  const sortCol = SORT_COLUMNS[USER_SORT_COLUMN[query.sort ?? 'dateIns'] as keyof typeof SORT_COLUMNS]
  const orderBy = query.sort === 'firstName'
    ? [ascending ? asc(users.firstName) : desc(users.firstName), ascending ? asc(users.lastName) : desc(users.lastName), ascending ? asc(users.email) : desc(users.email)]
    : [ascending ? asc(sortCol) : desc(sortCol)]

  let userRows: UserRow[]
  let total: number
  try {
    const [rows, [{ value }]] = await Promise.all([
      db
        .select({
          id: users.id, first_name: users.firstName, last_name: users.lastName, email: users.email,
          created_at: users.createdAt, updated_at: users.updatedAt, id_user_status: users.idUserStatus,
        })
        .from(users)
        .where(where)
        .orderBy(...orderBy)
        .limit(query.size)
        .offset(from),
      db.select({ value: count() }).from(users).where(where),
    ])
    userRows = rows as unknown as UserRow[]
    total = value
  } catch (err) {
    throw new Error(`Failed to list users: ${err instanceof Error ? err.message : String(err)}`)
  }

  const pageIds = userRows.map(u => u.id)
  let userRoleRows: UserRoleRow[] = []
  if (pageIds.length) {
    try {
      const ur = await db.select({ user_id: userRole.userId, id_role: userRole.idRole }).from(userRole).where(inArray(userRole.userId, pageIds))
      userRoleRows = ur as UserRoleRow[]
    } catch (err) {
      throw new Error(`Failed to load user roles: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const allRoles = await getAllRoles()
  const roleNameById = new Map<number, string>(allRoles.map(r => [r.id, r.description]))
  return { users: buildUserDtos(userRows, userRoleRows, roleNameById), total }
})

export const countUsers = cache(async (query: UsersQuery): Promise<number> => {
  const ids = await candidateUserIds(query.roleIds)
  const conditions = applyUserFilters(query, ids)
  const where = conditions.length ? and(...conditions) : undefined
  try {
    const [{ value }] = await db.select({ value: count() }).from(users).where(where)
    return value
  } catch (err) {
    throw new Error(`Failed to count users: ${err instanceof Error ? err.message : String(err)}`)
  }
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/rbac/users-service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify the build and the users E2E suite**

Run: `npm run build && uv run pytest sources/tests/e2e/test_users.py`
Expected: build succeeds; all E2E tests pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/rbac/users-service.ts lib/rbac/users-service.test.ts
git commit -m "refactor(rbac): migrate users-service.ts to Drizzle, rewrite applyUserFilters as a condition-array builder"
```

---

## Task 6: Migrate `roles-service.ts`

**Files:**
- Modify: `lib/rbac/roles-service.ts`
- Modify: `lib/rbac/roles-service.test.ts`

**Interfaces:**
- Consumes: `db`, `roleListView`, `navigationItem`, `roleItem` from Task 1; `toNavigationItemRow` from Task 4; `buildAuthTree` from `permission-tree.ts` (unchanged); `nextDay` from `date-utils.ts` (unchanged).
- Produces: `applyFilters(query: RolesQuery): SQL[]` — same condition-array pattern as `applyUserFilters` (Task 5), consumed only within this file.

- [ ] **Step 1: Update the failing test for the new `applyFilters` signature**

Replace `lib/rbac/roles-service.test.ts` in full:

```ts
import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { applyFilters } from './roles-service'
import type { RolesQuery } from './types'

const dialect = new PgDialect()
function render(query: RolesQuery) {
  return applyFilters(query).map(c => dialect.sqlToQuery(c))
}

const baseQuery: RolesQuery = { page: 0, size: 10 }

describe('applyFilters', () => {
  it('applies eq(has_permissions, false) when hasPermission is explicitly false', () => {
    const [rendered] = render({ ...baseQuery, hasPermission: false })
    expect(rendered.sql).toContain('"role_list_view"."has_permissions"')
    expect(rendered.params).toEqual([false])
  })

  it('omits the has_permissions filter when hasPermission is undefined', () => {
    expect(applyFilters(baseQuery)).toEqual([])
  })

  it('combines with existing search and hasPermission filters', () => {
    const rendered = render({ ...baseQuery, search: 'Admin', hasPermission: true })
    expect(rendered).toHaveLength(2)
    expect(rendered[0].sql).toContain('"role_list_view"."description"')
    expect(rendered[0].params).toEqual(['%Admin%'])
    expect(rendered[1].params).toEqual([true])
  })

  it('applies gte on date_ins when startDateIns is set', () => {
    const [rendered] = render({ ...baseQuery, startDateIns: '2026-06-01' })
    expect(rendered.sql).toContain('"role_list_view"."date_ins" >=')
    expect(rendered.params).toEqual(['2026-06-01'])
  })

  it('applies lt on date_ins with next-day value when endDateIns is set, to include the full end day', () => {
    const [rendered] = render({ ...baseQuery, endDateIns: '2026-06-30' })
    expect(rendered.sql).toContain('"role_list_view"."date_ins" <')
    expect(rendered.params).toEqual(['2026-07-01'])
  })

  it('applies both gte and lt in order when startDateIns and endDateIns are both set', () => {
    const rendered = render({ ...baseQuery, startDateIns: '2026-06-01', endDateIns: '2026-06-30' })
    expect(rendered.map(r => r.params)).toEqual([['2026-06-01'], ['2026-07-01']])
  })

  it('rolls over to the next year when endDateIns is the last day of the year', () => {
    const [rendered] = render({ ...baseQuery, endDateIns: '2026-12-31' })
    expect(rendered.params).toEqual(['2027-01-01'])
  })
})
```

Note: same caveat as Task 5 — if the exact `.sql` substrings don't match Drizzle's actual output, adjust them to what the failing run prints; `params` assertions are load-bearing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/rbac/roles-service.test.ts`
Expected: FAIL — `applyFilters` still has the old single-generic-builder signature.

- [ ] **Step 3: Replace `lib/rbac/roles-service.ts` in full**

```ts
import { cache } from 'react'
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { navigationItem, roleItem, roleListView } from '@/lib/db/schema'
import { toNavigationItemRow } from './nav-row-mapper'
import { buildAuthTree } from './permission-tree'
import {
  type RolesQuery, type RolesPage, type RolePageItemDto, type RoleInformationDto,
  type RoleType, type UserNavigationTreeDto,
  ROOT_ID, OPERATIONS_ID,
} from './types'
import { nextDay } from './date-utils'

const SORT_COLUMN = {
  id: roleListView.id,
  description: roleListView.description,
  associatedUsers: roleListView.associatedUsers,
  hasPermissions: roleListView.hasPermissions,
  dateIns: roleListView.dateIns,
  dateMod: roleListView.dateMod,
} as const

export function applyFilters(query: RolesQuery): SQL[] {
  const conditions: SQL[] = []
  if (query.search) conditions.push(ilike(roleListView.description, `%${query.search}%`))
  if (query.hasPermission != null) conditions.push(eq(roleListView.hasPermissions, query.hasPermission))
  if (query.startDateIns) conditions.push(gte(roleListView.dateIns, query.startDateIns))
  if (query.endDateIns) conditions.push(lt(roleListView.dateIns, nextDay(query.endDateIns)))
  return conditions
}

export const listRoles = cache(async (query: RolesQuery): Promise<RolesPage> => {
  const conditions = applyFilters(query)
  const where = conditions.length ? and(...conditions) : undefined
  const sortCol = SORT_COLUMN[query.sort ?? 'id']
  const ascending = (query.direction ?? 'ASC') === 'ASC'
  const from = query.page * query.size

  let rows: (typeof roleListView.$inferSelect)[]
  let total: number
  try {
    const [r, [{ value }]] = await Promise.all([
      db.select().from(roleListView).where(where).orderBy(ascending ? asc(sortCol) : desc(sortCol)).limit(query.size).offset(from),
      db.select({ value: count() }).from(roleListView).where(where),
    ])
    rows = r
    total = value
  } catch (err) {
    throw new Error(`Failed to list roles: ${err instanceof Error ? err.message : String(err)}`)
  }

  const elements: RolePageItemDto[] = rows.map(r => ({
    id: Number(r.id),
    description: String(r.description ?? ''),
    associatedUsers: Number(r.associatedUsers ?? 0),
    hasPermissions: Boolean(r.hasPermissions),
    dateIns: r.dateIns ?? null,
    dateMod: r.dateMod ?? null,
    roleType: (r.roleType as RoleType) ?? 'SERVICE',
  }))
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
  const conditions = applyFilters(query)
  const where = conditions.length ? and(...conditions) : undefined
  try {
    const [{ value }] = await db.select({ value: count() }).from(roleListView).where(where)
    return value
  } catch (err) {
    throw new Error(`Failed to count roles: ${err instanceof Error ? err.message : String(err)}`)
  }
})

export const getAllRoles = cache(async (roleTypes?: RoleType[]): Promise<{ id: number; description: string }[]> => {
  const where = roleTypes?.length ? inArray(roleListView.roleType, roleTypes) : undefined
  try {
    const rows = await db
      .select({ id: roleListView.id, description: roleListView.description })
      .from(roleListView)
      .where(where)
      .orderBy(asc(roleListView.description))
    return rows.map(r => ({ id: Number(r.id), description: String(r.description ?? '') }))
  } catch (err) {
    throw new Error(`Failed to load roles: ${err instanceof Error ? err.message : String(err)}`)
  }
})

export const getRole = cache(async (roleId: number): Promise<RoleInformationDto> => {
  const [row] = await db
    .select({ id: roleListView.id, description: roleListView.description, roleType: roleListView.roleType, associatedUsers: roleListView.associatedUsers })
    .from(roleListView)
    .where(eq(roleListView.id, roleId))
    .limit(1)
  if (!row) throw new Error('Failed to load role: not found')
  return {
    id: Number(row.id),
    roleName: String(row.description ?? ''),
    associatedUsersCount: Number(row.associatedUsers ?? 0),
    roleType: (row.roleType as RoleType) ?? 'SERVICE',
  }
})

export const getRoleAuthorizationTree = cache(
  async (roleId: number, rootName: 'ROOT' | 'OPERATIONS'): Promise<UserNavigationTreeDto[]> => {
    let navRows: (typeof navigationItem.$inferSelect)[]
    let riRows: { idItem: number; authorized: boolean }[]
    try {
      ;[navRows, riRows] = await Promise.all([
        db.select().from(navigationItem).orderBy(asc(navigationItem.orderPosition)),
        db.select({ idItem: roleItem.idItem, authorized: roleItem.authorized }).from(roleItem).where(eq(roleItem.idRole, roleId)),
      ])
    } catch (err) {
      throw new Error(`Failed to load navigation: ${err instanceof Error ? err.message : String(err)}`)
    }
    const authorized = new Set<number>(riRows.filter(r => r.authorized).map(r => r.idItem))
    const rootId = rootName === 'ROOT' ? ROOT_ID : OPERATIONS_ID
    return buildAuthTree(navRows.map(toNavigationItemRow), authorized, rootId)
  }
)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/rbac/roles-service.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Verify the build and the roles E2E suite**

Run: `npm run build && uv run pytest sources/tests/e2e/test_roles.py`
Expected: build succeeds; all E2E tests pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/rbac/roles-service.ts lib/rbac/roles-service.test.ts
git commit -m "refactor(rbac): migrate roles-service.ts to Drizzle, rewrite applyFilters as a condition-array builder"
```

---

## Task 7: Migrate `navigation-actions.ts`

**Files:**
- Modify: `lib/rbac/navigation-actions.ts`

**Interfaces:**
- Consumes: `db`, `navigationItem` from Task 1; `toNavigationItemRow` from Task 4; `sanitizeSvg`, `canDeleteSubtree`, `isDescendant`, `requireAdmin` — all unchanged.
- No unit test exists for this module; none added.

- [ ] **Step 1: Replace `lib/rbac/navigation-actions.ts` in full**

```ts
'use server'

import { eq, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { navigationItem } from '@/lib/db/schema'
import { toNavigationItemRow } from './nav-row-mapper'
import { sanitizeSvg } from './svg-sanitize'
import { canDeleteSubtree, isDescendant } from './nav-tree-builder'
import type { CreateNavItemInput, UpdateNavItemInput, MoveInput, NavigationItemRow } from './types'
import { ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY } from './types'

async function writeTags(idItem: number, tagTranslations: Record<string, string[]>) {
  const rows: { tag_lan: string; tag: string }[] = []
  for (const [lan, tags] of Object.entries(tagTranslations)) {
    for (const tag of tags) if (tag.trim()) rows.push({ tag_lan: lan, tag: tag.trim() })
  }
  // Atomic replace (delete + insert in one transaction) via the schema.sql RPC (DEC-3).
  try {
    await db.execute(sql`select public.replace_item_tags(${idItem}, ${JSON.stringify(rows)}::jsonb)`)
  } catch (err) {
    throw new Error(`Failed to write tags: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function createNavigationItem(input: CreateNavItemInput): Promise<{ id: number }> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  const parent = input.idItemParent ?? input.idRootParent ?? ROOT_ID

  let nextOrder: number
  try {
    const siblings = await db.select({ orderPosition: navigationItem.orderPosition }).from(navigationItem).where(eq(navigationItem.idItemParent, parent))
    nextOrder = siblings.reduce((m, r) => Math.max(m, r.orderPosition + 1), 0)
  } catch (err) {
    throw new Error(`Failed to load siblings: ${err instanceof Error ? err.message : String(err)}`)
  }

  let created: { idItem: number }
  try {
    ;[created] = await db
      .insert(navigationItem)
      .values({
        name: input.name.trim(),
        idItemType: input.idItemType,
        idFunctionalityType: input.idItemType === 2 ? input.idFunctionalityType : null,
        functionalityLink: input.idItemType === 2 ? input.functionalityLink : null,
        iconPath: sanitizeSvg(input.iconPath),
        idItemParent: parent,
        orderPosition: nextOrder,
        description: input.description,
        itemTranslation: input.itemTranslation,
        isImmutable: 0,
        configVisibility: 0,
        noPermissionNeedForNavigation: 0,
      })
      .returning({ idItem: navigationItem.idItem })
  } catch (err) {
    throw new Error(`Failed to create item: ${err instanceof Error ? err.message : String(err)}`)
  }
  await writeTags(created.idItem, input.tagTranslations)
  return { id: created.idItem }
}

async function loadItems(): Promise<NavigationItemRow[]> {
  try {
    const rows = await db.select().from(navigationItem)
    return rows.map(toNavigationItemRow)
  } catch (err) {
    throw new Error(`Failed to load items: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function assertMutable(id: number) {
  const [row] = await db.select({ isImmutable: navigationItem.isImmutable }).from(navigationItem).where(eq(navigationItem.idItem, id)).limit(1)
  if (!row) throw new Error('Item not found: no rows')
  if (row.isImmutable === 1) throw new Error('This item is immutable')
}

export async function updateNavigationItem(id: number, input: UpdateNavItemInput): Promise<void> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  await assertMutable(id)
  try {
    await db
      .update(navigationItem)
      .set({
        name: input.name.trim(),
        idItemType: input.idItemType,
        idFunctionalityType: input.idItemType === 2 ? input.idFunctionalityType : null,
        functionalityLink: input.idItemType === 2 ? input.functionalityLink : null,
        iconPath: sanitizeSvg(input.iconPath),
        description: input.description,
        itemTranslation: input.itemTranslation,
      })
      .where(eq(navigationItem.idItem, id))
  } catch (err) {
    throw new Error(`Failed to update item: ${err instanceof Error ? err.message : String(err)}`)
  }
  await writeTags(id, input.tagTranslations)
}

export async function moveNavigationItem(id: number, move: MoveInput): Promise<void> {
  await requireAdmin()
  if (id === 0 || id === -1) throw new Error('Cannot move a root')
  await assertMutable(id)
  const items = await loadItems()
  if (isDescendant(items, move.targetParentId, id)) throw new Error('Cannot move an item into its own subtree')

  const isVirtualRoot = move.targetParentId === ROOT_ID || move.targetParentId === OPERATIONS_ID
  if (!isVirtualRoot) {
    const targetItem = items.find(i => i.id_item === move.targetParentId)
    if (!targetItem || targetItem.id_item_type !== ITEM_TYPE_CATEGORY) {
      throw new Error('Target parent must be a category')
    }
  }

  const dest = items
    .filter(i => i.id_item_parent === move.targetParentId && i.id_item !== id)
    .sort((a, b) => a.order_position - b.order_position)
    .map(i => i.id_item)
  const idx = Math.max(0, Math.min(move.orderPosition, dest.length))
  dest.splice(idx, 0, id)
  for (let pos = 0; pos < dest.length; pos++) {
    try {
      await db.update(navigationItem).set({ idItemParent: move.targetParentId, orderPosition: pos }).where(eq(navigationItem.idItem, dest[pos]))
    } catch (err) {
      throw new Error(`Failed to move item: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

export async function deleteNavigationItem(id: number): Promise<void> {
  await requireAdmin()
  const items = await loadItems()
  if (!canDeleteSubtree(items, id)) throw new Error('This item (or a descendant) is immutable and cannot be deleted')
  try {
    await db.delete(navigationItem).where(eq(navigationItem.idItem, id))
  } catch (err) {
    throw new Error(`Failed to delete item: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Run the functionalities E2E suite**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py`
Expected: all tests pass unchanged (covers create/update/move/delete of navigation items and tags).

- [ ] **Step 4: Commit**

```bash
git add lib/rbac/navigation-actions.ts
git commit -m "refactor(rbac): migrate navigation-actions.ts to Drizzle"
```

---

## Task 8: Migrate `users-actions.ts` and `auth-roles.ts`

**Files:**
- Modify: `lib/rbac/users-actions.ts`
- Modify: `lib/rbac/auth-roles.ts`

**Interfaces:**
- Consumes: `db`, `users`, `userRole` from Task 1; `assertRoleChangeAllowed`, `assertStatusChangeAllowed`, `requireAdmin` — unchanged.
- `computeIsAdmin` is a pure function untouched by this task; its test (`auth-roles.test.ts`) needs no changes.
- No unit test exists for `resolveUserRoleIds`; none added.

- [ ] **Step 1: Replace `lib/rbac/users-actions.ts` in full**

```ts
'use server'

import { and, count, eq, inArray, ne, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { users, userRole } from '@/lib/db/schema'
import { assertRoleChangeAllowed, assertStatusChangeAllowed } from './user-guards'
import { ROLE_ADMINISTRATOR, ROLE_REGISTERED, type UserStatusId } from './types'

async function userIsAdmin(userId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ userId: userRole.userId })
      .from(userRole)
      .where(and(eq(userRole.userId, userId), eq(userRole.idRole, ROLE_ADMINISTRATOR)))
      .limit(1)
    return rows.length > 0
  } catch (err) {
    throw new Error(`Failed to check admin: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function otherAdminUserIds(excludeUserId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ userId: userRole.userId })
      .from(userRole)
      .where(and(eq(userRole.idRole, ROLE_ADMINISTRATOR), ne(userRole.userId, excludeUserId)))
    return Array.from(new Set(rows.map(r => r.userId)))
  } catch (err) {
    throw new Error(`Failed to count admins: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  const others = await otherAdminUserIds(excludeUserId)
  if (!others.length) return 0
  try {
    const [{ value }] = await db.select({ value: count() }).from(users).where(and(inArray(users.id, others), eq(users.idUserStatus, 2)))
    return value
  } catch (err) {
    throw new Error(`Failed to count active admins: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function updateUserRoles(userId: string, roleIds: number[]): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  const targetCurrentlyAdmin = await userIsAdmin(userId)
  assertRoleChangeAllowed({
    targetUserId: userId,
    currentUserId,
    targetCurrentlyAdmin,
    newRolesIncludeAdmin: roleIds.includes(ROLE_ADMINISTRATOR),
    otherActiveAdminCount: await countOtherActiveAdmins(userId),
  })

  // Atomic full replace via RPC (delete + insert in one transaction) — schema.sql function, DEC-3.
  const finalRoleIds = Array.from(new Set<number>([ROLE_REGISTERED, ...roleIds]))
  try {
    // drizzle-orm's `sql` tag has no `.array()` helper — pass the Postgres array literal as a
    // bound text parameter and cast it explicitly, same idiom as writeTags's `::jsonb` cast (Task 7).
    const roleIdsArray = `{${finalRoleIds.join(',')}}`
    await db.execute(sql`select public.replace_user_roles(${userId}, ${roleIdsArray}::bigint[])`)
  } catch (err) {
    throw new Error(`Failed to assign roles: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function setUserStatus(userId: string, status: UserStatusId): Promise<void> {
  const { userId: currentUserId } = await requireAdmin()
  let targetIsAdmin = false
  let otherActiveAdminCount = 0
  if (status === 1) {
    targetIsAdmin = await userIsAdmin(userId)
    otherActiveAdminCount = await countOtherActiveAdmins(userId)
  }
  assertStatusChangeAllowed({ targetUserId: userId, currentUserId, newStatus: status, targetIsAdmin, otherActiveAdminCount })

  try {
    await db.update(users).set({ idUserStatus: status, lastStatusTs: new Date().toISOString() }).where(eq(users.id, userId))
  } catch (err) {
    throw new Error(`Failed to update status: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

- [ ] **Step 2: Replace `lib/rbac/auth-roles.ts` in full**

```ts
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { userRole } from '@/lib/db/schema'
import { ROLE_ADMINISTRATOR, ROLE_REGISTERED } from './types'

export function computeIsAdmin(roleIds: number[]): boolean {
  return roleIds.includes(ROLE_ADMINISTRATOR)
}

/**
 * Ensures the user has the Registered-user role, then returns all role ids.
 * Called from the NextAuth jwt callback once the user id is known.
 */
export async function resolveUserRoleIds(userId: string): Promise<number[]> {
  await db.insert(userRole).values({ userId, idRole: ROLE_REGISTERED }).onConflictDoNothing()
  try {
    const rows = await db.select({ idRole: userRole.idRole }).from(userRole).where(eq(userRole.userId, userId))
    return rows.map(r => r.idRole)
  } catch (err) {
    throw new Error(`Failed to resolve roles: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

- [ ] **Step 3: Run the existing `auth-roles.test.ts` to confirm `computeIsAdmin` is unaffected**

Run: `npx vitest run lib/rbac/auth-roles.test.ts`
Expected: PASS (unchanged — 2 tests).

- [ ] **Step 4: Verify the build and the users/RBAC E2E suites**

Run: `npm run build && uv run pytest sources/tests/e2e/test_users.py sources/tests/e2e/test_rbac.py`
Expected: build succeeds; all E2E tests pass unchanged (covers role assignment and status/deactivation lockout rules).

- [ ] **Step 5: Commit**

```bash
git add lib/rbac/users-actions.ts lib/rbac/auth-roles.ts
git commit -m "refactor(rbac): migrate users-actions.ts and auth-roles.ts to Drizzle"
```

---

## Task 9: Migrate `roles-actions.ts`

**Files:**
- Modify: `lib/rbac/roles-actions.ts`

**Interfaces:**
- Consumes: `db`, `role`, `roleType` from Task 1; `requireAdmin` unchanged.
- No unit test exists for this module; none added.

- [ ] **Step 1: Replace `lib/rbac/roles-actions.ts` in full**

```ts
'use server'

import { eq, sql } from 'drizzle-orm'
import { requireAdmin } from '@/lib/rbac/auth-guard'
import { db } from '@/lib/db'
import { role, roleType } from '@/lib/db/schema'
import type { PermissionDelta, RoleType as RoleTypeStr } from './types'

const ROLE_TYPE_SERVICE = 2

async function getRoleType(roleId: number): Promise<RoleTypeStr> {
  // Embedded-resource select (PostgREST `role_type:role_type(description)`) becomes an
  // explicit leftJoin (spec §2 pattern 5).
  const [row] = await db
    .select({ description: roleType.description })
    .from(role)
    .leftJoin(roleType, eq(role.idRoleType, roleType.idRoleType))
    .where(eq(role.idRole, roleId))
    .limit(1)
  if (!row) throw new Error('Role not found: no rows')
  return (row.description as RoleTypeStr) ?? 'SYSTEM'
}

export async function createRole(roleName: string): Promise<{ id: number }> {
  await requireAdmin()
  const name = roleName.trim()
  if (!name) throw new Error('Role name is required')
  try {
    const [created] = await db.insert(role).values({ description: name, idRoleType: ROLE_TYPE_SERVICE }).returning({ idRole: role.idRole })
    return { id: created.idRole }
  } catch (err) {
    throw new Error(`Failed to create role: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function renameRole(roleId: number, roleName: string): Promise<void> {
  await requireAdmin()
  const name = roleName.trim()
  if (!name) throw new Error('Role name is required')
  if ((await getRoleType(roleId)) !== 'SERVICE') throw new Error('This role cannot be renamed')
  try {
    await db.update(role).set({ description: name, dateMod: new Date().toISOString() }).where(eq(role.idRole, roleId))
  } catch (err) {
    throw new Error(`Failed to rename role: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function updateRolePermissions(roleId: number, deltas: PermissionDelta[]): Promise<void> {
  await requireAdmin()
  if ((await getRoleType(roleId)) === 'SYSTEM') throw new Error('System roles cannot be edited')

  const grantIds = deltas.filter(d => d.authorization).map(d => d.idItem)
  const revokeIds = deltas.filter(d => !d.authorization).map(d => d.idItem)

  // Atomic grant/revoke + date_mod stamp in one transaction via the schema.sql RPC (DEC-3).
  // drizzle-orm's `sql` tag has no `.array()` helper — pass each Postgres array literal as a
  // bound text parameter and cast it explicitly, same idiom as writeTags's `::jsonb` cast (Task 7)
  // and updateUserRoles's `::bigint[]` cast (Task 8).
  const grantIdsArray = `{${grantIds.join(',')}}`
  const revokeIdsArray = `{${revokeIds.join(',')}}`
  try {
    await db.execute(sql`select public.apply_role_permission_deltas(${roleId}, ${grantIdsArray}::bigint[], ${revokeIdsArray}::bigint[])`)
  } catch (err) {
    throw new Error(`Failed to update permissions: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function deleteRole(roleId: number): Promise<void> {
  await requireAdmin()
  if ((await getRoleType(roleId)) === 'SYSTEM') throw new Error('System roles cannot be deleted')
  try {
    await db.delete(role).where(eq(role.idRole, roleId))
  } catch (err) {
    throw new Error(`Failed to delete role: ${err instanceof Error ? err.message : String(err)}`)
  }
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Run the roles E2E suite**

Run: `uv run pytest sources/tests/e2e/test_roles.py`
Expected: all tests pass unchanged (covers create/rename/delete role and permission grant/revoke).

- [ ] **Step 4: Commit**

```bash
git add lib/rbac/roles-actions.ts
git commit -m "refactor(rbac): migrate roles-actions.ts to Drizzle"
```

---

## Task 10: Migrate `lib/auth.ts`

The most delicate module (login, upsert-on-first-login). No unit tests exist today for this file and none are added — correctness relies entirely on the E2E suite (spec §5).

**Files:**
- Modify: `lib/auth.ts`

**Interfaces:**
- Consumes: `db`, `users`, `allowedDomains` from Task 1; `resolveUserRoleIds`, `computeIsAdmin` from Task 8 (unchanged signatures); `authConfig`, `createLogger` unchanged.

- [ ] **Step 1: Replace `lib/auth.ts` in full**

```ts
import NextAuth, { CredentialsSignin } from 'next-auth'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import Google from 'next-auth/providers/google'
import Keycloak from 'next-auth/providers/keycloak'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, allowedDomains } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { authConfig } from '@/lib/auth.config'
import { resolveUserRoleIds, computeIsAdmin } from '@/lib/rbac/auth-roles'

const log = createLogger('auth')

// In-memory cache for allowed domains (60s TTL)
let domainCache: { domains: string[]; expiresAt: number } | null = null

async function getAllowedDomains(): Promise<string[]> {
  const now = Date.now()
  if (domainCache && domainCache.expiresAt > now) return domainCache.domains
  try {
    const rows = await db.select({ domain: allowedDomains.domain }).from(allowedDomains).where(eq(allowedDomains.active, true))
    const domains = rows.map(r => r.domain)
    domainCache = { domains, expiresAt: now + 60_000 }
    return domains
  } catch (err) {
    log.error({ err }, 'failed to retrieve allowed domains')
    return domainCache?.domains ?? []
  }
}

function buildProviders() {
  const providers = []

  if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID) {
    providers.push(
      MicrosoftEntraID({
        clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
        issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
          ? `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0/`
          : undefined,
      })
    )
  }

  if (process.env.AUTH_GOOGLE_ID) {
    providers.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      })
    )
  }

  if (process.env.AUTH_KEYCLOAK_ID) {
    providers.push(
      Keycloak({
        clientId: process.env.AUTH_KEYCLOAK_ID,
        clientSecret: process.env.AUTH_KEYCLOAK_SECRET!,
        issuer: process.env.AUTH_KEYCLOAK_ISSUER!,
      })
    )
  }

  // Production credentials provider — email + bcrypt password
  providers.push(
    Credentials({
      id: 'credentials',
      name: 'Email e password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (
          !credentials?.email ||
          !credentials?.password ||
          typeof credentials.email !== 'string' ||
          typeof credentials.password !== 'string'
        ) return null

        const [user] = await db
          .select({ id: users.id, email: users.email, name: users.name, passwordHash: users.passwordHash })
          .from(users)
          .where(eq(users.email, (credentials.email as string).toLowerCase().trim()))
          .limit(1)

        if (!user) {
          // Prevent timing-based user enumeration
          await bcrypt.compare('dummy', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW')
          return null
        }

        if (!user.passwordHash) {
          const err = new CredentialsSignin('Password not set')
          err.code = 'PasswordNotSet'
          throw err
        }

        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null

        await db.update(users).set({ authProvider: 'credentials' }).where(eq(users.id, user.id))

        return { id: user.id, email: user.email, name: user.name ?? user.email }
      },
    })
  )

  // Test-only credentials provider — gated by env var, never enabled in production
  if (process.env.AUTH_TEST_CREDENTIALS === 'true') {
    providers.push(
      Credentials({
        id: 'test',
        name: 'Test Credentials',
        credentials: {
          email: { label: 'Email', type: 'email' },
        },
        async authorize(credentials) {
          if (!credentials?.email || typeof credentials.email !== 'string') return null
          await db.insert(users).values({ email: credentials.email, authProvider: 'test' }).onConflictDoNothing({ target: users.email })
          const [data] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.email, credentials.email)).limit(1)
          if (!data) return null
          return { id: data.id, email: data.email, name: data.name ?? data.email }
        },
      })
    )
  }

  return providers
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: buildProviders(),
  session: { strategy: 'jwt' as const },
  callbacks: {
    async signIn({ account, profile }) {
      // Domain restriction for all OIDC providers
      const oidcProviders = ['google', 'microsoft-entra-id', 'keycloak']
      if (account?.provider && oidcProviders.includes(account.provider)) {
        const email = profile?.email ?? ''
        const domain = email.split('@')[1] ?? ''
        const allowed = await getAllowedDomains()
        if (!allowed.includes(domain)) return false
      }
      return true
    },
    async jwt({ token, user, account }) {
      if (account) token.provider = account.provider

      if (account && user) {
        let userId: string
        if (account.provider === 'credentials' || account.provider === 'test') {
          userId = user.id as string
        } else {
          try {
            const [data] = await db
              .insert(users)
              .values({
                email: user.email!,
                name: user.name,
                authProvider: account.provider,
                ...(user.image ? { avatar: user.image } : {}),
              })
              .onConflictDoUpdate({
                target: users.email,
                set: {
                  name: user.name,
                  authProvider: account.provider,
                  ...(user.image ? { avatar: user.image } : {}),
                },
              })
              .returning({ id: users.id })
            userId = data?.id ?? ''
          } catch (err) {
            log.error({ err }, 'failed to provision user in Supabase')
            throw err
          }
        }
        token.userId = userId
        const roleIds = userId ? await resolveUserRoleIds(userId) : []
        token.roleIds = roleIds
        token.isAdmin = computeIsAdmin(roleIds)
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.userId as string
      session.user.roleIds = (token.roleIds as number[]) ?? []
      session.user.isAdmin = Boolean(token.isAdmin)
      session.user.provider = token.provider as string
      return session
    },
  },
})
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Run the full auth-related E2E suites**

Run: `uv run pytest sources/tests/e2e/test_auth.py sources/tests/e2e/test_register.py`
Expected: all tests pass unchanged (login redirect, test-credentials login, register/forgot-password confirmation screens).

- [ ] **Step 4: Manual OIDC smoke check**

Run: `npm run dev`, sign in with the credentials provider (or the test-credentials provider if `AUTH_TEST_CREDENTIALS=true` locally) using an account that already exists, then with a brand-new email in an allowed domain.
Expected: existing user logs in and lands on the home page with the correct role/admin state; a brand-new email gets a `users` row upserted and the Registered-user role attached (unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts
git commit -m "refactor(auth): migrate lib/auth.ts to Drizzle"
```

---

## Task 11: Migrate the API routes and the set-password page

**Files:**
- Modify: `app/api/auth/register/route.ts`
- Modify: `app/api/auth/forgot-password/route.ts`
- Modify: `app/api/auth/set-password/route.ts`
- Modify: `app/api/auth/change-password/route.ts`
- Modify: `app/api/admin/send-invite/route.ts`
- Modify: `app/set-password/page.tsx`

**Interfaces:**
- Consumes: `db`, `users`, `passwordSetTokens` from Task 1; `sendEmail`, `createLogger`, `passwordSchema`, `auth` — all unchanged.
- `app/api/auth/register/route.ts`'s original `insert({ ..., role: 'user', ... })` referenced a `role` column that `schema.sql:48` already drops (`alter table users drop column if exists role`) — this field is removed here since `lib/db/schema.ts`'s `users` table has no `role` column to assign it to; this is a pre-existing dead/broken field, not a behavior change to anything actually persisted today.
- No unit tests exist for any of these files; none added. E2E coverage: `sources/tests/e2e/test_register.py` covers register + forgot-password. `set-password`, `change-password`, and `send-invite` have no E2E coverage — verify those three manually.

- [ ] **Step 1: Replace `app/api/auth/register/route.ts` in full**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, allowedDomains, passwordSetTokens } from '@/lib/db/schema'
import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth:register')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { email } = body ?? {}

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ ok: true })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const domain = normalizedEmail.split('@')[1] ?? ''

  log.info({ domain }, 'register attempt')

  // Domain allow-list check
  const [domainRow] = await db
    .select({ id: allowedDomains.id })
    .from(allowedDomains)
    .where(and(eq(allowedDomains.domain, domain), eq(allowedDomains.active, true)))
    .limit(1)
  if (!domainRow) {
    log.info({ domain }, 'domain not allowed, skipping')
    return NextResponse.json({ ok: true })
  }

  // Duplicate email check
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1)
  if (existing?.id) {
    log.info('email already registered, skipping')
    return NextResponse.json({ ok: true })
  }

  // Create user
  let newUser: { id: string } | undefined
  try {
    ;[newUser] = await db.insert(users).values({ email: normalizedEmail, authProvider: 'credentials' }).returning({ id: users.id })
  } catch (err) {
    log.error({ err }, 'failed to create user')
    return NextResponse.json({ ok: true })
  }
  if (!newUser?.id) {
    log.error('failed to create user')
    return NextResponse.json({ ok: true })
  }
  log.info({ userId: newUser.id }, 'user created')

  // Create set-password token (48h)
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  try {
    await db.insert(passwordSetTokens).values({ userId: newUser.id, token, expiresAt })
  } catch (err) {
    log.error({ err }, 'failed to create password token')
    await db.delete(users).where(eq(users.id, newUser.id))
    return NextResponse.json({ ok: true })
  }
  log.info({ userId: newUser.id }, 'password token created')

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    log.error('AUTH_URL / NEXTAUTH_URL not set')
    return NextResponse.json({ ok: true })
  }

  const setPasswordUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`
  if (process.env.NODE_ENV === 'development') {
    log.info({ setPasswordUrl }, 'dev: set-password link')
  }
  log.info('sending welcome email')

  try {
    await sendEmail({
      to: normalizedEmail,
      subject: 'Benvenuto in Construct — Imposta la tua password',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0f2336; font-size: 24px; margin-bottom: 8px;">Benvenuto in Construct</h1>
          <p style="color: #4a5568; font-size: 15px; line-height: 1.6;">
            Il tuo account è stato creato. Clicca sul pulsante qui sotto per impostare la tua password.
            Il link è valido per 48 ore.
          </p>
          <a href="${setPasswordUrl}"
             style="display:inline-block;margin-top:24px;padding:12px 28px;background:#0f5a8a;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Imposta la tua password
          </a>
          <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">
            Se non ti aspettavi questa email, ignorala.
          </p>
        </div>
      `,
      text: `Benvenuto in Construct.\n\nImposta la tua password al seguente link (valido 48 ore):\n${setPasswordUrl}\n\nSe non ti aspettavi questa email, ignorala.`,
    })
    log.info('welcome email sent')
  } catch (emailErr) {
    log.error({ err: emailErr }, 'failed to send welcome email')
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Replace `app/api/auth/forgot-password/route.ts` in full**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, passwordSetTokens } from '@/lib/db/schema'
import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth:forgot-password')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { email } = body ?? {}

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email mancante.' }, { status: 400 })
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1)

  // Always return 200 — do not leak whether the email exists
  // Only issue reset tokens for credentials users (those with a passwordHash)
  if (!user?.id || !user.passwordHash) return NextResponse.json({ ok: true })

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours

  try {
    await db.insert(passwordSetTokens).values({ userId: user.id, token, expiresAt })
  } catch (err) {
    log.error({ err }, 'failed to create reset token')
    return NextResponse.json({ ok: true })
  }

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    log.error('AUTH_URL / NEXTAUTH_URL not set')
    return NextResponse.json({ ok: true })
  }

  const resetUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`
  if (process.env.NODE_ENV === 'development') {
    log.info({ resetUrl }, 'dev: reset-password link')
  }

  try {
    await sendEmail({
      to: user.email!,
      subject: 'Reimposta la tua password — Construct',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0f2336; font-size: 24px; margin-bottom: 8px;">Reimposta la tua password</h1>
          <p style="color: #4a5568; font-size: 15px; line-height: 1.6;">
            Hai richiesto il reset della password. Clicca sul pulsante qui sotto per impostarne una nuova.
            Il link è valido per 2 ore.
          </p>
          <a href="${resetUrl}"
             style="display:inline-block;margin-top:24px;padding:12px 28px;background:#0f5a8a;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Reimposta la password
          </a>
          <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">
            Se non hai richiesto il reset, ignora questa email. La tua password non verrà modificata.
          </p>
        </div>
      `,
      text: `Hai richiesto il reset della password su Construct.\n\nReimposta la tua password al seguente link (valido 2 ore):\n${resetUrl}\n\nSe non hai richiesto il reset, ignora questa email.`,
    })
  } catch (emailErr) {
    log.error({ err: emailErr }, 'failed to send reset email')
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Replace `app/api/auth/set-password/route.ts` in full**

```ts
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, passwordSetTokens } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { passwordSchema } from '@/lib/validations'

const log = createLogger('auth:set-password')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { token, password } = body ?? {}

  if (!token || typeof token !== 'string' || !password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Parametri mancanti.' }, { status: 400 })
  }

  const parsed = passwordSchema.safeParse(password)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const [tokenRow] = await db
    .select({ id: passwordSetTokens.id, userId: passwordSetTokens.userId, expiresAt: passwordSetTokens.expiresAt, usedAt: passwordSetTokens.usedAt })
    .from(passwordSetTokens)
    .where(eq(passwordSetTokens.token, token))
    .limit(1)

  if (!tokenRow) {
    return NextResponse.json({ error: 'Link non valido.' }, { status: 410 })
  }
  if (tokenRow.usedAt) {
    return NextResponse.json({ error: 'Link già utilizzato.' }, { status: 410 })
  }
  if (new Date(tokenRow.expiresAt) < new Date()) {
    return NextResponse.json({ error: 'Link scaduto. Chiedi un nuovo invito.' }, { status: 410 })
  }

  const hash = await bcrypt.hash(password, 12)

  // Update password first — if this fails the token is still valid and the user can retry
  try {
    await db.update(users).set({ passwordHash: hash }).where(eq(users.id, tokenRow.userId))
  } catch (err) {
    log.error({ err }, 'failed to update password_hash')
    return NextResponse.json({ error: 'Errore interno. Riprova.' }, { status: 500 })
  }

  // Consume the token only after a successful password update.
  // The optimistic lock (usedAt is null) handles concurrent requests;
  // if it fails here the password is already set, so we treat it as success.
  const [claimed] = await db
    .update(passwordSetTokens)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(passwordSetTokens.id, tokenRow.id), isNull(passwordSetTokens.usedAt)))
    .returning({ id: passwordSetTokens.id })

  if (!claimed) {
    log.warn({ userId: tokenRow.userId }, 'token already consumed by concurrent request')
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Replace `app/api/auth/change-password/route.ts` in full**

```ts
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { createLogger } from '@/lib/logger'
import { passwordSchema } from '@/lib/validations'

const log = createLogger('auth:change-password')

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Non autenticato.' }, { status: 401 })
  }
  if (session.user.provider !== 'credentials') {
    return NextResponse.json({ error: 'Solo gli utenti con password interna possono cambiare la password.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const { currentPassword, newPassword } = body ?? {}

  if (
    !currentPassword || typeof currentPassword !== 'string' ||
    !newPassword || typeof newPassword !== 'string'
  ) {
    return NextResponse.json({ error: 'Dati mancanti.' }, { status: 400 })
  }

  const parsed = passwordSchema.safeParse(newPassword)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, session.user.id)).limit(1)

  if (!user?.passwordHash) {
    return NextResponse.json({ error: 'Nessuna password impostata per questo account.' }, { status: 400 })
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) {
    return NextResponse.json({ error: 'Password attuale non corretta.' }, { status: 400 })
  }

  const newHash = await bcrypt.hash(newPassword, 12)
  try {
    await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, session.user.id))
  } catch (err) {
    log.error({ err }, 'failed to update password hash')
    return NextResponse.json({ error: 'Errore interno. Riprova.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, requiresReauth: true })
}
```

- [ ] **Step 5: Replace `app/api/admin/send-invite/route.ts` in full**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, passwordSetTokens } from '@/lib/db/schema'
import { sendEmail } from '@/lib/mailer'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin:send-invite')

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || !session.user.isAdmin) {
    return NextResponse.json({ error: 'Non autorizzato.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const { userId } = body ?? {}

  if (!userId || typeof userId !== 'string') {
    return NextResponse.json({ error: 'userId mancante.' }, { status: 400 })
  }

  const [user] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1)

  if (!user?.email) {
    return NextResponse.json({ error: 'Utente non trovato.' }, { status: 404 })
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

  try {
    await db.insert(passwordSetTokens).values({ userId: user.id, token, expiresAt })
  } catch (err) {
    log.error({ err }, 'failed to create invite token')
    return NextResponse.json({ error: 'Errore interno.' }, { status: 500 })
  }

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!baseUrl) {
    log.error('AUTH_URL / NEXTAUTH_URL not set')
    return NextResponse.json({ error: 'Errore di configurazione del server.' }, { status: 500 })
  }
  const setPasswordUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${token}`

  try {
    await sendEmail({
      to: user.email,
      subject: 'Benvenuto in Construct — Imposta la tua password',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h1 style="color: #0f2336; font-size: 24px; margin-bottom: 8px;">Benvenuto in Construct</h1>
          <p style="color: #4a5568; font-size: 15px; line-height: 1.6;">
            Il tuo account è stato creato. Clicca sul pulsante qui sotto per impostare la tua password.
            Il link è valido per 48 ore.
          </p>
          <a href="${setPasswordUrl}"
             style="display:inline-block;margin-top:24px;padding:12px 28px;background:#0f5a8a;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Imposta la tua password
          </a>
          <p style="color: #9ca3af; font-size: 13px; margin-top: 24px;">
            Se non ti aspettavi questa email, ignorala.
          </p>
        </div>
      `,
      text: `Benvenuto in Construct.\n\nImposta la tua password al seguente link (valido 48 ore):\n${setPasswordUrl}\n\nSe non ti aspettavi questa email, ignorala.`,
    })
  } catch (emailErr) {
    log.error({ err: emailErr }, 'failed to send invite email')
    return NextResponse.json({ error: 'Errore invio email.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: Replace `app/set-password/page.tsx` in full**

```tsx
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { passwordSetTokens } from '@/lib/db/schema'
import { SetPasswordForm } from './SetPasswordForm'

interface Props {
  searchParams: Promise<{ token?: string }>
}

export default async function SetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams

  const invalid = !token || typeof token !== 'string'

  if (!invalid) {
    const [tokenRow] = await db
      .select({ id: passwordSetTokens.id, expiresAt: passwordSetTokens.expiresAt, usedAt: passwordSetTokens.usedAt })
      .from(passwordSetTokens)
      .where(eq(passwordSetTokens.token, token))
      .limit(1)

    const isValid =
      tokenRow &&
      !tokenRow.usedAt &&
      new Date(tokenRow.expiresAt) >= new Date()

    if (!isValid) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
          <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
            <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
              <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
            </div>
            <div className="bg-white px-8 py-8 text-center">
              <p className="text-red-600 font-medium">Link non valido o scaduto.</p>
              <p className="text-gray-500 text-sm mt-2">Contatta l&apos;amministratore per ricevere un nuovo invito.</p>
            </div>
          </div>
        </div>
      )
    }
  }

  if (invalid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
          <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
            <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
          </div>
          <div className="bg-white px-8 py-8 text-center">
            <p className="text-red-600 font-medium">Link non valido.</p>
            <p className="text-gray-500 text-sm mt-2">Contatta l&apos;amministratore.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-xl shadow-lg overflow-hidden">
        <div className="px-8 py-8 text-center" style={{ backgroundColor: '#0f2336' }}>
          <h1 className="text-3xl font-bold text-white tracking-tight">Construct</h1>
          <p className="mt-1 text-sm" style={{ color: '#7fa8c4' }}>Imposta la tua password</p>
        </div>
        <div className="bg-white px-8 py-8">
          <SetPasswordForm token={token!} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Run the register/forgot-password E2E suite**

Run: `uv run pytest sources/tests/e2e/test_register.py`
Expected: all tests pass unchanged.

- [ ] **Step 9: Manual checks for the flows with no E2E coverage**

Run: `npm run dev` and manually exercise:
- Set-password: register a new user (or use the admin "send invite" action), open the emailed/logged `set-password` link, submit a new password, confirm login with it works and the link is rejected as "già utilizzato" on a second submit.
- Change-password: log in with a credentials user, go to the change-password form, submit a wrong current password (expect rejection), then the correct one (expect success + re-auth prompt).
- Send-invite: as an admin, trigger "send invite" for an existing user from the Users admin page, confirm the invite email is logged/sent and the resulting link works.

- [ ] **Step 10: Commit**

```bash
git add app/api/auth/register/route.ts app/api/auth/forgot-password/route.ts app/api/auth/set-password/route.ts app/api/auth/change-password/route.ts app/api/admin/send-invite/route.ts app/set-password/page.tsx
git commit -m "refactor(auth): migrate remaining API routes and set-password page to Drizzle"
```

---

## Task 12: Remove `lib/supabase-server.ts` and `@supabase/supabase-js`; final verification

**Files:**
- Delete: `lib/supabase-server.ts`
- Modify: `package.json` (remove `@supabase/supabase-js`)

**Interfaces:**
- Consumes: nothing new — this task only removes what is now unused, after Tasks 1–11 have moved every call site to `db`.

- [ ] **Step 1: Confirm no application code still imports the old client**

Run: `grep -r "supabase-server\|createAdminClient\|@supabase/supabase-js" --include="*.ts" --include="*.tsx" . | grep -v node_modules`
Expected: only `lib/supabase-server.ts` itself (its own definition) appears — no other file references it.

- [ ] **Step 2: Delete `lib/supabase-server.ts`**

```bash
git rm lib/supabase-server.ts
```

- [ ] **Step 3: Remove the dependency**

```bash
npm uninstall @supabase/supabase-js
```

- [ ] **Step 4: Migration closure check**

Run: `grep -r "@supabase/supabase-js" --include="*.ts" --include="*.tsx" . | grep -v node_modules`
Expected: no output (package.json no longer lists it, and no import references it).

- [ ] **Step 5: Full verification**

Run: `npm run build && npm run lint && npx vitest run`
Expected: build succeeds, lint is clean, all Vitest suites pass.

Run: `uv run pytest`
Expected: the entire E2E suite passes.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(db): remove @supabase/supabase-js now that every call site uses Drizzle"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (deps/connection/schema) → Task 1. §2 patterns 1–5 (dynamic filters, paginated count, `role_list_view`, RPC calls, embedded selects) → Tasks 5, 6, 8, 9. §3 (error handling, no `.single()`) → applied inline in every task via try/catch + explicit `if (!row)` checks. §4 (migration order & files) → Tasks 2–11, same order. §5 (testing) → unit test rewrites in Tasks 5–6 only (the only two modules with existing unit tests), E2E run per task, full suite in Task 12. §6 (out of scope) → respected: no `schema.sql` changes, no `drizzle-kit` migrations, no RPC reimplementation, no new `lib/auth.ts` tests, no centralized error helper, no RLS changes.
- **Placeholder scan:** every step that changes code shows the complete file or complete new function; no "TBD"/"similar to Task N" markers.
- **Type consistency:** `toNavigationItemRow` (Task 4) is the single conversion point reused verbatim in Tasks 6 and 7; `applyUserFilters`/`applyFilters` signatures introduced in Tasks 5/6 are only consumed within their own files; `db`/table exports from Task 1 are the only shared contract every later task imports.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-18-supabase-to-drizzle-migration.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
