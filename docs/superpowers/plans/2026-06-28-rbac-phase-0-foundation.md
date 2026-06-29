# RBAC Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the RBAC foundation — the full database schema, the N:N role model wired into NextAuth, the unified `navigation_item`-driven sidebar — and retire the old `menu_items`/Menu Builder system, without locking anyone out.

**Architecture:** `navigation_item` replaces `menu_items` as the single source for the sidebar and permissions. The NextAuth JWT carries `roleIds` + `isAdmin` (resolved from `user_role`) instead of a single `role` string. The existing (complex, working) `Sidebar` is preserved by feeding it through a pure adapter that maps `navigation_item` + the user's authorized item set into the `MenuItem` view-model the Sidebar already understands.

**Tech Stack:** Next.js 16 (App Router) · React 19 · NextAuth v5 · Supabase (PostgreSQL, accessed via `createAdminClient()` service-role) · Tailwind v4 · Vitest (added here for unit tests) · Playwright + pytest (existing E2E).

## Global Constraints

- All DB access is server-side via `createAdminClient()` (service_role); RLS stays enabled on every table.
- Schema lives in one file: `sources/devops/db/schema.sql`. All DDL and seeds must be **idempotent** (`if not exists` / `on conflict do nothing`).
- Supported locales (data-only i18n), exact codes: `EN, IT, DE, FR, ES, NL, PT, SK, RO`. Default locale for chrome rendering: `EN`.
- Reserved IDs (verbatim): role `0`=Registered user, `1`=Administrator, `2`=Tenant Super Administrator; navigation_item `0`=`root`, `-1`=`operations`.
- `role_type`: `1`=SYSTEM, `2`=SERVICE, `3`=SYNCED. `navigation_item_type`: `1`=CATEGORY, `2`=FUNCTIONALITY. `functionality_type`: `1`=EMBEDDED_PAGE, `2`=EXTERNAL_LINK, `3`=INTERNAL_FUNCTIONALITY, `4`=REMOTE_DESKTOP, `5`=PERMISSION. `user_status`: `1`=Deactivated, `2`=Active.
- `role_item` uses a single `authorized boolean` (no CRUD columns) — per spec DEC-4.
- Multitenancy is dropped; `external_system` is dropped.
- **Deviation from spec note:** the legacy `users.role` column is **kept dormant** (not dropped) to keep the migration idempotent and re-runnable. Nothing reads it after this phase.
- RBAC routes requiring admin: `/userManagement`, `/functionalities`, `/rolesPermissions`.
- The three areas themselves (tables/forms) are **out of scope** for Phase 0 — built in Phases 1–3.
- Run `npm run lint` and `npm run build` clean before the final commit of any task that touches `.ts`/`.tsx`.

---

## File Structure

**Created:**
- `sources/microservices/web-construct/vitest.config.ts` — Vitest config (node env).
- `sources/microservices/web-construct/lib/rbac/types.ts` — shared RBAC types, locale + ID constants.
- `sources/microservices/web-construct/lib/rbac/auth-guard.ts` — `requireAdmin()`.
- `sources/microservices/web-construct/lib/rbac/sidebar-adapter.ts` — pure `navigation_item` → `MenuItem[]` mapping.
- `sources/microservices/web-construct/lib/rbac/sidebar-adapter.test.ts` — unit tests for the adapter.
- `sources/microservices/web-construct/lib/rbac/navigation-service.ts` — impure read-side service (`getSidebarMenu`).
- `sources/microservices/web-construct/lib/rbac/auth-roles.ts` — `resolveUserRoleIds()` + `computeIsAdmin()` + tests.
- `sources/microservices/web-construct/lib/rbac/auth-roles.test.ts`
- `sources/microservices/web-construct/lib/icon-utils.ts` — `isInlineSvg()` + test.
- `sources/microservices/web-construct/lib/icon-utils.test.ts`

**Modified:**
- `sources/devops/db/schema.sql` — add RBAC schema + seeds + migration; remove `menu_items` table/seed/RPC.
- `sources/microservices/web-construct/package.json` — add Vitest + `test` script.
- `sources/microservices/web-construct/lib/auth.ts` — JWT/session resolve `roleIds`/`isAdmin`.
- `sources/microservices/web-construct/lib/auth.config.ts` — session mapping + `authorized()` gate for RBAC routes.
- `sources/microservices/web-construct/types/next-auth.d.ts` — `roleIds`/`isAdmin` on Session/JWT.
- `sources/microservices/web-construct/context/AuthContext.tsx` — drop `role`, expose `isAdmin`.
- `sources/microservices/web-construct/components/IconRenderer.tsx` — render inline SVG when given SVG markup.
- `sources/microservices/web-construct/app/(protected)/layout.tsx` — feed sidebar from `navigation-service`.
- `sources/microservices/web-construct/types/menu.ts` — keep `MenuItem`/`ThemeConfig`/`AppSettings`; drop the table seed/util helpers that move out.

**Deleted:**
- `components/AdminMenuBuilder.tsx`, `app/(protected)/admin/menu-builder/page.tsx`
- `lib/menu-service.ts`, `lib/menu-actions.ts`, `lib/menu-utils.ts`
- `sources/tests/e2e/test_menu_builder.py`

**E2E updated:** `sources/tests/e2e/test_rbac.py` (point at new RBAC routes).

---

## Task 1: Add Vitest tooling

**Files:**
- Create: `sources/microservices/web-construct/vitest.config.ts`
- Modify: `sources/microservices/web-construct/package.json`
- Test: `sources/microservices/web-construct/lib/rbac/_smoke.test.ts` (temporary)

- [x] ✅ **Step 1: Add Vitest deps and script**

In `package.json`, add to `devDependencies`: `"vitest": "^3.2.4"`. Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [x] ✅ **Step 2: Install**

Run (from `sources/microservices/web-construct/`): `npm install`
Expected: completes; `vitest` resolves in `node_modules/.bin/`.

