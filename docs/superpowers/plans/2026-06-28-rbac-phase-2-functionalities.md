# RBAC Phase 2 — Functionalities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [✅]`) syntax for tracking.

**Goal:** Build the Functionalities admin area (`/functionalities`) — a tabbed navigation_item tree with @dnd-kit drag reorder/re-parent, node create/edit/delete, and a two-column create/edit form with SVG upload, 5 functionality types, and 9-language translations + tags.

**Architecture:** Server Components fetch via `createAdminClient()`; mutations are server actions calling `requireAdmin()`. Security/safety-critical logic (SVG sanitization, immutable-delete guard, cycle guard, tree building) lives in pure, unit-tested functions. The Phase-1 `NavigationTree` primitive is extended with optional drag support.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Supabase (service_role) · Tailwind v4 · @dnd-kit · isomorphic-dompurify · Vitest (unit) · Playwright + pytest (E2E).

## Global Constraints

- All DB access server-side via `createAdminClient()`; RLS stays enabled; every server action calls `requireAdmin()` from `@/lib/rbac/auth-guard`.
- **CARRY-3 (security):** `createNavigationItem`/`updateNavigationItem` MUST `sanitizeSvg(iconPath)` before persisting. Sanitizer strips `<script>`, `<foreignObject>`, and `on*` handlers; allows SVG markup; passes through non-SVG (lucide names) and empty unchanged.
- **CARRY-4 (safety):** delete blocked if target OR any descendant `is_immutable=1`; edit and move rejected for `is_immutable=1`; virtual roots `0` and `-1` never deletable/movable.
- Functionalities tree HIDES `config_visibility=1` items. Two tabs: Tutto (root, id 0) / Operazioni (operations, id -1). Batch Patch omitted.
- New items default: `is_immutable=0, config_visibility=0, no_permission_need_for_navigation=0, navbar_position=null`. The form edits only the mockup fields.
- Tags: replace-all on save (delete + re-insert `navigation_item_tag`).
- Locales (exact order): `EN, IT, DE, FR, ES, NL, PT, SK, RO`; `DEFAULT_LOCALE='EN'`. Functionality types: 1 EMBEDDED_PAGE, 2 EXTERNAL_LINK, 3 INTERNAL_FUNCTIONALITY, 4 REMOTE_DESKTOP, 5 PERMISSION. `ITEM_TYPE_CATEGORY=1`, `ITEM_TYPE_FUNCTIONALITY=2`.
- `UserNavigationTreeDto.authorization` stays REQUIRED; `buildNavTree` sets it `false` (irrelevant for this tree).
- Run `npx tsc --noEmit`, `npm run lint`, `npm run build` clean before the final commit of any `.ts/.tsx` task; pure-logic tasks also run `npm test`.
- Work from `sources/microservices/web-construct/`. Repo root: `/Users/mario.stefanutti/mario/programming/github-frontiere/construct`.

---

## File Structure

**Created:** `lib/rbac/svg-sanitize.ts`(+test), `lib/rbac/nav-tree-builder.ts`(+test), `lib/rbac/functionalities-service.ts`, `lib/rbac/navigation-actions.ts`, `components/rbac/functionalities/{FunctionalitiesTreeClient,FunctionalityForm,IconUpload,TagInput,TranslationsAccordion}.tsx`, `app/(protected)/functionalities/{page,create/page,[funcId]/edit/page}.tsx`, `sources/tests/e2e/test_functionalities.py`.
**Modified:** `lib/rbac/types.ts`, `components/rbac/NavigationTree.tsx`, `package.json`.

---

## Task 1: Types & DTO extension

**Files:** Modify `lib/rbac/types.ts`
**Interfaces:** Produces `FunctionalityType`, extended `UserNavigationTreeDto`, `CreateNavItemInput`, `UpdateNavItemInput`, `MoveInput`.

- [✅] **Step 1: Edit `UserNavigationTreeDto` and append new types**

Replace the existing `UserNavigationTreeDto` interface with this extended version (keeps `authorization` required; adds optional fields):
```ts
export interface UserNavigationTreeDto {
  id: number
  name: string
  type: 'CATEGORY' | 'FUNCTIONALITY'
  parentId: number | null
  authorization: boolean
  children: UserNavigationTreeDto[]
  // Phase 2 (optional — Phase 1 consumers don't set these):
  description?: string | null
  functionalityType?: FunctionalityType | null
  link?: string | null
  icon?: string | null
  navbarPosition?: 'TOP' | 'BOTTOM' | null
  isImmutable?: boolean
  translations?: Record<string, { name?: string; description?: string }>
  tagTranslations?: Record<string, string[]>
}
```
Then append:
```ts
export type FunctionalityType =
  | 'EMBEDDED_PAGE' | 'EXTERNAL_LINK' | 'INTERNAL_FUNCTIONALITY' | 'REMOTE_DESKTOP' | 'PERMISSION'

export interface CreateNavItemInput {
  name: string
  idItemType: 1 | 2
  idFunctionalityType: number | null
  functionalityLink: string | null
  iconPath: string | null
  idItemParent: number | null
  description: string
  itemTranslation: Record<string, { name?: string; description?: string }>
  tagTranslations: Record<string, string[]>
}
export type UpdateNavItemInput = CreateNavItemInput
export interface MoveInput { targetParentId: number; orderPosition: number }
```
(`FunctionalityType` is referenced by the interface above; declaring it after is fine — TS hoists type declarations.)

- [✅] **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → 0 errors (Phase-1 consumers still compile since added fields are optional).
```bash
git add sources/microservices/web-construct/lib/rbac/types.ts
git commit -m "feat(rbac): extend UserNavigationTreeDto + nav item input types"
```

---

## Task 2: SVG sanitizer (CARRY-3)

**Files:** Create `lib/rbac/svg-sanitize.ts`, `lib/rbac/svg-sanitize.test.ts`; Modify `package.json`
**Interfaces:** Consumes `isInlineSvg` from `@/lib/icon-utils`. Produces `sanitizeSvg(raw: string | null | undefined): string`.

- [✅] **Step 1: Install isomorphic-dompurify**

In `package.json` add to `dependencies`: `"isomorphic-dompurify": "^2.16.0"`. Then run (from web-construct): `npm install`
Expected: resolves. (If peer-deps conflict, use `npm install --legacy-peer-deps` — the project already uses that.)

- [✅] **Step 2: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeSvg } from './svg-sanitize'

