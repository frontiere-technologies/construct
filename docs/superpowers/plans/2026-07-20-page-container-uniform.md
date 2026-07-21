# Page Container Uniformization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every page under `app/(protected)/` the same first-level container: `div.max-w-8xl.mx-auto` > title block (`mb-8`) + a single `bg-surface p-6 rounded-xl border border-border shadow-sm space-y-8` content block, via a new shared `PageContainer` component.

**Architecture:** One new presentational component (`components/PageContainer.tsx`) takes `title`/`subtitle`/`actions`/`children` and renders the fixed 3-level wrapper. Every page/client component that currently rolls its own wrapper (`max-w-7xl`, `max-w-5xl`, `max-w-4xl`, or no wrapper at all) is migrated to use it. Pages that today show multiple side-by-side cards (Profile, FunctionalityForm) get their inner blocks "flattened" from full `Card` styling to a lighter `rounded-xl border border-border-subtle p-6` so there's no card-in-card double border.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4.

## Global Constraints

- All file paths below are relative to `sources/microservices/web-construct/` — run every command from that directory (per project CLAUDE.md).
- Auth pages (`app/login`, `app/register`, `app/forgot-password`, `app/set-password`) are OUT of scope — do not touch them.
- `npm run lint` must stay clean after every task.
- `npm run build` must succeed after every task that touches a page actually rendered (all of them, in this plan).
- E2E checks use `uv run pytest` — never `pytest`/`python3` directly (per user's global instruction).
- No unit tests exist today for any of the components touched here (verified via `grep` across `*.test.tsx`) — this plan adds none; verification is build + lint + manual browser check per task, plus a final `uv run pytest` regression pass in the last task.
- Reference spec: `docs/superpowers/specs/2026-07-20-page-container-uniform-design.md`.

---

### Task 1: `--container-8xl` token + `PageContainer` component

**Files:**
- Modify: `sources/microservices/web-construct/app/globals.css`
- Create: `sources/microservices/web-construct/components/PageContainer.tsx`

**Interfaces:**
- Produces: `PageContainer({ title: ReactNode, subtitle?: ReactNode, actions?: ReactNode, children: ReactNode })` — used by every subsequent task.

- [ ] **Step 1: Add the `max-w-8xl` token**

In `app/globals.css`, the `@theme` block currently ends at line 39 with `--color-foreground-faint: var(--theme-foreground-faint);` followed by the closing `}`. Add the new line right before the closing brace:

```css
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
  --container-8xl: 88rem;
}
```

- [ ] **Step 2: Create `PageContainer`**

```tsx
import type { ReactNode } from 'react'

interface PageContainerProps {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function PageContainer({ title, subtitle, actions, children }: PageContainerProps) {
  return (
    <div className="max-w-8xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="text-foreground-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="bg-surface p-6 rounded-xl border border-border shadow-sm space-y-8">
        {children}
      </div>
    </div>
  )
}
```

Save to `components/PageContainer.tsx`.

- [ ] **Step 3: Verify build and lint**

Run (from `sources/microservices/web-construct/`):
```bash
npm run lint
npm run build
```
Expected: both exit 0, no errors. `PageContainer` is unused so far — that's fine, it's exported but not yet imported anywhere.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css components/PageContainer.tsx
git commit -m "feat(ui): add max-w-8xl token and shared PageContainer component"
```

---

### Task 2: Migrate `AdminTheme.tsx` (Theme & Styles page)

**Files:**
- Modify: `sources/microservices/web-construct/components/AdminTheme.tsx`

**Interfaces:**
- Consumes: `PageContainer` from Task 1.

- [ ] **Step 1: Replace the wrapper and drop the `Card` import**

Remove this import line:
```tsx
import { Card } from '@/components/Card'
```
Add instead:
```tsx
import { PageContainer } from '@/components/PageContainer'
```

Replace the current `return` block:
```tsx
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Theme & Styles</h1>
        <p className="text-foreground-muted">Customize your application appearance</p>
      </div>

      <Card className="space-y-8">
```
with:
```tsx
  return (
    <PageContainer title="Theme & Styles" subtitle="Customize your application appearance">
```

And replace the closing tags at the end of the same `return`:
```tsx
      </Card>
    </div>
  )
```
with:
```tsx
    </PageContainer>
  )
