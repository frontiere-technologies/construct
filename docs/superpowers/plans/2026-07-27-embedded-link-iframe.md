# Embedded Link Iframe Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** items of type `EMBEDDED_PAGE` open inside an `<iframe>` in the app's main content area instead of navigating away from the webapp.

**Architecture:** a new internal route `/embedded/[itemId]` resolves the navigation item, checks RBAC authorization, does a server-side HTTP header check to decide whether the target URL can be embedded, and renders either an `<iframe>` or a fallback notice with an "open in new tab" link. `sidebar-adapter.ts` is changed so `EMBEDDED_PAGE` items route to this internal page instead of directly to the external URL.

**Tech Stack:** Next.js 16 App Router (server components), TypeScript, Drizzle ORM, Vitest (unit), Playwright via pytest (e2e).

## Global Constraints

- Only `EMBEDDED_PAGE` (`id_functionality_type = 1`) items get the new iframe behavior. `EXTERNAL_LINK` (2) and `INTERNAL_FUNCTIONALITY` (3) keep today's behavior unchanged — no `target="_blank"` introduced, no other change to their routing.
- No new fields added to `FunctionalityForm.tsx` — the existing "Link esterno embedded (iframe)" type selection is sufficient.
- The embeddability check runs server-side (never trust client-side detection of `X-Frame-Options`/CSP framing restrictions).
- On any check failure (timeout, network error, malformed URL) the page must show the fallback notice, never render the iframe silently.
- No caching of the embeddability check result across requests (YAGNI for current volume).

Source spec: [docs/superpowers/specs/2026-07-27-embedded-link-iframe-design.md](../specs/2026-07-27-embedded-link-iframe-design.md)

---

### Task 1: `FUNCTYPE_EMBEDDED_PAGE` constant + internal routing in `sidebar-adapter.ts`

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/types.ts:14-16`
- Modify: `sources/microservices/web-construct/lib/rbac/sidebar-adapter.ts:1-5,66`
- Test: `sources/microservices/web-construct/lib/rbac/sidebar-adapter.test.ts`

**Interfaces:**
- Produces: `FUNCTYPE_EMBEDDED_PAGE = 1` (exported constant from `lib/rbac/types.ts`), consumed by Task 3's route page.
- Produces: `mapNavigationToSidebar()` now emits `route: "/embedded/{id_item}"` for any non-category item with `id_functionality_type === FUNCTYPE_EMBEDDED_PAGE`.

- [✅] **Step 1: Write the failing test**

Open `sources/microservices/web-construct/lib/rbac/sidebar-adapter.test.ts` and apply this diff (add the import, add one item to the `items` array, add it to `authorized`, add a new `it` block at the end of the `mapNavigationToSidebar` describe block):

```ts
import { describe, it, expect } from 'vitest'
import { resolveAuthorizedItemIds, mapNavigationToSidebar } from './sidebar-adapter'
import { FUNCTYPE_EMBEDDED_PAGE } from './types'
import type { NavigationItemRow, RoleItemRow } from './types'
```

```ts
describe('mapNavigationToSidebar', () => {
  const items: NavigationItemRow[] = [
    cat(-1, null, 'operations'),
    cat(0, null, 'root'),
    cat(2, 0, 'RBAC', { item_translation: { EN: { name: 'RBAC' } } }),
    fn(3, 2, 'Users', 'user-management', { order_position: 0 }),
    fn(99, -1, 'USER_READ', '', { id_functionality_type: 5 }),
    cat(100, 99, 'deep ops child'),
    fn(50, 2, 'Hidden', 'hidden', { config_visibility: 1 }),
    fn(200, 2, 'Embed', 'https://example.com', { id_functionality_type: FUNCTYPE_EMBEDDED_PAGE }),
  ]
  const authorized = new Set([2, 3, 99, 100, 50, 200])
  const result = mapNavigationToSidebar(items, authorized)

  // ... existing it() blocks stay unchanged ...

  it('routes an EMBEDDED_PAGE item to the internal /embedded/{id} route', () => {
    const embed = result.find(i => i.id === '200')!
    expect(embed.route).toBe('/embedded/200')
  })
})
```

- [✅] **Step 2: Run test to verify it fails**

Run: `cd sources/microservices/web-construct && npm run test -- sidebar-adapter`
Expected: FAIL — the new test expects `route` to be `/embedded/200` but today's code returns `https://example.com` (via `normalizeRoute`).