describe('sanitizeSvg', () => {
  it('strips <script> from svg', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><path d="M0 0"/></svg>')
    expect(out).not.toContain('<script')
    expect(out).toContain('<path')
  })
  it('strips onload and other event handlers', () => {
    const out = sanitizeSvg('<svg onload="alert(1)" viewBox="0 0 24 24"></svg>')
    expect(out.toLowerCase()).not.toContain('onload')
  })
  it('strips foreignObject', () => {
    const out = sanitizeSvg('<svg><foreignObject><body>x</body></foreignObject></svg>')
    expect(out.toLowerCase()).not.toContain('foreignobject')
  })
  it('preserves clean svg markup', () => {
    const out = sanitizeSvg('<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>')
    expect(out).toContain('<svg')
    expect(out).toContain('<path')
  })
  it('passes through non-svg (lucide name) unchanged', () => {
    expect(sanitizeSvg('House')).toBe('House')
  })
  it('passes through empty/null/undefined as empty string-safe', () => {
    expect(sanitizeSvg('')).toBe('')
    expect(sanitizeSvg(null)).toBe('')
    expect(sanitizeSvg(undefined)).toBe('')
  })
})
```

- [✅] **Step 3: Run, expect fail**

Run: `npm test -- svg-sanitize`
Expected: FAIL (module missing).

- [✅] **Step 4: Implement `lib/rbac/svg-sanitize.ts`**

```ts
import DOMPurify from 'isomorphic-dompurify'
import { isInlineSvg } from '@/lib/icon-utils'

export function sanitizeSvg(raw: string | null | undefined): string {
  if (!raw) return ''
  if (!isInlineSvg(raw)) return raw
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject'],
    FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover'],
  })
}
```

- [✅] **Step 5: Run, expect pass**

Run: `npm test -- svg-sanitize`
Expected: PASS (all 6 cases).

- [✅] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/package.json sources/microservices/web-construct/package-lock.json sources/microservices/web-construct/lib/rbac/svg-sanitize.ts sources/microservices/web-construct/lib/rbac/svg-sanitize.test.ts
git commit -m "feat(rbac): server-side SVG sanitizer (CARRY-3)"
```

---

## Task 3: Tree builder + guards (pure)

**Files:** Create `lib/rbac/nav-tree-builder.ts`, `lib/rbac/nav-tree-builder.test.ts`
**Interfaces:** Consumes `NavigationItemRow`, `UserNavigationTreeDto`, `FunctionalityType`, `Locale`, `DEFAULT_LOCALE`, `ITEM_TYPE_CATEGORY` from `./types`. Produces:
- `buildNavTree(items: NavigationItemRow[], tagsByItem: Map<number, { tag_lan: string; tag: string }[]>, rootId: number, locale?: Locale): UserNavigationTreeDto[]`
- `canDeleteSubtree(items: NavigationItemRow[], id: number): boolean`
- `isDescendant(items: NavigationItemRow[], candidateId: number, ancestorId: number): boolean`

> Note: `buildNavTree` needs `id_functionality_type` mapped to the `FunctionalityType` string. Add a private map. Also needs `item_translation` and `navbar_position` from the row — both already on `NavigationItemRow`.

- [✅] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildNavTree, canDeleteSubtree, isDescendant } from './nav-tree-builder'
import type { NavigationItemRow } from './types'

const row = (id: number, parent: number | null, type: number, name: string, extra: Partial<NavigationItemRow> = {}): NavigationItemRow => ({
  id_item: id, name, id_item_type: type, id_functionality_type: type === 2 ? 3 : null,
  functionality_link: type === 2 ? 'link-' + id : null, icon_path: null, id_item_parent: parent,
  order_position: id, navbar_position: null, item_translation: { EN: { name, description: 'd' + id } },
  is_immutable: 0, config_visibility: 0, no_permission_need_for_navigation: 0, ...extra,
})

// root(0) > A(2,cat,immutable) > A1(3,leaf); root(0) > B(4,cat) > B1(5,leaf); hidden(6,leaf,config_visibility=1)
const items: NavigationItemRow[] = [
  row(0, null, 1, 'root'), row(2, 0, 1, 'A', { is_immutable: 1 }), row(3, 2, 2, 'A1'),
  row(4, 0, 1, 'B'), row(5, 4, 2, 'B1'), row(6, 0, 2, 'hidden', { config_visibility: 1 }),
]
const tags = new Map<number, { tag_lan: string; tag: string }[]>([[5, [{ tag_lan: 'EN', tag: 'x' }, { tag_lan: 'EN', tag: 'y' }]]])

describe('buildNavTree', () => {
  const trees = buildNavTree(items, tags, 0)
  it('builds children of root, ordered, excluding config_visibility', () => {
    expect(trees.map(t => t.id)).toEqual([2, 4]) // 6 hidden
  })
  it('populates extended fields incl. functionalityType + tagTranslations', () => {
    const b1 = trees.find(t => t.id === 4)!.children.find(c => c.id === 5)!
    expect(b1.type).toBe('FUNCTIONALITY')
    expect(b1.functionalityType).toBe('INTERNAL_FUNCTIONALITY')
    expect(b1.link).toBe('link-5')
    expect(b1.tagTranslations).toEqual({ EN: ['x', 'y'] })
    expect(b1.isImmutable).toBe(false)
  })
  it('marks immutable nodes', () => {
    expect(trees.find(t => t.id === 2)!.isImmutable).toBe(true)
  })
})

describe('canDeleteSubtree', () => {
  it('blocks an immutable target', () => { expect(canDeleteSubtree(items, 2)).toBe(false) })
  it('blocks when a descendant is immutable', () => {
    // make A1 immutable, A mutable
    const mod = items.map(i => i.id_item === 2 ? { ...i, is_immutable: 0 } : i.id_item === 3 ? { ...i, is_immutable: 1 } : i)
    expect(canDeleteSubtree(mod, 2)).toBe(false)
  })
  it('allows a fully-deletable subtree', () => { expect(canDeleteSubtree(items, 4)).toBe(true) })
  it('blocks the virtual roots', () => {
    expect(canDeleteSubtree(items, 0)).toBe(false)
    expect(canDeleteSubtree(items, -1)).toBe(false)
  })
})

describe('isDescendant', () => {
  it('true when candidate is inside the ancestor subtree', () => { expect(isDescendant(items, 3, 2)).toBe(true) })
  it('false otherwise', () => { expect(isDescendant(items, 5, 2)).toBe(false) })
  it('treats the node itself as a descendant (cycle into self)', () => { expect(isDescendant(items, 2, 2)).toBe(true) })
})
```

- [✅] **Step 2: Run, expect fail**

Run: `npm test -- nav-tree-builder`
Expected: FAIL (module missing).

- [✅] **Step 3: Implement `lib/rbac/nav-tree-builder.ts`**

```ts
import {
  type NavigationItemRow, type UserNavigationTreeDto, type FunctionalityType, type Locale,
  DEFAULT_LOCALE, ITEM_TYPE_CATEGORY,
} from './types'

const FUNC_TYPE: Record<number, FunctionalityType> = {
  1: 'EMBEDDED_PAGE', 2: 'EXTERNAL_LINK', 3: 'INTERNAL_FUNCTIONALITY', 4: 'REMOTE_DESKTOP', 5: 'PERMISSION',
}

function labelFor(it: NavigationItemRow, locale: Locale): string {
  return it.item_translation?.[locale]?.name ?? it.item_translation?.[DEFAULT_LOCALE]?.name ?? it.name ?? ''
}