```

Everything between (the "Global" section, `TOKEN_GROUPS.map(...)`, and the Save/Reset bar) stays exactly as-is — only the wrapping tags change.

- [ ] **Step 2: Verify lint and build**

```bash
npm run lint
npm run build
```
Expected: both pass. No more references to `Card` in this file (confirm with `grep -n "Card" components/AdminTheme.tsx` — only unrelated matches, if any, should remain; there should be none since `Card`/`<Card` no longer appear).

- [ ] **Step 3: Manual browser check**

With the dev server running (`npm run dev` from `sources/microservices/web-construct/`, port 3000), open `http://localhost:3000/admin/theme` as an admin user. Confirm:
- The page content sits in a noticeably wider column than before (max-w-8xl vs 7xl).
- Title + subtitle render above a single bordered/shadowed card containing all token groups and the Save/Reset bar — same visual grouping as before, just wider.
- Toggle dark mode and confirm no visual regression.

- [ ] **Step 4: Commit**

```bash
git add components/AdminTheme.tsx
git commit -m "refactor(theme): migrate AdminTheme to PageContainer"
```

---

### Task 3: Migrate `user-management` and `roles-permissions` list pages

**Files:**
- Modify: `sources/microservices/web-construct/app/(protected)/user-management/page.tsx`
- Modify: `sources/microservices/web-construct/app/(protected)/roles-permissions/page.tsx`

**Interfaces:**
- Consumes: `PageContainer` from Task 1.

- [ ] **Step 1: Update `user-management/page.tsx`**

Add the import (alongside the existing ones):
```tsx
import { PageContainer } from '@/components/PageContainer'
```

Replace the `return`:
```tsx
  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Utenti</h1>
      <UsersTableClient
        sortField={(sp.sort as UsersQuery['sort']) ?? 'dateIns'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'DESC'}
        search={sp.search ?? ''}
        allRoles={allRoles}
        roleId={sp.roleIds ? Number(sp.roleIds.split(',')[0]) : null}
        statusId={sp.statuses ? (Number(sp.statuses.split(',')[0]) as UserStatusId) : null}
        createdFrom={sp.createdFrom ?? null}
        createdTo={sp.createdTo ?? null}
      />
    </div>
  )
```
with:
```tsx
  return (
    <PageContainer title="Utenti">
      <UsersTableClient
        sortField={(sp.sort as UsersQuery['sort']) ?? 'dateIns'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'DESC'}
        search={sp.search ?? ''}
        allRoles={allRoles}
        roleId={sp.roleIds ? Number(sp.roleIds.split(',')[0]) : null}
        statusId={sp.statuses ? (Number(sp.statuses.split(',')[0]) as UserStatusId) : null}
        createdFrom={sp.createdFrom ?? null}
        createdTo={sp.createdTo ?? null}
      />
    </PageContainer>
  )
```

`UsersTableClient` itself does not change — it already returns a bare fragment (toolbar row + `DataGrid`), no wrapper of its own.

- [ ] **Step 2: Update `roles-permissions/page.tsx`**

Add the import:
```tsx
import { PageContainer } from '@/components/PageContainer'
```

Replace the `return`:
```tsx
  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Ruoli &amp; permessi</h1>
      <RolesTableClient
        sortField={(sp.sort as RolesQuery['sort']) ?? 'id'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'ASC'}
        search={sp.search ?? ''}
        hasPermission={sp.hasPermission === 'true' ? true : sp.hasPermission === 'false' ? false : null}
        startDateIns={sp.startDateIns ?? null}
        endDateIns={sp.endDateIns ?? null}
      />
    </div>
  )
```
with:
```tsx
  return (
    <PageContainer title="Ruoli & permessi">
      <RolesTableClient
        sortField={(sp.sort as RolesQuery['sort']) ?? 'id'}
        sortDir={(sp.direction as 'ASC' | 'DESC') ?? 'ASC'}
        search={sp.search ?? ''}
        hasPermission={sp.hasPermission === 'true' ? true : sp.hasPermission === 'false' ? false : null}
        startDateIns={sp.startDateIns ?? null}
        endDateIns={sp.endDateIns ?? null}
      />
    </PageContainer>
  )
```

Note: `"Ruoli & permessi"` is now a plain JS string prop, so the `&amp;` HTML-entity escaping needed in raw JSX text is not needed — a literal `&` is correct here.

`RolesTableClient` does not change — same bare-fragment shape as `UsersTableClient`.

- [ ] **Step 3: Verify lint and build**

```bash
npm run lint
npm run build
```
Expected: both pass.

- [ ] **Step 4: Manual browser check**