- [✅] **Step 3: Add the constant**

In `sources/microservices/web-construct/lib/rbac/types.ts`, change:

```ts
export const ITEM_TYPE_CATEGORY = 1
export const ITEM_TYPE_FUNCTIONALITY = 2
export const FUNCTYPE_PERMISSION = 5
```

to:

```ts
export const ITEM_TYPE_CATEGORY = 1
export const ITEM_TYPE_FUNCTIONALITY = 2
export const FUNCTYPE_EMBEDDED_PAGE = 1
export const FUNCTYPE_PERMISSION = 5
```

- [✅] **Step 4: Update the routing logic**

In `sources/microservices/web-construct/lib/rbac/sidebar-adapter.ts`, change the import:

```ts
import type { MenuItem, MenuPosition } from '@/types/menu'
import {
  type NavigationItemRow, type RoleItemRow, type Locale,
  DEFAULT_LOCALE, ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY, FUNCTYPE_PERMISSION,
} from './types'
```

to:

```ts
import type { MenuItem, MenuPosition } from '@/types/menu'
import {
  type NavigationItemRow, type RoleItemRow, type Locale,
  DEFAULT_LOCALE, ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY, FUNCTYPE_PERMISSION, FUNCTYPE_EMBEDDED_PAGE,
} from './types'
```

Then change the `route:` line inside `mapNavigationToSidebar()`:

```ts
      route: isCategory ? undefined : normalizeRoute(it.functionality_link),
```

to:

```ts
      route: isCategory
        ? undefined
        : it.id_functionality_type === FUNCTYPE_EMBEDDED_PAGE
          ? `/embedded/${it.id_item}`
          : normalizeRoute(it.functionality_link),
```

- [✅] **Step 5: Run test to verify it passes**

Run: `cd sources/microservices/web-construct && npm run test -- sidebar-adapter`
Expected: PASS (all tests in the file, including the new one).

- [✅] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/types.ts sources/microservices/web-construct/lib/rbac/sidebar-adapter.ts sources/microservices/web-construct/lib/rbac/sidebar-adapter.test.ts
git commit -m "feat(rbac): route EMBEDDED_PAGE items to internal /embedded page"
```

---

### Task 2: `checkEmbeddable` — server-side embeddability check

**Files:**
- Create: `sources/microservices/web-construct/lib/rbac/embedded-check.ts`
- Test: `sources/microservices/web-construct/lib/rbac/embedded-check.test.ts`

**Interfaces:**
- Produces: `checkEmbeddable(url: string): Promise<boolean>` — resolves `true` if the URL can be embedded in an iframe from this app's origin, `false` otherwise (including on any error/timeout/malformed URL). Consumed by Task 3's route page.

- [✅] **Step 1: Write the failing tests**

Create `sources/microservices/web-construct/lib/rbac/embedded-check.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkEmbeddable } from './embedded-check'

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockFetchOnce(response: Response) {
  const fn = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('checkEmbeddable', () => {
  it('returns true when no blocking headers are present', async () => {
    mockFetchOnce(new Response(null, { status: 200 }))
    expect(await checkEmbeddable('https://example.com')).toBe(true)
  })

  it('returns false when X-Frame-Options is DENY', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'X-Frame-Options': 'DENY' } }))
    expect(await checkEmbeddable('https://example.com')).toBe(false)
  })

  it('returns false when X-Frame-Options is SAMEORIGIN', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'X-Frame-Options': 'SAMEORIGIN' } }))
    expect(await checkEmbeddable('https://example.com')).toBe(false)
  })

  it('returns false when CSP frame-ancestors is \'none\'', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'Content-Security-Policy': "frame-ancestors 'none'" } }))
    expect(await checkEmbeddable('https://example.com')).toBe(false)
  })

  it('returns true when CSP frame-ancestors allows *', async () => {
    mockFetchOnce(new Response(null, { status: 200, headers: { 'Content-Security-Policy': 'frame-ancestors *' } }))
    expect(await checkEmbeddable('https://example.com')).toBe(true)
  })

  it('falls back to GET when HEAD returns 405', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fn)
    expect(await checkEmbeddable('https://example.com')).toBe(true)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn.mock.calls[0][1]?.method).toBe('HEAD')
    expect(fn.mock.calls[1][1]?.method).toBe('GET')
  })

  it('returns false when fetch throws (network error / timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    expect(await checkEmbeddable('https://example.com')).toBe(false)
  })

  it('returns false for a non-http(s) URL without calling fetch', async () => {
    const fn = mockFetchOnce(new Response(null, { status: 200 }))
    expect(await checkEmbeddable('javascript:alert(1)')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })
})
```

- [✅] **Step 2: Run tests to verify they fail**

Run: `cd sources/microservices/web-construct && npm run test -- embedded-check`
Expected: FAIL with "Cannot find module './embedded-check'" (the file doesn't exist yet).

- [✅] **Step 3: Implement `checkEmbeddable`**

Create `sources/microservices/web-construct/lib/rbac/embedded-check.ts`:

```ts
const FETCH_TIMEOUT_MS = 4000