export function buildNavTree(
  items: NavigationItemRow[],
  tagsByItem: Map<number, { tag_lan: string; tag: string }[]>,
  rootId: number,
  locale: Locale = DEFAULT_LOCALE,
): UserNavigationTreeDto[] {
  const childrenByParent = new Map<number | null, NavigationItemRow[]>()
  for (const it of items) {
    if (it.config_visibility === 1) continue
    const arr = childrenByParent.get(it.id_item_parent) ?? []
    arr.push(it)
    childrenByParent.set(it.id_item_parent, arr)
  }
  const tagsFor = (id: number): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const t of tagsByItem.get(id) ?? []) (out[t.tag_lan] ??= []).push(t.tag)
    return out
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
        authorization: false,
        description: it.item_translation?.[locale]?.description ?? it.description ?? null,
        functionalityType: it.id_functionality_type ? FUNC_TYPE[it.id_functionality_type] ?? null : null,
        link: it.functionality_link,
        icon: it.icon_path,
        navbarPosition: it.navbar_position,
        isImmutable: it.is_immutable === 1,
        translations: it.item_translation ?? {},
        tagTranslations: tagsFor(it.id_item),
        children: build(it.id_item),
      }))
  return build(rootId)
}

function descendantIds(items: NavigationItemRow[], id: number): Set<number> {
  const childrenByParent = new Map<number | null, number[]>()
  for (const it of items) {
    const arr = childrenByParent.get(it.id_item_parent) ?? []
    arr.push(it.id_item)
    childrenByParent.set(it.id_item_parent, arr)
  }
  const out = new Set<number>([id])
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const c of childrenByParent.get(cur) ?? []) {
      if (!out.has(c)) { out.add(c); stack.push(c) }
    }
  }
  return out
}

export function canDeleteSubtree(items: NavigationItemRow[], id: number): boolean {
  if (id === 0 || id === -1) return false
  const subtree = descendantIds(items, id)
  for (const it of items) {
    if (subtree.has(it.id_item) && it.is_immutable === 1) return false
  }
  return true
}

export function isDescendant(items: NavigationItemRow[], candidateId: number, ancestorId: number): boolean {
  return descendantIds(items, ancestorId).has(candidateId)
}
```

- [✅] **Step 4: Run, expect pass**

Run: `npm test -- nav-tree-builder`
Expected: PASS (all cases).

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/nav-tree-builder.ts sources/microservices/web-construct/lib/rbac/nav-tree-builder.test.ts
git commit -m "feat(rbac): pure nav tree builder + immutable/cycle guards"
```

---

## Task 4: Functionalities read service

**Files:** Create `lib/rbac/functionalities-service.ts`
**Interfaces:** Consumes `createAdminClient`; `buildNavTree` from `./nav-tree-builder`; types. Produces:
- `getNavigationSubtree(root: 'root' | 'operations'): Promise<UserNavigationTreeDto[]>`
- `getNavigationItem(id: number): Promise<UserNavigationTreeDto>`
- `getParentList(): Promise<{ id: number; name: string }[]>`

- [✅] **Step 1: Implement `lib/rbac/functionalities-service.ts`**

```ts
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase-server'
import { buildNavTree } from './nav-tree-builder'
import {
  type UserNavigationTreeDto, type NavigationItemRow, type FunctionalityType,
  DEFAULT_LOCALE, ROOT_ID, OPERATIONS_ID, ITEM_TYPE_CATEGORY,
} from './types'

const NAV_COLUMNS =
  'id_item,name,id_item_type,id_functionality_type,functionality_link,icon_path,id_item_parent,order_position,navbar_position,item_translation,is_immutable,config_visibility,no_permission_need_for_navigation'

const FUNC_TYPE: Record<number, FunctionalityType> = {
  1: 'EMBEDDED_PAGE', 2: 'EXTERNAL_LINK', 3: 'INTERNAL_FUNCTIONALITY', 4: 'REMOTE_DESKTOP', 5: 'PERMISSION',
}

async function loadNavAndTags() {
  const supabase = createAdminClient()
  const [{ data: nav, error: navErr }, { data: tags, error: tagErr }] = await Promise.all([
    supabase.from('navigation_item').select(NAV_COLUMNS).order('order_position'),
    supabase.from('navigation_item_tag').select('id_item,tag_lan,tag'),
  ])
  if (navErr) throw new Error(`Failed to load navigation: ${navErr.message}`)
  if (tagErr) throw new Error(`Failed to load tags: ${tagErr.message}`)
  const tagsByItem = new Map<number, { tag_lan: string; tag: string }[]>()
  for (const t of (tags ?? []) as { id_item: number; tag_lan: string; tag: string }[]) {
    const arr = tagsByItem.get(t.id_item) ?? []
    arr.push({ tag_lan: t.tag_lan, tag: t.tag })
    tagsByItem.set(t.id_item, arr)
  }
  return { items: (nav ?? []) as NavigationItemRow[], tagsByItem }
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
  return {
    id: it.id_item,
    name: it.item_translation?.[DEFAULT_LOCALE]?.name ?? it.name ?? '',
    type: it.id_item_type === ITEM_TYPE_CATEGORY ? 'CATEGORY' : 'FUNCTIONALITY',
    parentId: it.id_item_parent,
    authorization: false,
    description: it.item_translation?.[DEFAULT_LOCALE]?.description ?? it.description ?? null,
    functionalityType: it.id_functionality_type ? FUNC_TYPE[it.id_functionality_type] ?? null : null,
    link: it.functionality_link,
    icon: it.icon_path,
    navbarPosition: it.navbar_position,
    isImmutable: it.is_immutable === 1,
    translations: it.item_translation ?? {},
    tagTranslations,
    children: [],
  }
})

export const getParentList = cache(async (): Promise<{ id: number; name: string }[]> => {
  const { items } = await loadNavAndTags()
  return items
    .filter(i => i.id_item_type === ITEM_TYPE_CATEGORY && i.id_item !== ROOT_ID && i.id_item !== OPERATIONS_ID)
    .map(i => ({ id: i.id_item, name: i.item_translation?.[DEFAULT_LOCALE]?.name ?? i.name ?? '' }))
})
```

- [✅] **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → 0 errors.
```bash
git add sources/microservices/web-construct/lib/rbac/functionalities-service.ts
git commit -m "feat(rbac): functionalities read service"
```

---

## Task 5: Navigation mutation actions

**Files:** Create `lib/rbac/navigation-actions.ts`
**Interfaces:** Consumes `requireAdmin`, `createAdminClient`, `sanitizeSvg`, `canDeleteSubtree`/`isDescendant` from `./nav-tree-builder`, types. Produces server actions:
- `createNavigationItem(input: CreateNavItemInput): Promise<{ id: number }>`
- `updateNavigationItem(id: number, input: UpdateNavItemInput): Promise<void>`
- `moveNavigationItem(id: number, move: MoveInput): Promise<void>`
- `deleteNavigationItem(id: number): Promise<void>`

> `moveNavigationItem` treats `orderPosition` as the target index and RENUMBERS the destination parent's children (compacting to 0..n) so ordering is always clean.

- [✅] **Step 1: Implement `lib/rbac/navigation-actions.ts`**