- [x] ✅ **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
```

- [x] ✅ **Step 4: Write a smoke test**

Create `lib/rbac/_smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('vitest wiring', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [x] ✅ **Step 5: Run it**

Run: `npm test`
Expected: PASS, 1 test passed.

- [x] ✅ **Step 6: Remove the smoke test and commit**

Delete `lib/rbac/_smoke.test.ts`.
```bash
git add sources/microservices/web-construct/package.json sources/microservices/web-construct/package-lock.json sources/microservices/web-construct/vitest.config.ts
git commit -m "chore(web): add vitest for unit tests"
```

---

## Task 2: RBAC database schema, seeds & migration

**Files:**
- Modify: `sources/devops/db/schema.sql`

**Interfaces:**
- Produces (DB objects later tasks rely on): tables `role`, `role_type`, `role_history`, `user_role`, `user_status`, `user_info`, `navigation_item`, `navigation_item_type`, `functionality_type`, `navigation_item_tag`, `role_item`; seeded role ids `0/1/2` and navigation ids `-1,0,1..5` + 8 PERMISSION items; `user_role` backfilled.

> DB verification uses the connected Supabase MCP tools (`mcp__supabase__apply_migration`, `mcp__supabase__execute_sql`). If running without MCP, apply `schema.sql` with `psql "$DATABASE_URL" -f sources/devops/db/schema.sql` and run the same verification queries.

- [x] ✅ **Step 1: Append lookup tables + sequences to `schema.sql`**

Append (after the existing tables, before the trigger section):
```sql
-- ============================================================
-- RBAC: lookup tables
-- ============================================================
create table if not exists role_type (
  id_role_type bigint primary key,
  description  text not null
);
insert into role_type (id_role_type, description) values
  (1, 'SYSTEM'), (2, 'SERVICE'), (3, 'SYNCED')
on conflict (id_role_type) do nothing;

create table if not exists navigation_item_type (
  id_item_type bigint primary key,
  description  text not null
);
insert into navigation_item_type (id_item_type, description) values
  (1, 'CATEGORY'), (2, 'FUNCTIONALITY')
on conflict (id_item_type) do nothing;

create table if not exists functionality_type (
  id_functionality_type bigint primary key,
  description           text not null
);
insert into functionality_type (id_functionality_type, description) values
  (1, 'EMBEDDED_PAGE'), (2, 'EXTERNAL_LINK'), (3, 'INTERNAL_FUNCTIONALITY'),
  (4, 'REMOTE_DESKTOP'), (5, 'PERMISSION')
on conflict (id_functionality_type) do nothing;

create table if not exists user_status (
  id_user_status bigint primary key,
  description    text not null
);
insert into user_status (id_user_status, description) values
  (1, 'Deactivated'), (2, 'Active')
on conflict (id_user_status) do nothing;
```

- [x] ✅ **Step 2: Append `role`, `role_history`, `user_role` + trigger**

```sql
-- ============================================================
-- RBAC: roles
-- ============================================================
create sequence if not exists s_id_role start 100;

create table if not exists role (
  id_role      bigint primary key default nextval('s_id_role'),
  id_role_type bigint references role_type(id_role_type),
  description  text not null,
  date_ins     timestamptz default now(),
  date_mod     timestamptz
);
alter table role enable row level security;

create table if not exists role_history (
  id_role     bigint not null,
  h_date_ins  timestamptz not null default now(),
  description text not null,
  date_ins    timestamptz,
  date_mod    timestamptz,
  primary key (id_role, h_date_ins)
);
alter table role_history enable row level security;

-- Archive a role into role_history before deletion (spec: trigger_role_delete)
create or replace function trg_role_delete()
returns trigger language plpgsql as $$
begin
  insert into role_history (id_role, description, date_ins, date_mod)
  values (old.id_role, old.description, old.date_ins, old.date_mod);
  return old;
end;
$$;
drop trigger if exists trigger_role_delete on role;
create trigger trigger_role_delete
  before delete on role for each row execute function trg_role_delete();

create table if not exists user_role (
  user_id  uuid   not null references users(id) on delete cascade,
  id_role  bigint not null references role(id_role) on delete cascade,
  date_ins timestamptz not null default now(),
  primary key (user_id, id_role)
);
alter table user_role enable row level security;

-- Seed system roles
insert into role (id_role, id_role_type, description) values
  (0, 1, 'Registered user'),
  (1, 1, 'Administrator'),
  (2, 1, 'Tenant Super Administrator')
on conflict (id_role) do nothing;
```

- [x] ✅ **Step 3: Append `navigation_item`, tag table, `role_item`**

```sql
-- ============================================================
-- RBAC: navigation items (replaces menu_items)
-- ============================================================
create sequence if not exists s_id_navigation_item start 100;

create table if not exists navigation_item (
  id_item                            bigint primary key default nextval('s_id_navigation_item'),
  name                               text,
  id_item_type                       bigint not null references navigation_item_type(id_item_type),
  id_functionality_type              bigint references functionality_type(id_functionality_type),
  functionality_link                 text,
  icon_path                          text,
  id_item_parent                     bigint references navigation_item(id_item) on delete cascade,
  order_position                     integer not null default 0,
  description                        text,
  navbar_position                    text check (navbar_position in ('TOP','BOTTOM')),
  item_translation                   jsonb,
  is_immutable                       smallint not null default 0,
  config_visibility                  smallint not null default 0,
  no_permission_need_for_navigation  smallint not null default 0,
  external_id                        text,
  click_count                        bigint default 0,
  created_at                         timestamptz default now(),
  updated_at                         timestamptz default now()
);
alter table navigation_item enable row level security;

create table if not exists navigation_item_tag (
  id_item  bigint not null references navigation_item(id_item) on delete cascade,
  tag_lan  varchar(5) not null,
  tag      varchar(50) not null,
  date_ins timestamptz not null default now(),
  primary key (id_item, tag_lan, tag)
);
alter table navigation_item_tag enable row level security;

create table if not exists role_item (
  id_role    bigint  not null references role(id_role) on delete cascade,
  id_item    bigint  not null references navigation_item(id_item) on delete cascade,
  authorized boolean not null default false,
  primary key (id_role, id_item)
);
alter table role_item enable row level security;

create or replace trigger navigation_item_updated_at
  before update on navigation_item
  for each row execute function set_updated_at();
```

- [x] ✅ **Step 4: Append `users` extension + `user_info`**

```sql
-- ============================================================
-- RBAC: extend users (keep uuid PK; legacy `role` column kept dormant)
-- ============================================================
alter table users add column if not exists sub                text;
alter table users add column if not exists country            varchar(3);
alter table users add column if not exists branch             text;
alter table users add column if not exists flow               text;
alter table users add column if not exists uom_role           text;
alter table users add column if not exists additional_company text;
alter table users add column if not exists owner_company      text;
alter table users add column if not exists features           text;
alter table users add column if not exists picture_url        text;
alter table users add column if not exists id_user_status     bigint references user_status(id_user_status) default 2;
alter table users add column if not exists last_status_ts     timestamptz;

create table if not exists user_info (
  user_id         uuid not null references users(id) on delete cascade,
  attribute_type  varchar(30) not null,
  attribute_value text not null,
  date_ins        timestamptz default now(),
  date_mod        timestamptz,
  primary key (user_id, attribute_type)
);
alter table user_info enable row level security;
```

- [x] ✅ **Step 5: Append navigation seed + Administrator permissions**

```sql
-- ============================================================
-- RBAC: seed system navigation items (immutable)
-- ============================================================
insert into navigation_item
  (id_item, name, id_item_type, id_functionality_type, functionality_link, id_item_parent, order_position, icon_path, navbar_position, item_translation, is_immutable, config_visibility)
values
  (-1, 'operations', 1, null, null, null, 0, null, null, '{"EN":{"name":"Operations"},"IT":{"name":"Operazioni"}}', 1, 1),
  (0,  'root',       1, null, null, null, 0, null, null, '{"EN":{"name":"All"},"IT":{"name":"Tutto"}}', 1, 1),
  (1,  'Home',       1, null, null, 0, 0, 'House', 'TOP', '{"EN":{"name":"Home"},"IT":{"name":"Home"}}', 1, 0),
  (2,  'RBAC',       1, null, null, 0, 1, 'Shield', null, '{"EN":{"name":"RBAC"},"IT":{"name":"RBAC"}}', 1, 0),
  (3,  'Users',      2, 3, 'userManagement', 2, 0, 'Users', null, '{"EN":{"name":"Users"},"IT":{"name":"Gestione utenti"}}', 1, 0),
  (4,  'Functionalities', 2, 3, 'functionalities', 2, 1, 'LayoutList', null, '{"EN":{"name":"Functionalities"},"IT":{"name":"Funzionalità"}}', 1, 0),
  (5,  'Roles & Permissions', 2, 3, 'rolesPermissions', 2, 2, 'ShieldCheck', null, '{"EN":{"name":"Roles & Permissions"},"IT":{"name":"Ruoli & permessi"}}', 1, 0)
on conflict (id_item) do nothing;

-- Technical RBAC permission items under operations (hidden from config UI)
insert into navigation_item
  (name, id_item_type, id_functionality_type, id_item_parent, order_position, is_immutable, config_visibility, item_translation)
select v.name, 2, 5, -1, v.ord, 1, 1, jsonb_build_object('EN', jsonb_build_object('name', v.name))
from (values
  ('USER_CREATE',0),('USER_READ',1),('USER_UPDATE',2),('USER_DELETE',3),
  ('PERMISSION_CREATE',4),('PERMISSION_READ',5),('PERMISSION_UPDATE',6),('PERMISSION_DELETE',7)
) as v(name, ord)
where not exists (select 1 from navigation_item n where n.name = v.name and n.id_item_parent = -1);

-- Administrator authorized on every navigation item
insert into role_item (id_role, id_item, authorized)
select 1, n.id_item, true from navigation_item n
on conflict (id_role, id_item) do update set authorized = true;
```

- [x] ✅ **Step 6: Append idempotent user→role backfill**

```sql
-- ============================================================
-- RBAC: backfill user_role from legacy users.role
-- ============================================================
-- Everyone gets Registered user (id 0)
insert into user_role (user_id, id_role)
select id, 0 from users
on conflict (user_id, id_role) do nothing;

-- Legacy admins get Administrator (id 1)
insert into user_role (user_id, id_role)
select id, 1 from users where role = 'admin'
on conflict (user_id, id_role) do nothing;
```

- [x] ✅ **Step 7: Remove the old `menu_items` system from `schema.sql`**

Delete from `schema.sql`: the `create table ... menu_items` block, its `alter table menu_items enable row level security;`, the `menu_items_updated_at` trigger, the `update_menu_orders` function, and the `insert into menu_items ... values (...)` seed block. Add in their place:
```sql
-- menu_items replaced by navigation_item (RBAC). Drop if present.
drop table if exists menu_items cascade;
drop function if exists public.update_menu_orders(jsonb);
```

- [x] ✅ **Step 8: Apply the schema**

Apply the full updated `schema.sql` to the database (via `mcp__supabase__apply_migration` with the file contents, name `rbac_phase0_foundation`; or `psql`).
Expected: applies without error.

- [x] ✅ **Step 9: Verify seeds and backfill**

Run via `mcp__supabase__execute_sql` (or psql):
```sql
select
  (select count(*) from role where id_role in (0,1,2))            as roles,           -- expect 3
  (select count(*) from navigation_item where id_item in (-1,0,1,2,3,4,5)) as nav_sys, -- expect 7
  (select count(*) from navigation_item where id_item_parent = -1 and id_functionality_type = 5) as perms, -- expect 8
  (select count(*) from role_item where id_role = 1)              as admin_perms,     -- expect >= 15
  (select count(*) from user_role where id_role = 0)              as registered,      -- expect = #users
  (select to_regclass('public.menu_items')) is null              as menu_items_gone;  -- expect true
```
Expected: roles=3, nav_sys=7, perms=8, admin_perms≥15, registered=(number of users), menu_items_gone=true.

- [x] ✅ **Step 10: Commit**

```bash
git add sources/devops/db/schema.sql
git commit -m "feat(db): add RBAC schema, seeds and user_role backfill; drop menu_items"
```

---

## Task 3: RBAC shared types & constants

**Files:**
- Create: `sources/microservices/web-construct/lib/rbac/types.ts`

**Interfaces:**
- Produces: `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `Locale`; role IDs `ROLE_REGISTERED=0`, `ROLE_ADMINISTRATOR=1`; nav IDs `ROOT_ID=0`, `OPERATIONS_ID=-1`; types `NavigationItemRow`, `RoleItemRow`, `ItemTranslation`.

- [x] ✅ **Step 1: Create the file**

```ts
export const SUPPORTED_LOCALES = ['EN', 'IT', 'DE', 'FR', 'ES', 'NL', 'PT', 'SK', 'RO'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'EN'

export const ROLE_REGISTERED = 0
export const ROLE_ADMINISTRATOR = 1

export const ROOT_ID = 0
export const OPERATIONS_ID = -1

export const ITEM_TYPE_CATEGORY = 1
export const ITEM_TYPE_FUNCTIONALITY = 2
export const FUNCTYPE_PERMISSION = 5

export interface ItemTranslation {
  name?: string
  description?: string
}

export interface NavigationItemRow {
  id_item: number
  name: string | null
  id_item_type: number
  id_functionality_type: number | null
  functionality_link: string | null
  icon_path: string | null
  id_item_parent: number | null
  order_position: number
  navbar_position: 'TOP' | 'BOTTOM' | null
  item_translation: Record<string, ItemTranslation> | null
  is_immutable: number
  config_visibility: number
  no_permission_need_for_navigation: number
}

export interface RoleItemRow {
  id_role: number
  id_item: number
  authorized: boolean
}
```

- [x] ✅ **Step 2: Typecheck & commit**

Run (from web-construct): `npx tsc --noEmit`
Expected: no errors from this file.
```bash
git add sources/microservices/web-construct/lib/rbac/types.ts
git commit -m "feat(rbac): add shared types and constants"
```

---

## Task 4: Role-resolution helpers (pure + DB)

**Files:**
- Create: `sources/microservices/web-construct/lib/rbac/auth-roles.ts`
- Test: `sources/microservices/web-construct/lib/rbac/auth-roles.test.ts`

**Interfaces:**
- Consumes: `ROLE_ADMINISTRATOR`, `ROLE_REGISTERED` from `./types`; `createAdminClient` from `@/lib/supabase-server`.
- Produces: `computeIsAdmin(roleIds: number[]): boolean`; `resolveUserRoleIds(userId: string): Promise<number[]>` (ensures Registered user, returns all role ids).

- [x] ✅ **Step 1: Write failing tests for the pure helper**

```ts
import { describe, it, expect } from 'vitest'
import { computeIsAdmin } from './auth-roles'

describe('computeIsAdmin', () => {
  it('is true when Administrator (1) is present', () => {
    expect(computeIsAdmin([0, 1])).toBe(true)
  })
  it('is false without Administrator', () => {
    expect(computeIsAdmin([0])).toBe(false)
    expect(computeIsAdmin([])).toBe(false)
  })
})
```

- [x] ✅ **Step 2: Run, expect fail**

Run: `npm test -- auth-roles`
Expected: FAIL (`computeIsAdmin` not exported / module missing).

- [x] ✅ **Step 3: Implement**

```ts
import { createAdminClient } from '@/lib/supabase-server'
import { ROLE_ADMINISTRATOR, ROLE_REGISTERED } from './types'

export function computeIsAdmin(roleIds: number[]): boolean {
  return roleIds.includes(ROLE_ADMINISTRATOR)
}

/**
 * Ensures the user has the Registered-user role, then returns all role ids.
 * Called from the NextAuth jwt callback once the user id is known.
 */
export async function resolveUserRoleIds(userId: string): Promise<number[]> {
  const supabase = createAdminClient()
  await supabase
    .from('user_role')
    .upsert({ user_id: userId, id_role: ROLE_REGISTERED }, { onConflict: 'user_id,id_role', ignoreDuplicates: true })
  const { data, error } = await supabase
    .from('user_role')
    .select('id_role')
    .eq('user_id', userId)
  if (error) throw new Error(`Failed to resolve roles: ${error.message}`)
  return (data ?? []).map((r: { id_role: number }) => r.id_role)
}
```

- [x] ✅ **Step 4: Run, expect pass**

Run: `npm test -- auth-roles`
Expected: PASS.

- [x] ✅ **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/auth-roles.ts sources/microservices/web-construct/lib/rbac/auth-roles.test.ts
git commit -m "feat(rbac): add role-resolution helpers"
```

---

## Task 5: Rewire NextAuth to carry roleIds + isAdmin

**Files:**
- Modify: `sources/microservices/web-construct/types/next-auth.d.ts`
- Modify: `sources/microservices/web-construct/lib/auth.ts:165-205` (jwt + session callbacks)
- Modify: `sources/microservices/web-construct/lib/auth.config.ts`
- Modify: `sources/microservices/web-construct/context/AuthContext.tsx`

**Interfaces:**
- Consumes: `resolveUserRoleIds`, `computeIsAdmin` from `@/lib/rbac/auth-roles`.
- Produces: `session.user.roleIds: number[]`, `session.user.isAdmin: boolean`; JWT `roleIds`, `isAdmin`.

- [x] ✅ **Step 1: Update NextAuth type augmentation**

Replace the contents of `types/next-auth.d.ts` with:
```ts
import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      roleIds: number[]
      isAdmin: boolean
      provider: string
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string
    roleIds: number[]
    isAdmin: boolean
    provider: string
  }
}
```

- [x] ✅ **Step 2: Rewire the `jwt` callback in `lib/auth.ts`**

In `lib/auth.ts`, replace the entire `async jwt({ token, user, account })` callback body (currently lines ~165-199) with:
```ts
    async jwt({ token, user, account }) {
      if (account) token.provider = account.provider

      if (account && user) {
        let userId: string
        if (account.provider === 'credentials' || account.provider === 'test') {
          userId = user.id as string
        } else {
          try {
            const supabase = createAdminClient()
            const { data } = await supabase
              .from('users')
              .upsert(
                {
                  email: user.email,
                  name: user.name,
                  auth_provider: account.provider,
                  ...(user.image ? { avatar: user.image } : {}),
                },
                { onConflict: 'email', ignoreDuplicates: false }
              )
              .select('id')
              .single()
            userId = (data?.id as string) ?? ''
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
```

- [x] ✅ **Step 3: Rewire the `session` callback in `lib/auth.ts`**

Replace the `async session({ session, token })` callback (currently lines ~200-205) with:
```ts
    async session({ session, token }) {
      session.user.id = token.userId as string
      session.user.roleIds = (token.roleIds as number[]) ?? []
      session.user.isAdmin = Boolean(token.isAdmin)
      session.user.provider = token.provider as string
      return session
    },
```

- [x] ✅ **Step 4: Add the import in `lib/auth.ts`**

After the existing imports near the top of `lib/auth.ts`, add:
```ts
import { resolveUserRoleIds, computeIsAdmin } from '@/lib/rbac/auth-roles'
```

- [x] ✅ **Step 5: Update `lib/auth.config.ts` — session mapping + RBAC gate**

Replace the `session(...)` callback in `auth.config.ts` with:
```ts
    session({ session, token }) {
      if (token.roleIds) (session.user as { roleIds?: number[] }).roleIds = token.roleIds as number[]
      if (typeof token.isAdmin !== 'undefined') (session.user as { isAdmin?: boolean }).isAdmin = Boolean(token.isAdmin)
      if (token.userId) (session.user as { id?: string }).id = token.userId as string
      if (token.provider) (session.user as { provider?: string }).provider = token.provider as string
      return session
    },
```
And replace the admin redirect block inside `authorized(...)` (the `pathname.startsWith('/admin')` line) with:
```ts
      const ADMIN_PATHS = ['/admin', '/userManagement', '/functionalities', '/rolesPermissions']
      const needsAdmin = ADMIN_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
      if (session && needsAdmin && !(session.user as { isAdmin?: boolean })?.isAdmin) {
        return Response.redirect(new URL('/', nextUrl))
      }
```

- [x] ✅ **Step 6: Update `AuthContext.tsx`**

Replace the `AuthUser` interface and `user` mapping in `context/AuthContext.tsx`:
```ts
interface AuthUser {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
  isAdmin: boolean
}
```
and
```ts
  const user: AuthUser | null = session?.user
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
        isAdmin: session.user.isAdmin,
      }
    : null
```

- [x] ✅ **Step 7: Typecheck**

Run (from web-construct): `npx tsc --noEmit`
Expected: no errors. (If `app/(protected)/admin/menu-builder/page.tsx` errors on `session.user.role`, that file is deleted in Task 9 — note it and proceed; do not re-add `role`.)

> Because the menu-builder page still references `session.user.role` until Task 9, do Step 8 commit only after confirming the **only** remaining `role` references are in files slated for deletion. Verify with: `grep -rn "user.role\b\|\.role\b" app components lib --include=*.ts --include=*.tsx | grep -v node_modules`.

- [x] ✅ **Step 8: Commit**

```bash
git add sources/microservices/web-construct/types/next-auth.d.ts sources/microservices/web-construct/lib/auth.ts sources/microservices/web-construct/lib/auth.config.ts sources/microservices/web-construct/context/AuthContext.tsx
git commit -m "feat(auth): carry roleIds + isAdmin in session; gate RBAC routes"
```

---

## Task 6: `requireAdmin` server guard

**Files:**
- Create: `sources/microservices/web-construct/lib/rbac/auth-guard.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth`.
- Produces: `requireAdmin(): Promise<{ userId: string; roleIds: number[] }>` — throws `Error('Unauthorized')` when not admin. Used by every Phase 1–3 server action.

- [x] ✅ **Step 1: Implement**

```ts
import { auth } from '@/lib/auth'

export async function requireAdmin(): Promise<{ userId: string; roleIds: number[] }> {
  const session = await auth()
  const user = session?.user as { id?: string; roleIds?: number[]; isAdmin?: boolean } | undefined
  if (!user?.isAdmin) throw new Error('Unauthorized')
  return { userId: user.id ?? '', roleIds: user.roleIds ?? [] }
}
```

- [x] ✅ **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → no errors.
```bash
git add sources/microservices/web-construct/lib/rbac/auth-guard.ts
git commit -m "feat(rbac): add requireAdmin server guard"
```

---

## Task 7: Pure sidebar adapter (navigation_item → MenuItem[])

**Files:**
- Create: `sources/microservices/web-construct/lib/rbac/sidebar-adapter.ts`
- Test: `sources/microservices/web-construct/lib/rbac/sidebar-adapter.test.ts`

**Interfaces:**
- Consumes: `NavigationItemRow`, `RoleItemRow`, `DEFAULT_LOCALE`, `ROOT_ID`, `OPERATIONS_ID`, `ITEM_TYPE_CATEGORY`, `FUNCTYPE_PERMISSION` from `./types`; `MenuItem` from `@/types/menu`.
- Produces: `resolveAuthorizedItemIds(items, roleItems, roleIds): Set<number>`; `mapNavigationToSidebar(items, authorizedIds, locale?): MenuItem[]`.

- [x] ✅ **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { resolveAuthorizedItemIds, mapNavigationToSidebar } from './sidebar-adapter'
import type { NavigationItemRow, RoleItemRow } from './types'

const cat = (id: number, parent: number | null, name: string, extra: Partial<NavigationItemRow> = {}): NavigationItemRow => ({
  id_item: id, name, id_item_type: 1, id_functionality_type: null, functionality_link: null,
  icon_path: null, id_item_parent: parent, order_position: 0, navbar_position: null,
  item_translation: { EN: { name } }, is_immutable: 0, config_visibility: 0,
  no_permission_need_for_navigation: 0, ...extra,
})
const fn = (id: number, parent: number | null, name: string, link: string, extra: Partial<NavigationItemRow> = {}): NavigationItemRow => ({
  ...cat(id, parent, name, extra), id_item_type: 2, id_functionality_type: 3, functionality_link: link,
})

describe('resolveAuthorizedItemIds', () => {
  const items: NavigationItemRow[] = [cat(0, null, 'root'), fn(3, 0, 'Users', 'userManagement'), fn(9, 0, 'Secret', 'secret')]
  const roleItems: RoleItemRow[] = [
    { id_role: 5, id_item: 3, authorized: true },
    { id_role: 5, id_item: 9, authorized: false },
  ]
  it('includes items authorized for one of the user roles', () => {
    const ids = resolveAuthorizedItemIds(items, roleItems, [5])
    expect(ids.has(3)).toBe(true)
    expect(ids.has(9)).toBe(false)
  })
  it('always includes no_permission_need items', () => {
    const open = [fn(7, 0, 'Open', 'open', { no_permission_need_for_navigation: 1 })]
    const ids = resolveAuthorizedItemIds(open, [], [])
    expect(ids.has(7)).toBe(true)
  })
})

describe('mapNavigationToSidebar', () => {
  const items: NavigationItemRow[] = [
    cat(-1, null, 'operations'),
    cat(0, null, 'root'),
    cat(2, 0, 'RBAC', { item_translation: { EN: { name: 'RBAC' } } }),
    fn(3, 2, 'Users', 'userManagement', { order_position: 0 }),
    fn(99, -1, 'USER_READ', '', { id_functionality_type: 5 }),
  ]
  const authorized = new Set([2, 3, 99])
  const result = mapNavigationToSidebar(items, authorized)

  it('omits the root and operations virtual nodes', () => {
    expect(result.find(i => i.id === '0')).toBeUndefined()
    expect(result.find(i => i.id === '-1')).toBeUndefined()
  })
  it('omits items under operations / PERMISSION items', () => {
    expect(result.find(i => i.id === '99')).toBeUndefined()
  })
  it('maps a top-level category to parentId null + type container', () => {
    const rbac = result.find(i => i.id === '2')!
    expect(rbac.parentId).toBeNull()
    expect(rbac.type).toBe('container')
    expect(rbac.label).toBe('RBAC')
  })
  it('maps a functionality with normalized route + parent', () => {
    const users = result.find(i => i.id === '3')!
    expect(users.type).toBe('link')
    expect(users.route).toBe('/userManagement')
    expect(users.parentId).toBe('2')
  })
})
```

- [x] ✅ **Step 2: Run, expect fail**

Run: `npm test -- sidebar-adapter`
Expected: FAIL (module missing).

- [x] ✅ **Step 3: Implement**

```ts
import type { MenuItem, MenuPosition } from '@/types/menu'
import {
  type NavigationItemRow, type RoleItemRow, type Locale,
  DEFAULT_LOCALE, ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY, FUNCTYPE_PERMISSION,
} from './types'

export function resolveAuthorizedItemIds(
  items: NavigationItemRow[],
  roleItems: RoleItemRow[],
  roleIds: number[],
): Set<number> {
  const roleSet = new Set(roleIds)
  const ids = new Set<number>()
  for (const ri of roleItems) {
    if (ri.authorized && roleSet.has(ri.id_role)) ids.add(ri.id_item)
  }
  for (const it of items) {
    if (it.no_permission_need_for_navigation === 1) ids.add(it.id_item)
  }
  return ids
}

function labelFor(it: NavigationItemRow, locale: Locale): string {
  return it.item_translation?.[locale]?.name ?? it.item_translation?.[DEFAULT_LOCALE]?.name ?? it.name ?? ''
}

function normalizeRoute(link: string | null): string | undefined {
  if (!link) return undefined
  if (link.startsWith('/') || link.startsWith('http')) return link
  return '/' + link
}

function isUnderOperations(it: NavigationItemRow, byId: Map<number, NavigationItemRow>): boolean {
  let cur: NavigationItemRow | undefined = it
  const seen = new Set<number>()
  while (cur) {
    if (cur.id_item === OPERATIONS_ID) return true
    if (cur.id_item_parent == null || seen.has(cur.id_item)) break
    seen.add(cur.id_item)
    cur = byId.get(cur.id_item_parent)
  }
  return false
}

export function mapNavigationToSidebar(
  items: NavigationItemRow[],
  authorizedIds: Set<number>,
  locale: Locale = DEFAULT_LOCALE,
): MenuItem[] {
  const byId = new Map(items.map(i => [i.id_item, i]))
  const out: MenuItem[] = []
  for (const it of items) {
    if (it.id_item === ROOT_ID || it.id_item === OPERATIONS_ID) continue
    if (isUnderOperations(it, byId)) continue
    if (it.id_functionality_type === FUNCTYPE_PERMISSION) continue
    if (it.config_visibility === 1) continue
    if (!authorizedIds.has(it.id_item)) continue

    const isCategory = it.id_item_type === ITEM_TYPE_CATEGORY
    const position: MenuPosition =
      it.navbar_position === 'TOP' ? 'top' : it.navbar_position === 'BOTTOM' ? 'bottom' : 'main'
    out.push({
      id: String(it.id_item),
      label: labelFor(it, locale),
      icon: it.icon_path ?? undefined,
      route: isCategory ? undefined : normalizeRoute(it.functionality_link),
      type: isCategory ? 'container' : 'link',
      parentId: it.id_item_parent == null || it.id_item_parent === ROOT_ID ? null : String(it.id_item_parent),
      order: it.order_position,
      visible: true,
      active: true,
      position,
      collapsible: isCategory ? true : undefined,
      system: it.is_immutable === 1,
    })
  }
  return out
}
```

- [x] ✅ **Step 4: Run, expect pass**

Run: `npm test -- sidebar-adapter`
Expected: PASS (all cases).

- [x] ✅ **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/sidebar-adapter.ts sources/microservices/web-construct/lib/rbac/sidebar-adapter.test.ts
git commit -m "feat(rbac): pure navigation_item -> sidebar adapter"
```

---

## Task 8: Navigation read-service + repoint the protected layout

**Files:**
- Create: `sources/microservices/web-construct/lib/rbac/navigation-service.ts`
- Modify: `sources/microservices/web-construct/app/(protected)/layout.tsx`

**Interfaces:**
- Consumes: `createAdminClient`; `resolveAuthorizedItemIds`, `mapNavigationToSidebar` from `./sidebar-adapter`; types from `./types`.
- Produces: `getSidebarMenu(roleIds: number[]): Promise<MenuItem[]>`.

- [x] ✅ **Step 1: Implement the service**

```ts
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase-server'
import { resolveAuthorizedItemIds, mapNavigationToSidebar } from './sidebar-adapter'
import type { NavigationItemRow, RoleItemRow } from './types'
import type { MenuItem } from '@/types/menu'

const NAV_COLUMNS =
  'id_item,name,id_item_type,id_functionality_type,functionality_link,icon_path,id_item_parent,order_position,navbar_position,item_translation,is_immutable,config_visibility,no_permission_need_for_navigation'

export const getSidebarMenu = cache(async (roleIds: number[]): Promise<MenuItem[]> => {
  const supabase = createAdminClient()
  const [{ data: navRows, error: navErr }, { data: roleRows, error: roleErr }] = await Promise.all([
    supabase.from('navigation_item').select(NAV_COLUMNS).order('order_position'),
    roleIds.length
      ? supabase.from('role_item').select('id_role,id_item,authorized').in('id_role', roleIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (navErr) throw new Error(`Failed to load navigation: ${navErr.message}`)
  if (roleErr) throw new Error(`Failed to load permissions: ${roleErr.message}`)

  const items = (navRows ?? []) as NavigationItemRow[]
  const roleItems = (roleRows ?? []) as RoleItemRow[]
  const authorized = resolveAuthorizedItemIds(items, roleItems, roleIds)
  return mapNavigationToSidebar(items, authorized)
})
```

- [x] ✅ **Step 2: Repoint the protected layout**

Replace the entire contents of `app/(protected)/layout.tsx`:
```tsx
import { auth } from '@/lib/auth'
import { getSidebarMenu } from '@/lib/rbac/navigation-service'
import { Layout } from '@/components/Layout'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const roleIds = (session?.user as { roleIds?: number[] })?.roleIds ?? []
  const menuItems = await getSidebarMenu(roleIds)
  return <Layout menuItems={menuItems}>{children}</Layout>
}
```

- [x] ✅ **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (menu-builder page error from Task 5, if any, persists until Task 9).

- [x] ✅ **Step 4: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/navigation-service.ts "sources/microservices/web-construct/app/(protected)/layout.tsx"
git commit -m "feat(rbac): drive sidebar from navigation_item + permissions"
```

---

## Task 9: Inline-SVG icon support

**Files:**
- Create: `sources/microservices/web-construct/lib/icon-utils.ts`
- Test: `sources/microservices/web-construct/lib/icon-utils.test.ts`
- Modify: `sources/microservices/web-construct/components/IconRenderer.tsx`

**Interfaces:**
- Produces: `isInlineSvg(value?: string): boolean`.

- [x] ✅ **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { isInlineSvg } from './icon-utils'

describe('isInlineSvg', () => {
  it('detects svg markup', () => {
    expect(isInlineSvg('<svg viewBox="0 0 24 24"></svg>')).toBe(true)
    expect(isInlineSvg('  <SVG></SVG>')).toBe(true)
  })
  it('treats lucide names as non-svg', () => {
    expect(isInlineSvg('Shield')).toBe(false)
    expect(isInlineSvg(undefined)).toBe(false)
    expect(isInlineSvg('')).toBe(false)
  })
})
```

- [x] ✅ **Step 2: Run, expect fail**

Run: `npm test -- icon-utils`
Expected: FAIL.

- [x] ✅ **Step 3: Implement `icon-utils.ts`**

```ts
export function isInlineSvg(value?: string): boolean {
  if (!value) return false
  return value.trim().toLowerCase().startsWith('<svg')
}
```

- [x] ✅ **Step 4: Run, expect pass**

Run: `npm test -- icon-utils`
Expected: PASS.

- [x] ✅ **Step 5: Use it in `IconRenderer.tsx`**

In `components/IconRenderer.tsx`, add `import { isInlineSvg } from '@/lib/icon-utils'`, and at the top of the component body (before `useMemo`) add:
```tsx
  if (isInlineSvg(name)) {
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: name! }}
      />
    )
  }
```
(Keep the existing lucide-name path below it unchanged.)

- [x] ✅ **Step 6: Typecheck & commit**

Run: `npx tsc --noEmit` → no new errors.
```bash
git add sources/microservices/web-construct/lib/icon-utils.ts sources/microservices/web-construct/lib/icon-utils.test.ts sources/microservices/web-construct/components/IconRenderer.tsx
git commit -m "feat(web): render inline SVG icons in IconRenderer"
```

---

## Task 10: Remove the old menu system

**Files:**
- Delete: `components/AdminMenuBuilder.tsx`, `app/(protected)/admin/menu-builder/page.tsx`, `lib/menu-service.ts`, `lib/menu-actions.ts`, `lib/menu-utils.ts`
- Modify: `types/menu.ts`
- Delete: `sources/tests/e2e/test_menu_builder.py`

**Interfaces:**
- Produces: `types/menu.ts` keeps `MenuPosition`, `MenuItemType`, `MenuItem`, `ThemeConfig`, `AppSettings`, `defaultThemeConfig`, `defaultSettings` (the latter two still consumed by the theme system).

- [x] ✅ **Step 1: Find every consumer of the deleted modules**

Run (from web-construct):
```bash
grep -rn "menu-service\|menu-actions\|menu-utils\|AdminMenuBuilder\|getMenuItems\|defaultMenu\|mapFromDb\|mapToDb" app components lib --include=*.ts --include=*.tsx | grep -v node_modules
```
Expected after this task: only matches should be inside `types/menu.ts` itself (none referencing the deleted files). Use this list to confirm nothing else imports them.

- [x] ✅ **Step 2: Move the still-needed defaults into `types/menu.ts`**

`defaultThemeConfig` and `defaultSettings` currently live in `lib/menu-utils.ts` but are needed by the theme/UI system. Confirm their consumers:
```bash
grep -rn "defaultThemeConfig\|defaultSettings" app components lib context --include=*.ts --include=*.tsx | grep -v node_modules
```
For each consumer importing them from `@/lib/menu-utils`, change the import to `@/types/menu`. Then append to `types/menu.ts`:
```ts
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
}

export const defaultSettings: AppSettings = {
  language: 'en',
  theme: 'light',
  themeConfig: defaultThemeConfig,
}
```
(If `defaultThemeConfig`/`defaultSettings` are not imported anywhere outside `menu-utils`, skip the import edits but still add them to `types/menu.ts` for the theme actions that reference them.)

- [x] ✅ **Step 3: Delete the old files**

```bash
git rm "sources/microservices/web-construct/components/AdminMenuBuilder.tsx" \
  "sources/microservices/web-construct/app/(protected)/admin/menu-builder/page.tsx" \
  "sources/microservices/web-construct/lib/menu-service.ts" \
  "sources/microservices/web-construct/lib/menu-actions.ts" \
  "sources/microservices/web-construct/lib/menu-utils.ts" \
  "sources/tests/e2e/test_menu_builder.py"
```

- [x] ✅ **Step 4: Remove the Admin/Menu-Builder seed entries reality-check**

The Menu Builder + Theme entries were seeded in the old `menu_items` table (already dropped in Task 2). The Theme page (`/admin/theme`) still exists and should remain reachable. Add a navigation_item seed for it so admins keep access. Append to `schema.sql` (in the navigation seed area):
```sql
insert into navigation_item
  (id_item, name, id_item_type, id_functionality_type, functionality_link, id_item_parent, order_position, icon_path, navbar_position, item_translation, is_immutable, config_visibility)
values
  (6, 'Admin', 1, null, null, 0, 9, 'Shield', 'BOTTOM', '{"EN":{"name":"Admin"}}', 1, 0),
  (7, 'Theme & Styles', 2, 3, 'admin/theme', 6, 0, 'Palette', 'BOTTOM', '{"EN":{"name":"Theme & Styles"}}', 1, 0)
on conflict (id_item) do nothing;

insert into role_item (id_role, id_item, authorized)
select 1, n.id_item from navigation_item n where n.id_item in (6,7)
on conflict (id_role, id_item) do update set authorized = true;
```
Re-apply `schema.sql` (idempotent) via the same method as Task 2 Step 8.

- [x] ✅ **Step 5: Typecheck, lint, build**

Run (from web-construct):
```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: all clean. (No remaining references to `session.user.role` or the deleted modules.)

- [x] ✅ **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(web): remove legacy menu_items system; reseed Admin/Theme nav"
```

---

## Task 11: E2E — RBAC gating & sidebar, no lock-out

**Files:**
- Modify: `sources/tests/e2e/test_rbac.py`

**Prerequisites (document at top of the test run, not code):** the dev server runs with `AUTH_TEST_CREDENTIALS=true`; `.env.test` defines `TEST_EMAIL` (a user who has the Administrator role — i.e. existed with legacy `role='admin'` so the Task 2 backfill granted role 1, or was granted via `insert into user_role values ('<uuid>', 1)`) and `TEST_EMAIL_USER` (a non-admin user). Confirm admin assignment with:
```sql
select u.email, array_agg(ur.id_role order by ur.id_role)
from users u join user_role ur on ur.user_id = u.id
where u.email in ('<TEST_EMAIL>', '<TEST_EMAIL_USER>') group by u.email;
```
Expected: TEST_EMAIL has `{0,1}`; TEST_EMAIL_USER has `{0}`.

- [x] ✅ **Step 1: Replace `test_rbac.py` route targets**

Replace the whole file with tests that target the new RBAC routes:
```python
import os
import pytest

RBAC_ROUTES = ["/userManagement", "/functionalities", "/rolesPermissions"]


@pytest.mark.parametrize("route", RBAC_ROUTES + ["/admin/theme"])
def test_unauthenticated_redirect(page, base_url, route):
    page.goto(f"{base_url}{route}")
    page.wait_for_load_state("networkidle")
    assert "/login" in page.url, f"Expected redirect to /login from {route}, got {page.url}"


@pytest.fixture
def non_admin_user_email():
    email = os.getenv("TEST_EMAIL_USER", "")
    if not email:
        pytest.skip("Set TEST_EMAIL_USER in .env.test to run non-admin RBAC tests")
    return email


@pytest.fixture
def non_admin_page(page, base_url, non_admin_user_email):
    page.goto(f"{base_url}/login")
    page.wait_for_load_state("networkidle")
    page.click('button:has-text("Accesso test")')
    page.fill('input[placeholder="Email di test"]', non_admin_user_email)
    page.click('button:has-text("Entra (test)")')
    page.wait_for_url(f"{base_url}/", timeout=15_000)
    page.wait_for_load_state("networkidle")
    yield page


@pytest.mark.parametrize("route", RBAC_ROUTES + ["/admin/theme"])
def test_non_admin_redirected(non_admin_page, base_url, route):
    non_admin_page.goto(f"{base_url}{route}")
    non_admin_page.wait_for_load_state("networkidle")
    assert route not in non_admin_page.url, f"Non-admin should not reach {route}, got {non_admin_page.url}"


def test_admin_not_locked_out(logged_in_page, base_url):
    """Admin still reaches the app root and sees the sidebar (no lock-out after migration)."""
    logged_in_page.goto(f"{base_url}/")
    logged_in_page.wait_for_load_state("networkidle")
    assert "/login" not in logged_in_page.url
    # Sidebar renders the user account row
    assert logged_in_page.locator('[data-testid="sidebar-toggle"]').count() >= 1
```

- [x] ✅ **Step 2: Start the dev server**

In a separate shell, from `sources/microservices/web-construct/`: `AUTH_TEST_CREDENTIALS=true npm run dev`
Wait for "Ready" on http://localhost:3000.

- [x] ✅ **Step 3: Run the E2E suite**

From repo root: `uv run pytest sources/tests/e2e/test_rbac.py -v`
Expected: all parametrized cases PASS (unauthenticated redirects, non-admin redirects, admin-not-locked-out).

- [x] ✅ **Step 4: Run the full E2E suite for regressions**

Run: `uv run pytest sources/tests/e2e -v`
Expected: PASS. `test_menu_builder.py` is gone; `test_sidebar.py` still passes (sidebar now sourced from navigation_item — if any sidebar test asserted a label that changed, update the expected label to the seeded translation, e.g. the RBAC entries).

- [x] ✅ **Step 5: Browser verification (per project rule)**

Manually (or with the `webapp-testing` skill): log in as admin, confirm the sidebar shows **Home** (top) and the **RBAC** container expanding to **Users / Functionalities / Roles & Permissions**, plus **Admin → Theme & Styles** at the bottom. Log in as a non-admin and confirm those entries are absent and the three routes redirect to `/`.

- [x] ✅ **Step 6: Commit**

```bash
git add sources/tests/e2e/test_rbac.py
git commit -m "test(e2e): gate the three RBAC routes; verify no admin lock-out"
```

---

## Self-Review (completed during planning)

**Spec coverage (spec → task):**
- Schema (users ext, roles, role_history+trigger, user_role, navigation_item, tags, role_item, lookups) → Task 2. ✓
- DEC-3 multitenancy dropped / DEC-5 external_system dropped → Task 2 (absent from DDL). ✓
- DEC-4 single `authorized` flag → Task 2 `role_item`. ✓
- DEC-1 unify nav + remove Menu Builder → Tasks 7, 8, 10. ✓
- DEC-6 extend existing `users` (uuid PK) → Task 2 Step 4. ✓
- DEC-8 `isAdmin` replaces role string → Tasks 5, 6. ✓
- §3.4 sidebar derivation (authorized OR no_permission_need; exclude operations/PERMISSION/config_visibility) → Task 7 adapter + tests. ✓
- §3.5 bootstrap/migration, no lock-out → Task 2 Steps 5–6 + Task 11 `test_admin_not_locked_out`. ✓
- §6 unit coverage for non-trivial logic + E2E + browser verify → Tasks 4,7,9 (vitest) + Task 11 (pytest/browser). ✓
- Inline-SVG icons (icon_path is SVG; renderer expected names) → Task 9. ✓

**Out of scope for Phase 0 (later phases, by design):** the three area UIs, `DataTable`/`NavigationTree` primitives, per-area server actions, all DTOs beyond the foundation types — Phases 1–3.

**Placeholder scan:** none — every code/SQL step is complete.

**Type consistency:** `roleIds`/`isAdmin` names identical across `next-auth.d.ts`, `auth.ts`, `auth.config.ts`, `auth-guard.ts`, `navigation-service.ts`. `MenuItem` shape produced by `mapNavigationToSidebar` matches `types/menu.ts`. `getSidebarMenu(roleIds)` signature matches its call in `layout.tsx`. `resolveUserRoleIds`/`computeIsAdmin` signatures match their import in `auth.ts`.