function blocksEmbedding(headers: Headers): boolean {
  const xfo = headers.get('x-frame-options')?.trim().toUpperCase()
  if (xfo === 'DENY' || xfo === 'SAMEORIGIN') return true

  const csp = headers.get('content-security-policy')
  if (csp) {
    const directive = csp
      .split(';')
      .map(d => d.trim())
      .find(d => d.toLowerCase().startsWith('frame-ancestors'))
    if (directive) {
      const sources = directive.split(/\s+/).slice(1)
      const allowsAny = sources.some(s => s === '*')
      if (!allowsAny) return true
    }
  }
  return false
}

async function fetchWithTimeout(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { method, signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
  }
}

export async function checkEmbeddable(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false
  try {
    let res = await fetchWithTimeout(url, 'HEAD')
    if (res.status === 405 || res.status === 501) {
      res = await fetchWithTimeout(url, 'GET')
    }
    return !blocksEmbedding(res.headers)
  } catch {
    return false
  }
}
```

- [✅] **Step 4: Run tests to verify they pass**

Run: `cd sources/microservices/web-construct && npm run test -- embedded-check`
Expected: PASS (all 8 tests).

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/embedded-check.ts sources/microservices/web-construct/lib/rbac/embedded-check.test.ts
git commit -m "feat(rbac): add server-side iframe-embeddability check"
```

---

### Task 3: `/embedded/[itemId]` route — data layer, components, page

**Files:**
- Modify: `sources/microservices/web-construct/lib/rbac/navigation-service.ts`
- Create: `sources/microservices/web-construct/components/EmbeddedFrame.tsx`
- Create: `sources/microservices/web-construct/components/EmbeddedBlockedNotice.tsx`
- Create: `sources/microservices/web-construct/app/(protected)/embedded/[itemId]/page.tsx`