```ts
'use server'

import { requireAdmin } from '@/lib/rbac/auth-guard'
import { createAdminClient } from '@/lib/supabase-server'
import { sanitizeSvg } from './svg-sanitize'
import { canDeleteSubtree, isDescendant } from './nav-tree-builder'
import type { CreateNavItemInput, UpdateNavItemInput, MoveInput, NavigationItemRow } from './types'

async function writeTags(
  supabase: ReturnType<typeof createAdminClient>,
  idItem: number,
  tagTranslations: Record<string, string[]>,
) {
  const rows: { id_item: number; tag_lan: string; tag: string }[] = []
  for (const [lan, tags] of Object.entries(tagTranslations)) {
    for (const tag of tags) if (tag.trim()) rows.push({ id_item: idItem, tag_lan: lan, tag: tag.trim() })
  }
  await supabase.from('navigation_item_tag').delete().eq('id_item', idItem)
  if (rows.length) {
    const { error } = await supabase.from('navigation_item_tag').insert(rows)
    if (error) throw new Error(`Failed to write tags: ${error.message}`)
  }
}

export async function createNavigationItem(input: CreateNavItemInput): Promise<{ id: number }> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  const supabase = createAdminClient()
  const parent = input.idItemParent
  // next order_position among siblings of the chosen parent
  const { data: siblings } = await supabase.from('navigation_item').select('order_position').eq('id_item_parent', parent ?? 0)
  const nextOrder = (siblings ?? []).reduce((m: number, r: { order_position: number }) => Math.max(m, r.order_position + 1), 0)
  const { data, error } = await supabase.from('navigation_item').insert({
    name: input.name.trim(),
    id_item_type: input.idItemType,
    id_functionality_type: input.idItemType === 2 ? input.idFunctionalityType : null,
    functionality_link: input.idItemType === 2 ? input.functionalityLink : null,
    icon_path: sanitizeSvg(input.iconPath),
    id_item_parent: parent ?? 0,
    order_position: nextOrder,
    description: input.description,
    item_translation: input.itemTranslation,
    is_immutable: 0, config_visibility: 0, no_permission_need_for_navigation: 0,
  }).select('id_item').single()
  if (error) throw new Error(`Failed to create item: ${error.message}`)
  await writeTags(supabase, Number(data.id_item), input.tagTranslations)
  return { id: Number(data.id_item) }
}

async function loadItems(supabase: ReturnType<typeof createAdminClient>): Promise<NavigationItemRow[]> {
  const { data, error } = await supabase.from('navigation_item')
    .select('id_item,name,id_item_type,id_functionality_type,functionality_link,icon_path,id_item_parent,order_position,navbar_position,item_translation,is_immutable,config_visibility,no_permission_need_for_navigation')
  if (error) throw new Error(`Failed to load items: ${error.message}`)
  return (data ?? []) as NavigationItemRow[]
}

async function assertMutable(supabase: ReturnType<typeof createAdminClient>, id: number) {
  const { data, error } = await supabase.from('navigation_item').select('is_immutable').eq('id_item', id).single()
  if (error) throw new Error(`Item not found: ${error.message}`)
  if ((data as { is_immutable: number }).is_immutable === 1) throw new Error('This item is immutable')
}

export async function updateNavigationItem(id: number, input: UpdateNavItemInput): Promise<void> {
  await requireAdmin()
  if (!input.name.trim()) throw new Error('Name is required')
  const supabase = createAdminClient()
  await assertMutable(supabase, id)
  const { error } = await supabase.from('navigation_item').update({
    name: input.name.trim(),
    id_item_type: input.idItemType,
    id_functionality_type: input.idItemType === 2 ? input.idFunctionalityType : null,
    functionality_link: input.idItemType === 2 ? input.functionalityLink : null,
    icon_path: sanitizeSvg(input.iconPath),
    description: input.description,
    item_translation: input.itemTranslation,
    date_mod: new Date().toISOString(),
  }).eq('id_item', id)
  if (error) throw new Error(`Failed to update item: ${error.message}`)
  await writeTags(supabase, id, input.tagTranslations)
}

export async function moveNavigationItem(id: number, move: MoveInput): Promise<void> {
  await requireAdmin()
  if (id === 0 || id === -1) throw new Error('Cannot move a root')
  const supabase = createAdminClient()
  await assertMutable(supabase, id)
  const items = await loadItems(supabase)
  if (isDescendant(items, move.targetParentId, id)) throw new Error('Cannot move an item into its own subtree')

  // Re-parent the moved item, then renumber the destination siblings with it inserted at orderPosition.
  const dest = items
    .filter(i => i.id_item_parent === move.targetParentId && i.id_item !== id)
    .sort((a, b) => a.order_position - b.order_position)
    .map(i => i.id_item)
  const idx = Math.max(0, Math.min(move.orderPosition, dest.length))
  dest.splice(idx, 0, id)
  for (let pos = 0; pos < dest.length; pos++) {
    const { error } = await supabase.from('navigation_item')
      .update({ id_item_parent: move.targetParentId, order_position: pos })
      .eq('id_item', dest[pos])
    if (error) throw new Error(`Failed to move item: ${error.message}`)
  }
}

export async function deleteNavigationItem(id: number): Promise<void> {
  await requireAdmin()
  const supabase = createAdminClient()
  const items = await loadItems(supabase)
  if (!canDeleteSubtree(items, id)) throw new Error('This item (or a descendant) is immutable and cannot be deleted')
  const { error } = await supabase.from('navigation_item').delete().eq('id_item', id)
  if (error) throw new Error(`Failed to delete item: ${error.message}`)
}
```

- [✅] **Step 2: Typecheck, lint & verify guards via DB**

Run: `npx tsc --noEmit && npm run lint` → 0 errors (pre-existing warnings OK).
Then via Supabase MCP (`select:mcp__supabase__execute_sql`) confirm there are immutable items to guard:
```sql
select count(*) filter (where is_immutable=1) as immutable, count(*) as total from navigation_item;
```
Expected: immutable ≥ 7. Paste into report. (Functional create/move/delete behavior is covered by E2E in Task 10.)

- [✅] **Step 3: Commit**

```bash
git add sources/microservices/web-construct/lib/rbac/navigation-actions.ts
git commit -m "feat(rbac): navigation item create/update/move/delete actions"
```

---

## Task 6: NavigationTree drag support (@dnd-kit)

**Files:** Modify `components/rbac/NavigationTree.tsx`; Modify `package.json`
**Interfaces:** Adds optional prop `dnd?: { canDrag: (node: UserNavigationTreeDto) => boolean; onMove: (id: number, targetParentId: number, orderPosition: number) => void }`. When absent, render exactly as Phase 1.

> This is the hardest UI task and the one NOT covered by E2E — you MUST browser-verify a drag reorders and a drop-onto-category re-parents (use the running dev server). Treat the code below as a complete starting implementation; adapt minimally if @dnd-kit behavior requires it, but keep the public props stable and the no-`dnd` path byte-for-byte behavior-compatible with Phase 1.

- [✅] **Step 1: Install @dnd-kit**

In `package.json` dependencies add `"@dnd-kit/core": "^6.3.1"` and `"@dnd-kit/sortable": "^10.0.0"` and `"@dnd-kit/utilities": "^3.2.2"`. Run `npm install` (use `--legacy-peer-deps` if needed).