Open `http://localhost:3000/user-management` and `http://localhost:3000/roles-permissions`. Confirm both:
- Title renders in the new `mb-8` block.
- Toolbar (search/filters/column-visibility/create buttons) AND the AG Grid table both sit together inside one bordered/shadowed `bg-surface` card.
- No double borders, grid still scrolls/sorts/filters normally.

- [ ] **Step 5: Commit**

```bash
git add "app/(protected)/user-management/page.tsx" "app/(protected)/roles-permissions/page.tsx"
git commit -m "refactor(rbac): migrate Utenti and Ruoli list pages to PageContainer"
```

---

### Task 4: Migrate `FunctionalitiesTreeClient.tsx` (Funzionalità list)

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/functionalities/FunctionalitiesTreeClient.tsx`

**Interfaces:**
- Consumes: `PageContainer` from Task 1.

- [ ] **Step 1: Add the import**

Add alongside the existing imports:
```tsx
import { PageContainer } from '@/components/PageContainer'
```

- [ ] **Step 2: Replace the wrapper**

Replace:
```tsx
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Funzionalità</h1>
      <div className="flex items-center justify-end gap-2 mb-4">
```
with:
```tsx
  return (
    <PageContainer title="Funzionalità">
      <div className="flex items-center justify-end gap-2">
```

Replace:
```tsx
      <div className="flex gap-6 border-b border-border-subtle mb-4">
        {(['root', 'operations'] as const).map(t => (
```
with:
```tsx
      <div className="flex gap-6 border-b border-border-subtle">
        {(['root', 'operations'] as const).map(t => (
```

Replace the closing tags:
```tsx
      <NavigationTree
        nodes={filterTree(activeTree)}
        renderTrailing={trailing}
        dnd={search.trim() ? undefined : { canDrag: n => !n.isImmutable, onMove }}
      />
    </div>
  )
```
with:
```tsx
      <NavigationTree
        nodes={filterTree(activeTree)}
        renderTrailing={trailing}
        dnd={search.trim() ? undefined : { canDrag: n => !n.isImmutable, onMove }}
      />
    </PageContainer>
  )
```

(The `FilterDrawer` block in between is untouched. The `mb-4` margins on the filter-row and the tabs-row are dropped because `PageContainer`'s inner card already applies `space-y-8` between direct children — keeping both would double the gap.)

- [ ] **Step 3: Verify lint and build**

```bash
npm run lint
npm run build
```
Expected: both pass.

- [ ] **Step 4: Manual browser check**

Open `http://localhost:3000/functionalities`. Confirm:
- Title, filter/search toolbar, the Sezioni/Operazioni tabs, and the navigation tree all sit inside one `bg-surface` card.
- The filter drawer still opens/closes and applies filters correctly.
- Drag-and-drop reordering in the tree still works (this is the area covered by `[[project_dndkit_drag_e2e]]` memory — no logic changed, only the wrapper, but worth a quick manual drag to be safe).

- [ ] **Step 5: Commit**

```bash
git add components/rbac/functionalities/FunctionalitiesTreeClient.tsx
git commit -m "refactor(rbac): migrate Funzionalità list to PageContainer"
```

---

### Task 5: Migrate `RoleDetailClient.tsx` (role detail page)

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/roles/RoleDetailClient.tsx`

**Interfaces:**
- Consumes: `PageContainer` from Task 1.

- [ ] **Step 1: Add the import**

```tsx
import { PageContainer } from '@/components/PageContainer'
```

- [ ] **Step 2: Replace the wrapper**

Replace the whole `return` block:
```tsx
  return (
    <div className="max-w-5xl mx-auto">
      <div className="text-sm text-gray-500 mb-2"><Link href="/roles-permissions" className="hover:text-gray-700 hover:underline">Ruoli &amp; permessi</Link> / Dettagli</div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{role.roleName}</h1>
            {canRename && (
              <button data-testid="rename-role-btn" onClick={() => setRenaming(true)} className="text-gray-400 hover:text-gray-700"><Pencil size={18} /></button>
            )}
          </div>
          <p className="text-sm text-gray-500">{role.associatedUsersCount} Utenti associati</p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={cancel} className="px-4 py-2 text-sm rounded-lg border border-border">Annulla</button>
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

      <div className="flex gap-6 border-b border-border-subtle mb-4">
        {(['sezioni', 'operazioni'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-gray-900 text-foreground dark:border-white' : 'border-transparent text-gray-500'}`}
          >{t === 'sezioni' ? 'Sezioni' : 'Operazioni'}</button>
        ))}
      </div>

      <PermissionsTree trees={trees} map={map} onChange={setMap} editable={editing} />

      {renaming && <RenameRoleModal roleId={role.id} currentName={role.roleName} onClose={() => setRenaming(false)} />}
    </div>
  )
```
with:
```tsx
  return (
    <PageContainer
      title={
        <>
          <div className="text-sm font-normal text-gray-500 mb-1">
            <Link href="/roles-permissions" className="hover:text-gray-700 hover:underline">Ruoli &amp; permessi</Link> / Dettagli
          </div>
          <div className="flex items-center gap-2">
            {role.roleName}
            {canRename && (
              <button data-testid="rename-role-btn" onClick={() => setRenaming(true)} className="text-gray-400 hover:text-gray-700"><Pencil size={18} /></button>
            )}
          </div>
        </>
      }
      subtitle={`${role.associatedUsersCount} Utenti associati`}
      actions={
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={cancel} className="px-4 py-2 text-sm rounded-lg border border-border">Annulla</button>
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
      }
    >
      <div className="flex gap-6 border-b border-border-subtle">
        {(['sezioni', 'operazioni'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-gray-900 text-foreground dark:border-white' : 'border-transparent text-gray-500'}`}
          >{t === 'sezioni' ? 'Sezioni' : 'Operazioni'}</button>
        ))}
      </div>

      <PermissionsTree trees={trees} map={map} onChange={setMap} editable={editing} />

      {renaming && <RenameRoleModal roleId={role.id} currentName={role.roleName} onClose={() => setRenaming(false)} />}
    </PageContainer>
  )
```

Note the breadcrumb line now renders inside `PageContainer`'s `<h1>` (with its own `text-sm font-normal text-gray-500` overriding the inherited bold/size), and the "N Utenti associati" caption moves into the `subtitle` slot — same visual position as before, just routed through the shared component.

- [ ] **Step 3: Verify lint and build**

```bash
npm run lint
npm run build
```
Expected: both pass.

- [ ] **Step 4: Manual browser check**

Open a role detail page, e.g. `http://localhost:3000/roles-permissions/1`. Confirm:
- Breadcrumb still reads "Ruoli & permessi / Dettagli" above the role name.
- "N Utenti associati" still appears right under the role name.
- Modifica/Annulla/Salva buttons still sit top-right, aligned with the title row.
- Tabs + permissions tree sit inside the single bordered card below.
- Editing permissions and saving still works.

- [ ] **Step 5: Commit**

```bash
git add components/rbac/roles/RoleDetailClient.tsx
git commit -m "refactor(rbac): migrate role detail page to PageContainer"
```

---

### Task 6: Migrate `Home.tsx` (dashboard / catch-all placeholder page)

**Files:**
- Modify: `sources/microservices/web-construct/components/Home.tsx`

**Interfaces:**
- Consumes: `PageContainer` from Task 1.

- [ ] **Step 1: Add the import**

```tsx
import { PageContainer } from '@/components/PageContainer'
```

- [ ] **Step 2: Replace the wrapper and flatten the stat/content cards**

Replace the whole `return`:
```tsx
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">{toTitle(pathname)}</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-surface p-6 rounded-xl shadow-sm border border-border-subtle">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Total Users</h3>
          <p className="text-3xl font-bold">12,450</p>
        </div>
        <div className="bg-surface p-6 rounded-xl shadow-sm border border-border-subtle">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Active Sessions</h3>
          <p className="text-3xl font-bold">1,234</p>
        </div>
        <div className="bg-surface p-6 rounded-xl shadow-sm border border-border-subtle">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Revenue</h3>
          <p className="text-3xl font-bold">$45,678</p>
        </div>
      </div>

      <div className="bg-surface p-8 rounded-xl shadow-sm border border-border-subtle min-h-[400px]">
        <h2 className="text-xl font-semibold mb-4">Content Area</h2>
        <p className="text-foreground-muted">
          This is a placeholder page for <strong>{pathname}</strong>.
          Navigate using the sidebar to see the active state change.
        </p>
        <p className="text-foreground-muted mt-4">
          Go to the <strong>Admin Panel</strong> (bottom of sidebar) to configure the menu structure dynamically.
        </p>
      </div>
    </div>
  )
```
with:
```tsx
  return (
    <PageContainer title={toTitle(pathname)}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-xl border border-border-subtle p-6">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Total Users</h3>
          <p className="text-3xl font-bold">12,450</p>
        </div>
        <div className="rounded-xl border border-border-subtle p-6">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Active Sessions</h3>
          <p className="text-3xl font-bold">1,234</p>
        </div>
        <div className="rounded-xl border border-border-subtle p-6">
          <h3 className="text-gray-500 text-sm font-medium mb-2">Revenue</h3>
          <p className="text-3xl font-bold">$45,678</p>
        </div>
      </div>

      <div className="rounded-xl border border-border-subtle p-8 min-h-[400px]">
        <h2 className="text-xl font-semibold mb-4">Content Area</h2>
        <p className="text-foreground-muted">
          This is a placeholder page for <strong>{pathname}</strong>.
          Navigate using the sidebar to see the active state change.
        </p>
        <p className="text-foreground-muted mt-4">
          Go to the <strong>Admin Panel</strong> (bottom of sidebar) to configure the menu structure dynamically.
        </p>
      </div>
    </PageContainer>
  )
```

(`bg-surface`/`shadow-sm` are dropped from the three stat tiles and the content-area block — per the approved "flatten" decision — leaving `rounded-xl border border-border-subtle` as the lighter separator, since they now live inside the outer `bg-surface` card. Title goes from `text-3xl` to `PageContainer`'s fixed `text-2xl font-bold` — an intentional size normalization across pages.)

- [ ] **Step 3: Verify lint and build**

```bash
npm run lint
npm run build
```
Expected: both pass.

- [ ] **Step 4: Manual browser check**

Open `http://localhost:3000/` (Home) and any unmapped route, e.g. `http://localhost:3000/some-random-path` (served by the catch-all `[...slug]` page, same `Home` component). Confirm:
- Title matches the route name.
- 3 stat tiles + content area no longer look like separate floating cards, but read as lighter subsections inside one bordered card.
- Dark mode still looks correct (no invisible borders).

- [ ] **Step 5: Commit**

```bash
git add components/Home.tsx
git commit -m "refactor(home): migrate dashboard placeholder to PageContainer"
```

---

### Task 7: Migrate `ProfileForm.tsx` + `ChangePasswordForm.tsx`

**Files:**
- Modify: `sources/microservices/web-construct/components/ProfileForm.tsx`
- Modify: `sources/microservices/web-construct/components/ChangePasswordForm.tsx`

**Interfaces:**
- Consumes: `PageContainer` from Task 1.

These two ship together: they're rendered side-by-side in the same grid on `/profile`, and both currently use the `Card` component — leaving one migrated and the other not would produce a mismatched pair (one flattened box, one full card) on the same page.

- [ ] **Step 1: Update `ProfileForm.tsx` imports**

Remove:
```tsx
import { Card } from '@/components/Card'
```
Add:
```tsx
import { PageContainer } from '@/components/PageContainer'
```

- [ ] **Step 2: Replace `ProfileForm`'s wrapper**

Replace:
```tsx
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-foreground-muted">Manage your account settings</p>
      </div>

      <div className={`grid gap-6 ${provider === 'credentials' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
        <Card className="w-full">
```
with:
```tsx
  return (
    <PageContainer title="Profile" subtitle="Manage your account settings">
      <div className={`grid gap-6 ${provider === 'credentials' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
        <div className="w-full rounded-xl border border-border-subtle p-6">
```

And replace the matching closing tags at the end of the same `return`:
```tsx
        </Card>
        {provider === 'credentials' && <ChangePasswordForm />}
      </div>
    </div>
  )
```
with:
```tsx
        </div>
        {provider === 'credentials' && <ChangePasswordForm />}
      </div>
    </PageContainer>
  )
```

Everything between (avatar, email/first name/last name/username/phone fields, save button, status message) is untouched.

- [ ] **Step 3: Update `ChangePasswordForm.tsx`**

Remove:
```tsx
import { Card } from '@/components/Card'
```

Replace:
```tsx
  return (
    <Card className="w-full">
      <h2 className="text-sm font-semibold text-foreground-secondary mb-4">
        Cambia password
      </h2>
```
with:
```tsx
  return (
    <div className="w-full rounded-xl border border-border-subtle p-6">
      <h2 className="text-sm font-semibold text-foreground-secondary mb-4">
        Cambia password
      </h2>
```

And replace the closing tags at the end of the same `return`:
```tsx
      </form>
    </Card>
  )
```
with:
```tsx
      </form>
    </div>
  )
```

- [ ] **Step 4: Verify lint and build**

```bash
npm run lint
npm run build
```
Expected: both pass. Confirm no remaining `Card` references in either file:
```bash
grep -n "Card" components/ProfileForm.tsx components/ChangePasswordForm.tsx
```
Expected: no output.

- [ ] **Step 5: Manual browser check**

Open `http://localhost:3000/profile` (logged in as a `credentials`-provider user, to see both columns). Confirm:
- Title/subtitle in the `mb-8` block.
- Profile form and "Cambia password" form sit side-by-side (or stacked, for non-credentials providers) inside one outer bordered card, each with its own lighter inner border instead of a full drop-shadow card.
- Saving the profile and changing the password still work end-to-end.

- [ ] **Step 6: Commit**

```bash
git add components/ProfileForm.tsx components/ChangePasswordForm.tsx
git commit -m "refactor(profile): flatten Profile and ChangePassword cards into PageContainer"
```

---

### Task 8: Migrate `FunctionalityForm.tsx` (create + edit routes)

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx`

**Interfaces:**
- Consumes: `PageContainer` from Task 1.

- [ ] **Step 1: Add the import**

```tsx
import { PageContainer } from '@/components/PageContainer'
```

- [ ] **Step 2: Replace the wrapper**

Replace:
```tsx
  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Funzionalità / {mode === 'create' ? 'Crea' : 'Modifica'}</h1>
        <div className="flex flex-col items-end gap-2">
          <button onClick={submit} disabled={!valid || busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed">
            {mode === 'create' ? 'Crea funzionalità' : 'Salva'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
```
with:
```tsx
  return (
    <PageContainer
      title={`Funzionalità / ${mode === 'create' ? 'Crea' : 'Modifica'}`}
      actions={
        <div className="flex flex-col items-end gap-2">
          <button onClick={submit} disabled={!valid || busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed">
            {mode === 'create' ? 'Crea funzionalità' : 'Salva'}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
```

And replace the closing tags at the end of the same `return`:
```tsx
      </div>
    </div>
  )
```
with:
```tsx
      </div>
    </PageContainer>
  )
```

The two-column grid content (the "Informazioni generali" box and the "Gestione traduzioni" box, both already `rounded-xl border border-border-subtle p-4`) is untouched — it already matches the lighter-box convention, no flattening needed.

- [ ] **Step 3: Verify lint and build**

```bash
npm run lint
npm run build
```
Expected: both pass.

- [ ] **Step 4: Manual browser check**

Open `http://localhost:3000/functionalities/create` and the edit route for an existing item, e.g. `http://localhost:3000/functionalities/<id>/edit`. Confirm:
- Title + Crea/Salva button (and validation error, if any) sit in the header row, aligned like before.
- The two info/translation boxes render inside the outer card, unchanged visually.
- Creating and editing a functionality still works (submit navigates to `/functionalities`).

- [ ] **Step 5: Commit**

```bash
git add components/rbac/functionalities/FunctionalityForm.tsx
git commit -m "refactor(rbac): migrate FunctionalityForm to PageContainer"
```

---

### Task 9: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Full lint + build**

```bash
npm run lint
npm run build
```
Expected: both clean.

- [ ] **Step 2: E2E regression**

From the repo root:
```bash
uv run pytest
```
Expected: all existing tests pass (none reference the classes changed here, so no updates to test files are expected).

- [ ] **Step 3: Full manual click-through**

With the dev server running, visit every migrated route in both light and dark mode and confirm the container is `max-w-8xl`, the title sits in its own `mb-8` block, and everything else is inside exactly one `bg-surface p-6 rounded-xl border border-border shadow-sm` card:
- `/admin/theme`
- `/user-management`
- `/roles-permissions`
- `/roles-permissions/<id>`
- `/functionalities`
- `/functionalities/create`
- `/functionalities/<id>/edit`
- `/profile`
- `/` (Home) and one catch-all path

- [ ] **Step 4: Confirm no leftover `max-w-7xl`/`max-w-5xl`/`max-w-4xl` or direct `Card` usage in migrated files**

```bash
grep -rn "max-w-7xl\|max-w-5xl\|max-w-4xl" app components | grep -v node_modules
grep -rln "from '@/components/Card'" app components | grep -v node_modules
```
Expected: no matches in any of the 9 files touched by this plan. (`components/Card.tsx` itself still exists and is intentionally left in place for future reuse, per the spec.)

- [ ] **Step 5: Final commit (if anything was fixed during regression)**

Only if Steps 1–4 required fixes:
```bash
git add -A
git commit -m "fix: address regressions found in PageContainer migration"
```
If nothing needed fixing, skip this step — there is nothing to commit.