**Interfaces:**
- Consumes: `resolveAuthorizedItemIds` (`lib/rbac/sidebar-adapter.ts`, from Task 1's unchanged signature), `toNavigationItemRow` (`lib/rbac/nav-row-mapper.ts`), `FUNCTYPE_EMBEDDED_PAGE` (Task 1), `checkEmbeddable` (Task 2), `auth` (`lib/auth.ts`).
- Produces: `getNavigationItemById(idItem: number): Promise<NavigationItemRow | null>` and `isItemAuthorizedForRoles(item: NavigationItemRow, roleIds: number[]): Promise<boolean>`, both exported from `lib/rbac/navigation-service.ts`.
- Produces: `EmbeddedFrame({ url: string })` and `EmbeddedBlockedNotice({ url: string })` React components.

- [✅] **Step 1: Add data-layer helpers to `navigation-service.ts`**

Modify `sources/microservices/web-construct/lib/rbac/navigation-service.ts`. Change the imports at the top:

```ts
import { cache } from 'react'
import { asc, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { navigationItem, roleItem } from '@/lib/db/schema'
import { toNavigationItemRow } from './nav-row-mapper'
import { resolveAuthorizedItemIds, mapNavigationToSidebar } from './sidebar-adapter'
import type { RoleItemRow } from './types'
import type { MenuItem } from '@/types/menu'
```

to:

```ts
import { cache } from 'react'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { navigationItem, roleItem } from '@/lib/db/schema'
import { toNavigationItemRow } from './nav-row-mapper'
import { resolveAuthorizedItemIds, mapNavigationToSidebar } from './sidebar-adapter'
import type { NavigationItemRow, RoleItemRow } from './types'
import type { MenuItem } from '@/types/menu'
```

Then append these two functions at the end of the file:

```ts
export async function getNavigationItemById(idItem: number): Promise<NavigationItemRow | null> {
  const [row] = await db.select().from(navigationItem).where(eq(navigationItem.idItem, idItem)).limit(1)
  return row ? toNavigationItemRow(row) : null
}

export async function isItemAuthorizedForRoles(item: NavigationItemRow, roleIds: number[]): Promise<boolean> {
  const roleRows = roleIds.length
    ? await db
        .select({ id_role: roleItem.idRole, id_item: roleItem.idItem, authorized: roleItem.authorized })
        .from(roleItem)
        .where(inArray(roleItem.idRole, roleIds))
    : []
  const authorized = resolveAuthorizedItemIds([item], roleRows as RoleItemRow[], roleIds)
  return authorized.has(item.id_item)
}
```

No new unit test here: this file has no existing unit test (`getSidebarMenu` above it is DB-wiring code exercised only through the app itself), consistent with the codebase's existing convention of unit-testing the pure logic (`resolveAuthorizedItemIds`, already covered in `sidebar-adapter.test.ts`) and covering DB-wiring through e2e (Task 4).

- [✅] **Step 2: Create `EmbeddedFrame`**

Create `sources/microservices/web-construct/components/EmbeddedFrame.tsx`:

```tsx
'use client'

import { useState } from 'react'

export function EmbeddedFrame({ url }: { url: string }) {
  const [loading, setLoading] = useState(true)

  return (
    <div className="relative h-full w-full min-h-[600px]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[var(--theme-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <iframe
        src={url}
        title="Embedded content"
        data-testid="embedded-iframe"
        onLoad={() => setLoading(false)}
        className="h-full w-full min-h-[600px] border-0"
      />
    </div>
  )
}
```

- [✅] **Step 3: Create `EmbeddedBlockedNotice`**

Create `sources/microservices/web-construct/components/EmbeddedBlockedNotice.tsx`:

```tsx
export function EmbeddedBlockedNotice({ url }: { url: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
      <p className="text-sm text-foreground-muted">
        ⚠️ Questo sito non può essere visualizzato incorporato.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="embedded-blocked-open-new-tab"
        className="px-4 py-2 text-sm rounded-md bg-[var(--theme-primary)] text-white hover:opacity-90 transition-opacity"
      >
        Apri in una nuova scheda →
      </a>
    </div>
  )
}
```

- [✅] **Step 4: Create the route page**

Create `sources/microservices/web-construct/app/(protected)/embedded/[itemId]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getNavigationItemById, isItemAuthorizedForRoles } from '@/lib/rbac/navigation-service'
import { FUNCTYPE_EMBEDDED_PAGE } from '@/lib/rbac/types'
import { checkEmbeddable } from '@/lib/rbac/embedded-check'
import { EmbeddedFrame } from '@/components/EmbeddedFrame'
import { EmbeddedBlockedNotice } from '@/components/EmbeddedBlockedNotice'

export default async function EmbeddedItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params
  const idItem = Number(itemId)
  if (!Number.isInteger(idItem)) notFound()

  const item = await getNavigationItemById(idItem)
  if (!item || item.id_functionality_type !== FUNCTYPE_EMBEDDED_PAGE || !item.functionality_link) notFound()

  const session = await auth()
  const roleIds = (session?.user as { roleIds?: number[] })?.roleIds ?? []
  const authorized = await isItemAuthorizedForRoles(item, roleIds)
  if (!authorized) redirect('/')

  const embeddable = await checkEmbeddable(item.functionality_link)
  return embeddable
    ? <EmbeddedFrame url={item.functionality_link} />
    : <EmbeddedBlockedNotice url={item.functionality_link} />
}
```

- [✅] **Step 5: Manual verification in the browser**

Run: `cd sources/microservices/web-construct && npm run dev`

1. Log in as an admin user. Go to `/functionalities/create`, create an item with tipologia "Link esterno embedded (iframe)" and link `https://example.com`, save.
2. Go to `/roles-permissions`, open the "Administrator" role (or whichever role your logged-in user has), find the new item in the "Sezioni" tree, toggle it on, click "Salva".
3. Reload `/`. The new item should appear as a top-level sidebar link. Click it.
4. Expected: URL becomes `/embedded/<id>`, the sidebar stays visible, and an iframe loads `https://example.com` in the main content area (a brief spinner may show first).
5. Edit the same item's link to `https://www.google.com` (a site that blocks framing) via `/functionalities`, save, click it again in the sidebar.
6. Expected: instead of an iframe, the fallback message "⚠️ Questo sito non può essere visualizzato incorporato." appears with an "Apri in una nuova scheda →" button that opens Google in a new tab.
7. Clean up: delete the test item from `/functionalities`.

- [✅] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/navigation-service.ts sources/microservices/web-construct/components/EmbeddedFrame.tsx sources/microservices/web-construct/components/EmbeddedBlockedNotice.tsx "sources/microservices/web-construct/app/(protected)/embedded"
git commit -m "feat(rbac): render EMBEDDED_PAGE items in an iframe on /embedded/[itemId]"
```

---

### Task 4: E2E tests

**Revised during execution:** Task 3's manual verification discovered that the test admin account's default roles (`Registered user` id 0, `Administrator` id 1) are seeded as `SYSTEM`-type roles (`role_type.description === 'SYSTEM'`), whose Sezioni permissions are **not editable via the UI** — `/roles-permissions/[roleId]`'s "Salva" button is disabled for them (confirmed by the existing test `test_system_role_not_editable` in `sources/tests/e2e/test_roles.py:119-127`). So granting a permission to "Administrator" (as the original version of this task assumed) is not possible through the app. Additionally, NextAuth bakes `roleIds` (which roles a session has) into the JWT at sign-in and never refreshes it — but permissions *within* a role the session already has (`role_item.authorized`) ARE read fresh from the DB on every request (`getSidebarMenu`/`isItemAuthorizedForRoles` both query live). So: granting a new permission to a role the test session already holds takes effect immediately with no re-login; granting a *new role* to the account requires a fresh login to take effect.

The corrected approach: create a throwaway custom role (via "Nuovo ruolo", a `SERVICE`-type role — editable, same pattern already used by `test_roles.py`'s `_create_role`/`test_toggle_permission_persists`), grant the new item's permission on that role, assign the role to the test admin account, then verify using a **freshly logged-in browser context** (not the shared `logged_in_page` session) so its JWT picks up the newly assigned role. Clean up by removing the role assignment, deleting the item, and deleting the role afterward.

**Files:**
- Create: `sources/tests/e2e/test_embedded.py`

**Interfaces:**
- Consumes: `nav`, `l1_btn`, `ensure_l1_expanded`, `grid_rows`, `open_column_filter`, `do_test_login` (`sources/tests/e2e/helpers.py`), the `logged_in_page`/`base_url`/`browser`/`test_email` fixtures (`sources/tests/e2e/conftest.py`).

- [✅] **Step 1: Write the e2e test file**

Create `sources/tests/e2e/test_embedded.py`:

```python
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from playwright.sync_api import expect

from helpers import nav, l1_btn, ensure_l1_expanded, grid_rows, open_column_filter, do_test_login


class _ProbeHandler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self._respond()

    def do_GET(self):
        self._respond()

    def _respond(self):
        body = b"probe" if self.command == "GET" else b""
        self.send_response(200)
        if self.path == "/blocked":
            self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def log_message(self, format, *args):
        pass


@pytest.fixture(scope="module")
def probe_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _ProbeHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    server.shutdown()
    thread.join()


def _select_tipologia(page, label: str):
    page.locator('[data-testid="select-tipologia"]').click()
    page.get_by_role("button", name=label, exact=True).first.click()


def _create_embedded_functionality(page, base_url, name, link):
    nav(page, f"{base_url}/functionalities/create")
    page.get_by_placeholder("Nome funzionalità *").fill(name)
    page.get_by_placeholder("Descrizione *").fill("e2e embed")
    _select_tipologia(page, "Link esterno embedded (iframe)")
    page.get_by_placeholder("Link *").fill(link)
    page.get_by_role("button", name="Salva").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")


def _delete_functionality(page, base_url, name):
    nav(page, f"{base_url}/functionalities")
    page.get_by_text(name, exact=True).first.scroll_into_view_if_needed()
    row = page.locator("div").filter(has_text=name).filter(has=page.locator('[data-testid="nav-delete"]')).last
    page.once("dialog", lambda d: d.accept())
    row.locator('[data-testid="nav-delete"]').click()
    page.wait_for_timeout(600)


def _tree_row(page, text):
    return page.locator("div").filter(has_text=text).filter(
        has=page.locator('[data-testid="drag-handle"]')
    ).last


def _create_role(page, base_url, name):
    """Create a SERVICE (editable) role via the UI. Returns its numeric id."""
    nav(page, f"{base_url}/roles-permissions")
    page.get_by_role("button", name="Nuovo ruolo").click()
    page.get_by_placeholder("Nome ruolo").fill(name)
    page.get_by_role("button", name="Salva").click()
    page.wait_for_url("**/roles-permissions/**", timeout=15_000)
    return int(page.url.rstrip("/").rsplit("/", 1)[-1])


def _search_role(page, base_url, name):
    nav(page, f"{base_url}/roles-permissions")
    open_column_filter(page, "description")
    page.locator('.ag-filter input[type="text"]').first.fill(name)
    page.get_by_role("button", name="Applica").click()
    page.wait_for_load_state("networkidle")


def _delete_role(page, base_url, name):
    _search_role(page, base_url, name)
    row = grid_rows(page).filter(has_text=name)
    expect(row).to_be_visible()
    row_menu = row.locator('[data-testid^="row-menu"]')
    row_menu.scroll_into_view_if_needed()
    row_menu.click()
    page.get_by_role("button", name="Elimina").click()
    page.get_by_role("button", name="Elimina").click()
    _search_role(page, base_url, name)
    expect(grid_rows(page).filter(has_text=name)).to_have_count(0)


def _grant_item_to_role(page, base_url, role_id, item_name):
    nav(page, f"{base_url}/roles-permissions/{role_id}")
    row = _tree_row(page, item_name)
    row.scroll_into_view_if_needed()
    row.locator('[data-testid="perm-toggle"]').click()
    save_btn = page.get_by_role("button", name="Salva")
    save_btn.click()
    expect(save_btn).to_be_disabled()
    expect(save_btn).to_be_enabled()


def _set_role_checkbox(page, base_url, test_email, role_id, checked):
    """Open 'Gestisci ruoli' for the row matching test_email and check/uncheck role_id."""
    nav(page, f"{base_url}/user-management")
    row = grid_rows(page).filter(has_text=test_email)
    row_menu = row.locator('[data-testid^="row-menu"]')
    row_menu.scroll_into_view_if_needed()
    row_menu.click()
    page.get_by_text("Gestisci ruoli", exact=True).first.click()
    checkbox = page.get_by_test_id(f"role-checkbox-{role_id}")
    if checked:
        checkbox.check()
    else:
        checkbox.uncheck()
    page.get_by_test_id("save-roles").click()
    expect(page.get_by_test_id("save-roles")).to_have_count(0)


@pytest.fixture
def embedded_item_page(logged_in_page, base_url, browser, test_email):
    """Factory fixture: given a target link, creates a throwaway role + EMBEDDED_PAGE
    item, grants the item to the role, assigns the role to the test admin account,
    then logs in a *fresh* browser context (role membership is baked into the
    session JWT at sign-in and never refreshed, so verifying authorization requires
    a login that happens after the grant). Returns (item_name, fresh_page).
    Cleans up the role assignment, item, and role, and closes the fresh context.
    """
    created = []

    def _make(link):
        page = logged_in_page
        ts = int(time.time())
        role_name = f"E2E Embed Role {ts}"
        item_name = f"E2E Embed {ts}"

        role_id = _create_role(page, base_url, role_name)
        _create_embedded_functionality(page, base_url, item_name, link)
        _grant_item_to_role(page, base_url, role_id, item_name)
        _set_role_checkbox(page, base_url, test_email, role_id, checked=True)

        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        fresh_page = ctx.new_page()
        do_test_login(fresh_page, base_url, test_email)

        created.append((role_name, role_id, item_name, ctx))
        return item_name, fresh_page

    yield _make

    for role_name, role_id, item_name, ctx in created:
        ctx.close()
        _set_role_checkbox(logged_in_page, base_url, test_email, role_id, checked=False)
        _delete_functionality(logged_in_page, base_url, item_name)
        _delete_role(logged_in_page, base_url, role_name)


def test_embedded_page_renders_iframe_when_allowed(embedded_item_page, probe_server):
    item_name, page = embedded_item_page(f"{probe_server}/ok")
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, item_name).click()
    page.wait_for_url("**/embedded/**", timeout=10_000)
    expect(page.locator('[data-testid="embedded-iframe"]')).to_be_visible()