- [✅] **Step 2: Replace `components/rbac/NavigationTree.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
  useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

interface DndConfig {
  canDrag: (node: UserNavigationTreeDto) => boolean
  onMove: (id: number, targetParentId: number, orderPosition: number) => void
}
interface NavigationTreeProps {
  nodes: UserNavigationTreeDto[]
  renderTrailing?: (node: UserNavigationTreeDto) => React.ReactNode
  expandedByDefault?: boolean
  dnd?: DndConfig
}

interface RowProps {
  node: UserNavigationTreeDto
  depth: number
  renderTrailing?: (node: UserNavigationTreeDto) => React.ReactNode
  expandedByDefault: boolean
  dnd?: DndConfig
}

const TreeRow: React.FC<RowProps> = ({ node, depth, renderTrailing, expandedByDefault, dnd }) => {
  const isCategory = node.type === 'CATEGORY'
  const hasChildren = node.children.length > 0
  const [open, setOpen] = useState(expandedByDefault)
  const canDrag = dnd ? dnd.canDrag(node) : false

  const drag = useDraggable({ id: `item-${node.id}`, disabled: !canDrag })
  // Drop "before this row" (same parent, at this row's index)
  const beforeDrop = useDroppable({ id: `before-${node.id}` })
  // Drop "into this category" (append as child)
  const intoDrop = useDroppable({ id: `into-${node.id}`, disabled: !isCategory })

  return (
    <div>
      <div
        ref={dnd ? beforeDrop.setNodeRef : undefined}
        className={`flex items-center gap-2 py-2.5 px-3 border-b border-gray-100 dark:border-gray-800 ${beforeDrop.isOver ? 'border-t-2 border-t-primary' : ''} ${intoDrop.isOver ? 'bg-primary/10' : ''}`}
        style={{ paddingLeft: 12 + depth * 24 }}
      >
        {dnd && (
          <button
            ref={drag.setActivatorNodeRef}
            {...drag.listeners}
            {...drag.attributes}
            data-testid="drag-handle"
            disabled={!canDrag}
            className={`p-0.5 text-gray-400 ${canDrag ? 'cursor-grab' : 'opacity-30 cursor-not-allowed'}`}
          >
            <GripVertical size={14} />
          </button>
        )}
        {isCategory && hasChildren ? (
          <button data-testid="tree-toggle" onClick={() => setOpen(o => !o)} className="p-0.5 text-gray-500">
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <span
          ref={dnd && isCategory ? intoDrop.setNodeRef : undefined}
          className={`flex-1 text-sm ${isCategory ? 'font-medium' : ''}`}
        >
          {node.name}
        </span>
        {renderTrailing?.(node)}
      </div>
      {hasChildren && open && node.children.map(c => (
        <TreeRow key={c.id} node={c} depth={depth + 1} renderTrailing={renderTrailing} expandedByDefault={expandedByDefault} dnd={dnd} />
      ))}
    </div>
  )
}

export default function NavigationTree({ nodes, renderTrailing, expandedByDefault = true, dnd }: NavigationTreeProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const index = React.useMemo(() => {
    const byId = new Map<number, UserNavigationTreeDto>()
    const walk = (ns: UserNavigationTreeDto[]) => ns.forEach(n => { byId.set(n.id, n); walk(n.children) })
    walk(nodes)
    return byId
  }, [nodes])

  const handleDragEnd = (e: DragEndEvent) => {
    if (!dnd || !e.over) return
    const activeId = Number(String(e.active.id).replace('item-', ''))
    const overId = String(e.over.id)
    if (overId.startsWith('into-')) {
      const parentId = Number(overId.replace('into-', ''))
      const parent = index.get(parentId)
      dnd.onMove(activeId, parentId, parent ? parent.children.length : 0)
    } else if (overId.startsWith('before-')) {
      const beforeId = Number(overId.replace('before-', ''))
      if (beforeId === activeId) return
      const before = index.get(beforeId)
      if (!before) return
      const targetParent = before.parentId ?? 0
      const siblings = (targetParent === 0
        ? nodes
        : index.get(targetParent)?.children ?? []).filter(n => n.id !== activeId)
      const idx = siblings.findIndex(n => n.id === beforeId)
      dnd.onMove(activeId, targetParent, idx < 0 ? siblings.length : idx)
    }
  }

  const tree = (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800">
      {nodes.map(n => (
        <TreeRow key={n.id} node={n} depth={0} renderTrailing={renderTrailing} expandedByDefault={expandedByDefault} dnd={dnd} />
      ))}
    </div>
  )

  if (!dnd) return tree
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {tree}
    </DndContext>
  )
}
```

- [✅] **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean. (Phase-1 `PermissionsTree` passes no `dnd` prop, so its behavior is unchanged.)

- [✅] **Step 4: Browser-verify the drag (REQUIRED — not covered by E2E)**

Start the dev server (`AUTH_TEST_CREDENTIALS=true npm run dev`), and once Task 9's tree page exists this is verified there. For THIS task, verify the no-`dnd` path: run the existing role-permission E2E to confirm PermissionsTree still works:
Run (repo root): `HEADLESS=true uv run pytest sources/tests/e2e/test_roles.py::test_toggle_permission_persists -v`
Expected: PASS (NavigationTree change didn't break the Phase-1 consumer).

> The actual drag interaction is browser-verified by the controller after Task 9 wires the tree page with `dnd`. If you (implementer) can run the dev server + the webapp-testing skill now against a temporary mount, do so and report; otherwise note that drag verification is deferred to the Task 9 browser check.

- [✅] **Step 5: Commit**

```bash
git add sources/microservices/web-construct/package.json sources/microservices/web-construct/package-lock.json sources/microservices/web-construct/components/rbac/NavigationTree.tsx
git commit -m "feat(rbac): optional @dnd-kit drag support in NavigationTree"
```

---

## Task 7: Form sub-components (IconUpload, TagInput, TranslationsAccordion)

**Files:** Create `components/rbac/functionalities/IconUpload.tsx`, `TagInput.tsx`, `TranslationsAccordion.tsx`
**Interfaces:**
- `IconUpload`: props `{ value: string; onChange: (svg: string) => void }` — SVG file picker + drag&drop, reads file→text, inline preview.
- `TagInput`: props `{ value: string[]; onChange: (tags: string[]) => void; placeholder?: string }`.
- `TranslationsAccordion`: props `{ translations: Record<string,{name?:string;description?:string}>; tags: Record<string,string[]>; onTranslations: (t) => void; onTags: (t) => void }`.

- [✅] **Step 1: `TagInput.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { X } from 'lucide-react'

export default function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (tags: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const t = draft.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setDraft('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700">
      {value.map(t => (
        <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs">
          {t}
          <button type="button" onClick={() => onChange(value.filter(x => x !== t))}><X size={12} /></button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        onBlur={add}
        placeholder={placeholder ?? 'Inserisci un tag e premi invio'}
        className="flex-1 min-w-24 bg-transparent text-sm outline-none py-0.5"
      />
    </div>
  )
}
```

- [✅] **Step 2: `IconUpload.tsx`**

```tsx
'use client'

import React, { useRef, useState } from 'react'
import { IconRenderer } from '@/components/IconRenderer'

export default function IconUpload({ value, onChange }: { value: string; onChange: (svg: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState('')

  const readFile = (file: File | undefined) => {
    setErr('')
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.svg') && file.type !== 'image/svg+xml') { setErr('Solo file SVG'); return }
    const reader = new FileReader()
    reader.onload = () => onChange(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); readFile(e.dataTransfer.files?.[0]) }}
      className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer text-center"
    >
      <input ref={inputRef} type="file" accept=".svg,image/svg+xml" className="hidden" onChange={e => readFile(e.target.files?.[0])} />
      {value
        ? <IconRenderer name={value} size={28} />
        : <span className="text-2xl text-gray-300">▦</span>}
      <span className="text-xs text-gray-500">Trascina e rilascia l&apos;icona o <span className="underline">scegli il file</span></span>
      <span className="text-[10px] text-gray-400">Formati supportati: SVG</span>
      {err && <span className="text-[10px] text-red-500">{err}</span>}
    </div>
  )
}
```

- [✅] **Step 3: `TranslationsAccordion.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { SUPPORTED_LOCALES, type Locale } from '@/lib/rbac/types'
import TagInput from './TagInput'

const LABELS: Record<Locale, string> = {
  EN: 'Inglese', IT: 'Italiano', DE: 'Tedesco', FR: 'Francese', ES: 'Spagnolo', NL: 'Olandese', PT: 'Portoghese', SK: 'Slovacco', RO: 'Rumeno',
}
type Tr = Record<string, { name?: string; description?: string }>
type Tg = Record<string, string[]>

export default function TranslationsAccordion(
  { translations, tags, onTranslations, onTags }: { translations: Tr; tags: Tg; onTranslations: (t: Tr) => void; onTags: (t: Tg) => void },
) {
  const [open, setOpen] = useState<Record<string, boolean>>({ EN: true, IT: true })
  const setField = (loc: string, field: 'name' | 'description', v: string) =>
    onTranslations({ ...translations, [loc]: { ...translations[loc], [field]: v } })

  return (
    <div className="space-y-2">
      {SUPPORTED_LOCALES.map(loc => (
        <div key={loc} className="rounded-lg border border-gray-200 dark:border-gray-700">
          <button type="button" onClick={() => setOpen(o => ({ ...o, [loc]: !o[loc] }))} className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium">
            {LABELS[loc]}
            {open[loc] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {open[loc] && (
            <div className="px-3 pb-3 space-y-2">
              <input
                value={translations[loc]?.name ?? ''}
                onChange={e => setField(loc, 'name', e.target.value)}
                placeholder="Nome funzionalità"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent"
              />
              <textarea
                value={translations[loc]?.description ?? ''}
                onChange={e => setField(loc, 'description', e.target.value)}
                placeholder="Descrizione"
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent"
              />
              <TagInput value={tags[loc] ?? []} onChange={t => onTags({ ...tags, [loc]: t })} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [✅] **Step 4: Typecheck, lint & commit**

Run: `npx tsc --noEmit && npm run lint` → clean.
```bash
git add sources/microservices/web-construct/components/rbac/functionalities/
git commit -m "feat(rbac): functionality form sub-components (icon/tag/translations)"
```

---

## Task 8: FunctionalityForm + create/edit pages

**Files:** Create `components/rbac/functionalities/FunctionalityForm.tsx`, `app/(protected)/functionalities/create/page.tsx`, `app/(protected)/functionalities/[funcId]/edit/page.tsx`
**Interfaces:** Consumes `createNavigationItem`/`updateNavigationItem` (`@/lib/rbac/navigation-actions`), `getNavigationItem`/`getParentList` (`@/lib/rbac/functionalities-service`), the Task-7 sub-components, types. Produces the create/edit routes.

- [✅] **Step 1: `FunctionalityForm.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import IconUpload from './IconUpload'
import TagInput from './TagInput'
import TranslationsAccordion from './TranslationsAccordion'
import { createNavigationItem, updateNavigationItem } from '@/lib/rbac/navigation-actions'
import type { CreateNavItemInput, FunctionalityType } from '@/lib/rbac/types'

const FUNC_TYPES: { id: number; label: string }[] = [
  { id: 1, label: 'Pagina incorporata' }, { id: 2, label: 'Link esterno' },
  { id: 3, label: 'Funzionalità interna' }, { id: 5, label: 'Permesso' }, { id: 4, label: 'Desktop remoto' },
]

interface Initial {
  name: string; description: string; idItemType: 1 | 2; idFunctionalityType: number | null
  functionalityLink: string; iconPath: string; idItemParent: number | null
  translations: Record<string, { name?: string; description?: string }>; tagTranslations: Record<string, string[]>
}

export default function FunctionalityForm(
  { mode, funcId, initial, parents }:
  { mode: 'create' | 'edit'; funcId?: number; initial: Initial; parents: { id: number; name: string }[] },
) {
  const router = useRouter()
  const [f, setF] = useState<Initial>(initial)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Initial>(k: K, v: Initial[K]) => setF(prev => ({ ...prev, [k]: v }))

  const isFunc = f.idItemType === 2
  const itName = f.translations.IT?.name ?? ''
  const itDesc = f.translations.IT?.description ?? ''
  const valid = itName.trim().length > 0 && itDesc.trim().length > 0 && (!isFunc || (f.idFunctionalityType != null && f.functionalityLink.trim().length > 0))

  const submit = async () => {
    if (!valid) return
    setBusy(true)
    try {
      const input: CreateNavItemInput = {
        name: itName, idItemType: f.idItemType,
        idFunctionalityType: isFunc ? f.idFunctionalityType : null,
        functionalityLink: isFunc ? f.functionalityLink : null,
        iconPath: f.iconPath || null, idItemParent: f.idItemParent,
        description: itDesc, itemTranslation: f.translations, tagTranslations: f.tagTranslations,
      }
      if (mode === 'create') await createNavigationItem(input)
      else await updateNavigationItem(funcId!, input)
      router.push('/functionalities')
    } finally { setBusy(false) }
  }

  const itTags = f.tagTranslations.IT ?? []

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Funzionalità / {mode === 'create' ? 'Crea' : 'Modifica'}</h1>
        <button onClick={submit} disabled={!valid || busy} className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:opacity-40 disabled:cursor-not-allowed">
          {mode === 'create' ? 'Crea funzionalità' : 'Salva'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Informazioni generali</h2>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-3">
              <input value={itName} onChange={e => set('translations', { ...f.translations, IT: { ...f.translations.IT, name: e.target.value } })}
                placeholder="Nome funzionalità *" maxLength={100}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent" />
              <select value={f.idItemParent ?? ''} onChange={e => set('idItemParent', e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent">
                <option value="">Genitore</option>
                {parents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="w-32"><IconUpload value={f.iconPath} onChange={v => set('iconPath', v)} /></div>
          </div>
          <div>
            <textarea value={itDesc} onChange={e => set('translations', { ...f.translations, IT: { ...f.translations.IT, description: e.target.value } })}
              placeholder="Descrizione *" maxLength={500} rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent" />
            <div className="text-right text-[10px] text-gray-400">{itDesc.length}/500</div>
          </div>
          <TagInput value={itTags} onChange={t => set('tagTranslations', { ...f.tagTranslations, IT: t })} placeholder="Tags (IT)" />

          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 pt-2">Impostazioni</h2>
          <div className="flex items-center gap-6 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={f.idItemType === 1} onChange={() => set('idItemType', 1)} /> Categoria</label>
            <label className="flex items-center gap-2"><input type="radio" checked={f.idItemType === 2} onChange={() => set('idItemType', 2)} /> Funzionalità</label>
          </div>
          {isFunc && (
            <div className="space-y-3">
              <select value={f.idFunctionalityType ?? ''} onChange={e => set('idFunctionalityType', e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent">
                <option value="">Tipologia *</option>
                {FUNC_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <input value={f.functionalityLink} onChange={e => set('functionalityLink', e.target.value)} placeholder="Link *"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent" />
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Gestione traduzioni</h2>
          <TranslationsAccordion
            translations={f.translations} tags={f.tagTranslations}
            onTranslations={t => set('translations', t)} onTags={t => set('tagTranslations', t)} />
        </div>
      </div>
    </div>
  )
}
```

- [✅] **Step 2: `app/(protected)/functionalities/create/page.tsx`**

```tsx
import { getParentList } from '@/lib/rbac/functionalities-service'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'

export default async function CreateFunctionalityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const parents = await getParentList()
  const parentId = sp.parent ? Number(sp.parent) : null
  return (
    <FunctionalityForm
      mode="create"
      parents={parents}
      initial={{
        name: '', description: '', idItemType: 2, idFunctionalityType: null,
        functionalityLink: '', iconPath: '', idItemParent: parentId,
        translations: {}, tagTranslations: {},
      }}
    />
  )
}
```

- [✅] **Step 3: `app/(protected)/functionalities/[funcId]/edit/page.tsx`**

```tsx
import { getNavigationItem, getParentList } from '@/lib/rbac/functionalities-service'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'

export default async function EditFunctionalityPage({ params }: { params: Promise<{ funcId: string }> }) {
  const { funcId } = await params
  const id = Number(funcId)
  const [item, parents] = await Promise.all([getNavigationItem(id), getParentList()])
  return (
    <FunctionalityForm
      mode="edit"
      funcId={id}
      parents={parents.filter(p => p.id !== id)}
      initial={{
        name: item.name,
        description: item.description ?? '',
        idItemType: item.type === 'CATEGORY' ? 1 : 2,
        idFunctionalityType: item.functionalityType
          ? ({ EMBEDDED_PAGE: 1, EXTERNAL_LINK: 2, INTERNAL_FUNCTIONALITY: 3, REMOTE_DESKTOP: 4, PERMISSION: 5 }[item.functionalityType] ?? null)
          : null,
        functionalityLink: item.link ?? '',
        iconPath: item.icon ?? '',
        idItemParent: item.parentId,
        translations: item.translations ?? {},
        tagTranslations: item.tagTranslations ?? {},
      }}
    />
  )
}
```

- [✅] **Step 4: Typecheck, lint, build & commit**

Run: `npx tsc --noEmit && npm run lint && npm run build` → clean; `/functionalities/create` and `/functionalities/[funcId]/edit` in the route list.
```bash
git add "sources/microservices/web-construct/app/(protected)/functionalities/create/page.tsx" "sources/microservices/web-construct/app/(protected)/functionalities/[funcId]/edit/page.tsx" sources/microservices/web-construct/components/rbac/functionalities/FunctionalityForm.tsx
git commit -m "feat(rbac): functionality create/edit form + pages"
```

---

## Task 9: Functionalities tree page

**Files:** Create `components/rbac/functionalities/FunctionalitiesTreeClient.tsx`, `app/(protected)/functionalities/page.tsx`
**Interfaces:** Consumes `getNavigationSubtree` (`@/lib/rbac/functionalities-service`), `moveNavigationItem`/`deleteNavigationItem` (`@/lib/rbac/navigation-actions`), `NavigationTree`, types. Produces `/functionalities`.

- [✅] **Step 1: `FunctionalitiesTreeClient.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import NavigationTree from '@/components/rbac/NavigationTree'
import { moveNavigationItem, deleteNavigationItem } from '@/lib/rbac/navigation-actions'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

interface Props { rootTree: UserNavigationTreeDto[]; operationsTree: UserNavigationTreeDto[] }

export default function FunctionalitiesTreeClient({ rootTree, operationsTree }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'root' | 'operations'>('root')
  const [search, setSearch] = useState('')

  const activeTree = tab === 'root' ? rootTree : operationsTree

  const filterTree = (nodes: UserNavigationTreeDto[]): UserNavigationTreeDto[] => {
    if (!search.trim()) return nodes
    const q = search.toLowerCase()
    const walk = (ns: UserNavigationTreeDto[]): UserNavigationTreeDto[] =>
      ns.map(n => ({ ...n, children: walk(n.children) }))
       .filter(n => n.name.toLowerCase().includes(q) || n.children.length > 0)
    return walk(nodes)
  }

  const onMove = async (id: number, targetParentId: number, orderPosition: number) => {
    try { await moveNavigationItem(id, { targetParentId, orderPosition }); router.refresh() }
    catch (e) { alert(e instanceof Error ? e.message : 'Move failed') }
  }

  const trailing = (node: UserNavigationTreeDto) => {
    if (node.isImmutable) return null
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        {node.type === 'CATEGORY' && (
          <button data-testid="nav-add" title="Crea figlio" onClick={() => router.push(`/functionalities/create?root=${tab}&parent=${node.id}`)} className="p-1 text-gray-400 hover:text-gray-700"><Plus size={15} /></button>
        )}
        <button data-testid="nav-edit" title="Modifica" onClick={() => router.push(`/functionalities/${node.id}/edit`)} className="p-1 text-gray-400 hover:text-gray-700"><Pencil size={15} /></button>
        <button data-testid="nav-delete" title="Elimina" onClick={async () => {
          if (confirm(`Eliminare "${node.name}" e tutti i suoi figli?`)) {
            try { await deleteNavigationItem(node.id); router.refresh() }
            catch (e) { alert(e instanceof Error ? e.message : 'Delete failed') }
          }
        }} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Funzionalità</h1>
        <button onClick={() => router.push(`/functionalities/create?root=${tab}`)} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Crea nuovo</button>
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca"
        className="w-full max-w-sm mb-4 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent" />
      <div className="flex gap-6 border-b border-gray-200 dark:border-gray-800 mb-4">
        {(['root', 'operations'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-gray-900 text-gray-900 dark:text-white dark:border-white' : 'border-transparent text-gray-500'}`}>
            {t === 'root' ? 'Tutto' : 'Operazioni'}
          </button>
        ))}
      </div>
      <NavigationTree
        nodes={filterTree(activeTree)}
        renderTrailing={trailing}
        dnd={{ canDrag: n => !n.isImmutable, onMove }}
      />
    </div>
  )
}
```

- [✅] **Step 2: `app/(protected)/functionalities/page.tsx`**

```tsx
import { getNavigationSubtree } from '@/lib/rbac/functionalities-service'
import FunctionalitiesTreeClient from '@/components/rbac/functionalities/FunctionalitiesTreeClient'

export default async function FunctionalitiesPage() {
  const [rootTree, operationsTree] = await Promise.all([
    getNavigationSubtree('root'),
    getNavigationSubtree('operations'),
  ])
  return <FunctionalitiesTreeClient rootTree={rootTree} operationsTree={operationsTree} />
}
```

- [✅] **Step 3: Typecheck, lint, build & commit**

Run: `npx tsc --noEmit && npm run lint && npm run build` → clean; `/functionalities` in the route list.
```bash
git add "sources/microservices/web-construct/app/(protected)/functionalities/page.tsx" sources/microservices/web-construct/components/rbac/functionalities/FunctionalitiesTreeClient.tsx
git commit -m "feat(rbac): functionalities tree page with drag + node actions"
```

---

## Task 10: E2E tests & browser verification

**Files:** Create `sources/tests/e2e/test_functionalities.py`
**Prerequisites:** dev server running with `AUTH_TEST_CREDENTIALS=true`; `.env.test` has admin `TEST_EMAIL`.

- [✅] **Step 1: Write `sources/tests/e2e/test_functionalities.py`**

```python
import time
from playwright.sync_api import expect


def test_tree_loads_with_tabs(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/functionalities")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("heading", name="Funzionalità")).to_be_visible()
    expect(page.get_by_role("button", name="Tutto")).to_be_visible()
    expect(page.get_by_role("button", name="Operazioni")).to_be_visible()
    # Seeded immutable category RBAC is visible in the tree
    expect(page.get_by_text("RBAC", exact=True).first).to_be_visible()


def test_create_edit_delete_functionality(logged_in_page, base_url):
    page = logged_in_page
    name = f"E2E Func {int(time.time())}"
    # Create
    page.goto(f"{base_url}/functionalities/create?root=root")
    page.wait_for_load_state("networkidle")
    page.get_by_placeholder("Nome funzionalità *").fill(name)
    page.get_by_placeholder("Descrizione *").fill("desc")
    # type=Funzionalità is the default; choose Tipologia + Link
    page.locator("select").nth(1).select_option("3")  # second select = Tipologia
    page.get_by_placeholder("Link *").fill("/e2e-func")
    page.get_by_role("button", name="Crea funzionalità").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text(name, exact=True).first).to_be_visible()

    # Edit — open via the row's edit action
    row = page.locator("div").filter(has_text=name).last
    page.get_by_test_id("nav-edit").first  # ensure hooks exist
    # Navigate to edit by clicking the edit button on the matching row
    page.get_by_text(name, exact=True).first.scroll_into_view_if_needed()
    page.locator('[data-testid="nav-edit"]').first.click()
    page.wait_for_url("**/edit", timeout=10_000)
    renamed = name + " R"
    it_name = page.get_by_placeholder("Nome funzionalità *")
    it_name.fill(renamed)
    page.get_by_role("button", name="Salva").click()
    page.wait_for_url("**/functionalities", timeout=10_000)
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text(renamed, exact=True).first).to_be_visible()

    # Delete
    page.once("dialog", lambda d: d.accept())
    page.get_by_text(renamed, exact=True).first.scroll_into_view_if_needed()
    page.locator('[data-testid="nav-delete"]').first.click()
    page.wait_for_timeout(800)
    page.reload()
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text(renamed, exact=True)).to_have_count(0)


def test_immutable_item_has_no_actions(logged_in_page, base_url):
    page = logged_in_page
    page.goto(f"{base_url}/functionalities")
    page.wait_for_load_state("networkidle")
    # RBAC is immutable → its row exposes no edit/delete buttons.
    rbac_row = page.locator("div").filter(has_text="RBAC").first
    expect(rbac_row.locator('[data-testid="nav-delete"]')).to_have_count(0)
```

> Note for the implementer: the edit/delete tests target `[data-testid="nav-edit"]`/`[data-testid="nav-delete"]` with `.first` after filtering/scrolling to the created row. If `.first` proves ambiguous on a large seeded tree, narrow with `page.locator("div", has_text=name).locator('[data-testid="nav-edit"]')`. Iterate against the running server until all three tests pass; do not weaken assertions.

- [✅] **Step 2: Run the functionalities E2E**

Run (repo root): `HEADLESS=true uv run pytest sources/tests/e2e/test_functionalities.py -v`
Expected: 3 passed. Iterate selectors if needed (without weakening assertions).

- [✅] **Step 3: Full suite (no regressions)**

Run: `HEADLESS=true uv run pytest sources/tests/e2e -v`
Expected: all pass (Phase 0 + Phase 1 + functionalities).

- [✅] **Step 4: Browser verification (REQUIRED — covers the un-E2E'd drag)**

Manually (or with `webapp-testing`): open `/functionalities`; drag a functionality to reorder among siblings (verify it persists after refresh); drag a functionality onto a different category (verify it re-parents); confirm an immutable item (RBAC) can't be dragged and shows no edit/delete; create a functionality with an SVG icon and confirm it renders in the tree/sidebar (and that a `<script>`-laced SVG is stripped — paste `<svg onload="alert(1)"><script>…</script></svg>` and confirm no alert).

- [✅] **Step 5: Commit**

```bash
git add sources/tests/e2e/test_functionalities.py
git commit -m "test(e2e): functionalities tree create/edit/delete + immutable guard"
```

---

## Self-Review (completed during planning)

**Spec coverage (spec → task):**
- DTO extension + input types (spec §2) → Task 1. ✓
- SVG sanitize CARRY-3 (spec §3.1, DEC-P2-2) → Task 2. ✓
- canDeleteSubtree/isDescendant/buildNavTree CARRY-4 + filtering (spec §3.2/3.3, DEC-P2-3/4) → Task 3. ✓
- Read service getNavigationSubtree/getNavigationItem/getParentList (spec §4) → Task 4. ✓
- Actions create/update/move/delete with sanitize + guards + tags replace-all (spec §4, DEC-P2-5) → Task 5. ✓
- NavigationTree drag @dnd-kit DEC-P2-1/8 (spec §5.1) → Task 6. ✓
- Form sub-components (spec §5.3) → Task 7. ✓
- FunctionalityForm + create/edit pages (spec §5.3) → Task 8. ✓
- Tree page tabs + actions + drag (spec §5.2) → Task 9. ✓
- Testing (spec §6) → Tasks 2,3 (unit) + Task 10 (E2E + browser, incl. drag + XSS check). ✓

**Placeholder scan:** none — every code/test step is complete.

**Type consistency:** `CreateNavItemInput`/`UpdateNavItemInput`/`MoveInput`/`FunctionalityType`/extended `UserNavigationTreeDto` defined in Task 1, used identically in Tasks 4/5/8/9. `buildNavTree(items, tagsByItem, rootId, locale?)`, `canDeleteSubtree(items, id)`, `isDescendant(items, candidateId, ancestorId)` defined in Task 3 match their use in Tasks 4/5. `sanitizeSvg` (Task 2) used in Task 5. `NavigationTree` `dnd` prop `{ canDrag, onMove }` (Task 6) matches Task 9's usage. Action signatures (Task 5) match the form/tree calls (Tasks 8/9).