def test_embedded_page_shows_fallback_when_blocked(embedded_item_page, probe_server):
    url = f"{probe_server}/blocked"
    item_name, page = embedded_item_page(url)
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    l1_btn(l1, item_name).click()
    page.wait_for_url("**/embedded/**", timeout=10_000)
    notice = page.locator('[data-testid="embedded-blocked-open-new-tab"]')
    expect(notice).to_be_visible()
    assert notice.get_attribute("href") == url
```

- [✅] **Step 2: Run the e2e tests**

Make sure the dev server is running (`npm run dev` in `sources/microservices/web-construct`, in a separate terminal) and `sources/tests/e2e/.env.test` has `TEST_EMAIL` set to an admin account that can create roles/functionalities and manage other users' roles (the shared `logged_in_page`/`admin_storage_state` account already used by the rest of the e2e suite). Then run:

```bash
uv run pytest sources/tests/e2e/test_embedded.py -v
```

Expected: both tests PASS. If a test fails on the `embedded-iframe`/fallback visibility check, first check whether the fresh login in `embedded_item_page` actually picked up the new role — `fresh_page` navigating to `/` should show the new item as a sidebar link (`l1_btn` will time out/fail to find it otherwise) before ever reaching `/embedded/...`. If the probe server calls themselves seem to hang, check `preview_logs`/server console for the dev server — the probe server binds to `127.0.0.1` on a random free port and must be reachable from the Next.js process making the server-side `checkEmbeddable` fetch.

- [✅] **Step 3: Commit**

```bash
git add sources/tests/e2e/test_embedded.py
git commit -m "test(e2e): cover /embedded/[itemId] iframe and fallback rendering"
```
