# RBAC Phase 2 — Functionalities — Design Spec

**Date:** 2026-06-28
**Branch:** `feature/rbac` (continues from Phases 0–1)
**Builds on:** `docs/superpowers/specs/2026-06-28-rbac-module-design.md` (overall RBAC spec, §4) and the completed Phase 0–1 foundation.
**Target:** `sources/microservices/web-construct/`

---

## Summary

Phase 2 delivers the **Functionalities** admin area (`/functionalities`): a tabbed navigation-item tree (Tutto / Operazioni) with drag-and-drop reorder/re-parent, per-node create/edit/delete, and a two-column create/edit form with SVG icon upload, the 5 functionality types, and a 9-language translations + tags editor.

It also closes two Phase-0 carry-forwards that this area first exercises: **CARRY-3** (sanitize admin-supplied SVG to kill the stored-XSS vector) and **CARRY-4** (block deleting/editing immutable system nodes server-side).

### Key decisions

- [x] ✅ ID=DEC-P2-1, Title=Drag-and-drop via @dnd-kit — `@dnd-kit/core` + `@dnd-kit/sortable` power the `⠿` handle: reorder among siblings, drop onto a category to re-parent; each fires `moveNavigationItem`. Drag disabled for `is_immutable=1` rows.
- [x] ✅ ID=DEC-P2-2, Title=Server sanitize-on-write for SVG (CARRY-3) — `createNavigationItem`/`updateNavigationItem` run `iconPath` through DOMPurify (`isomorphic-dompurify`) with an SVG profile BEFORE persisting; the DB only ever holds clean markup.
- [x] ✅ ID=DEC-P2-3, Title=Immutable guard server-side (CARRY-4) — delete blocked if the target or ANY descendant is `is_immutable=1`; edit and move are also rejected for `is_immutable=1` items; virtual roots (0, -1) are never deletable/movable.
- [x] ✅ ID=DEC-P2-4, Title=Config-visibility filtering — the Functionalities tree hides `config_visibility=1` items (so seeded operations PERMISSION items don't appear). The role-permission tree (Phase 1) still shows them — different context.
- [x] ✅ ID=DEC-P2-5, Title=Tags replace-all on save — `navigation_item_tag` rows are deleted + re-inserted per save (no diffing).
- [x] ✅ ID=DEC-P2-6, Title=Form does not expose advanced flags — new items default `is_immutable=0, config_visibility=0, no_permission_need_for_navigation=0, navbar_position=null`; the form only edits the fields in the mockup.
- [x] ✅ ID=DEC-P2-7, Title=Extend `UserNavigationTreeDto` with optional form fields — `description, functionalityType, link, icon, navbarPosition, translations, tagTranslations`; Phase-1 consumers keep compiling.
- [x] ✅ ID=DEC-P2-8, Title=`NavigationTree` gains OPTIONAL drag support — absent `dnd` prop ⇒ unchanged behavior (Phase 1 PermissionsTree untouched).
- [x] ✅ ID=DEC-P2-9, Title=Two tabs (Tutto/Operazioni); Batch Patch omitted (overall DEC-10).
- [x] ✅ ID=DEC-P2-10, Title=Pure, unit-tested security/logic helpers — `sanitizeSvg`, `canDeleteSubtree`, `buildNavTree`, move cycle-guard.

---

## 1. Architecture

Same patterns as Phases 0–1: Server Components fetch via `createAdminClient()`; Client Components interact; mutations are server actions in `lib/rbac/navigation-actions.ts`, each calling `requireAdmin()`; read-side in `lib/rbac/functionalities-service.ts`, `cache()`-wrapped. The trickiest/security-critical logic lives in pure, unit-tested functions.

**New dependencies:** `@dnd-kit/core`, `@dnd-kit/sortable`, `isomorphic-dompurify`.

### File structure

**Created:**
- `lib/rbac/svg-sanitize.ts` (+ `.test.ts`) — `sanitizeSvg(raw: string): string`.
- `lib/rbac/nav-tree-builder.ts` (+ `.test.ts`) — `buildNavTree`, `canDeleteSubtree`, `isDescendant` (cycle guard).
- `lib/rbac/functionalities-service.ts` — `getNavigationSubtree`, `getNavigationItem`, `getParentList`.
- `lib/rbac/navigation-actions.ts` — `createNavigationItem`, `updateNavigationItem`, `moveNavigationItem`, `deleteNavigationItem`.
- `components/rbac/functionalities/FunctionalitiesTreeClient.tsx`, `FunctionalityForm.tsx`, `IconUpload.tsx`, `TagInput.tsx`, `TranslationsAccordion.tsx`.
- `app/(protected)/functionalities/page.tsx`, `app/(protected)/functionalities/create/page.tsx`, `app/(protected)/functionalities/[funcId]/edit/page.tsx`.

**Modified:**
- `components/rbac/NavigationTree.tsx` — optional drag support.
- `lib/rbac/types.ts` — extend `UserNavigationTreeDto`; add `CreateNavItemInput`, `UpdateNavItemInput`, `MoveInput`, `FunctionalityType`.
- `package.json` — the three new deps.

---

## 2. Data model (extend `lib/rbac/types.ts`)

```ts
export type FunctionalityType =
  | 'EMBEDDED_PAGE' | 'EXTERNAL_LINK' | 'INTERNAL_FUNCTIONALITY' | 'REMOTE_DESKTOP' | 'PERMISSION'

// UserNavigationTreeDto extended with OPTIONAL fields (Phase-1 consumers set only id/name/type/parentId/authorization/children):
//   description?: string | null
//   functionalityType?: FunctionalityType | null
//   link?: string | null
//   icon?: string | null
//   navbarPosition?: 'TOP' | 'BOTTOM' | null
//   translations?: Record<string, { name?: string; description?: string }>
//   tagTranslations?: Record<string, string[]>

export interface CreateNavItemInput {
  name: string                       // IT name, required
  idItemType: 1 | 2                  // CATEGORY | FUNCTIONALITY
  idFunctionalityType: number | null // required when FUNCTIONALITY, else null
  functionalityLink: string | null   // required when FUNCTIONALITY
  iconPath: string | null
  idItemParent: number | null        // null ⇒ under the active root
  description: string                 // IT description, required
  itemTranslation: Record<string, { name?: string; description?: string }>
  tagTranslations: Record<string, string[]>
}
export type UpdateNavItemInput = CreateNavItemInput
export interface MoveInput { targetParentId: number; orderPosition: number }
```

The functionality-type id↔label map (UI, Italian): 1 Pagina incorporata, 2 Link esterno, 3 Funzionalità interna, 4 Desktop remoto, 5 Permesso. Locales per the global list (EN, IT, DE, FR, ES, NL, PT, SK, RO).

---

## 3. Security & pure logic

### 3.1 `sanitizeSvg` (CARRY-3, `lib/rbac/svg-sanitize.ts`)
Wraps `isomorphic-dompurify`:
- If the input is empty or not SVG markup (does not start with `<svg`, reusing the same check as `isInlineSvg`), return it unchanged (lucide names pass through).
- Otherwise `DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script','foreignObject'], FORBID_ATTR: ['onload','onerror','onclick','onmouseover'] })` (the SVG profile already drops scripting; the explicit forbids are belt-and-suspenders).
- Unit tests: `<svg onload="alert(1)">…` → no `onload`; `<svg><script>…</script></svg>` → no `<script>`; a clean `<svg><path/></svg>` → preserved; `'House'` (lucide name) → unchanged; `''` → `''`.

### 3.2 `canDeleteSubtree` (CARRY-4, `lib/rbac/nav-tree-builder.ts`)
`canDeleteSubtree(items: NavigationItemRow[], id: number): boolean` → false if the node `id` or any descendant has `is_immutable === 1`. `deleteNavigationItem` calls it and throws when false. Also reject `id ∈ {0, -1}`. Unit-tested (immutable target blocked; immutable descendant blocks parent; fully-deletable subtree allowed).

### 3.3 `isDescendant` (cycle guard) and `buildNavTree`
- `isDescendant(items, candidateParentId, nodeId)` → true if `candidateParentId` is within `nodeId`'s subtree; `moveNavigationItem` rejects a move whose `targetParentId` would create a cycle. Unit-tested.
- `buildNavTree(items: NavigationItemRow[], tagsByItem: Map<number,{lang,tag}[]>, rootId: number, locale?): UserNavigationTreeDto[]` — pure; builds children of `rootId` ordered by `order_position`, EXCLUDING `config_visibility === 1`, populating all extended fields (translations from `item_translation`, tagTranslations from `tagsByItem`, localized `name`/`description` via `DEFAULT_LOCALE` fallback). Unit-tested (config_visibility filtered; nested fields + tags present).

---

## 4. Read service & actions

**`functionalities-service.ts`** (`cache()`-wrapped):
- `getNavigationSubtree(root: 'root' | 'operations'): Promise<UserNavigationTreeDto[]>` — maps name→id (`root`→0, `operations`→-1); fetches `navigation_item` (all columns the form needs) + `navigation_item_tag`; calls `buildNavTree`.
- `getNavigationItem(id: number): Promise<UserNavigationTreeDto>` — single node (no children) for edit pre-fill, with translations + tags.
- `getParentList(): Promise<{ id: number; name: string }[]>` — CATEGORY items eligible as parents (excludes nothing by immutability — you can nest under a system category, e.g. add a child to RBAC — but the parent itself stays immutable).

**`navigation-actions.ts`** (each `requireAdmin()`):
- `createNavigationItem(input: CreateNavItemInput): Promise<{ id: number }>` — `sanitizeSvg(iconPath)`; resolve parent (input.idItemParent ?? active root id passed in input); compute `orderPosition` = max sibling order + 1; insert `navigation_item` with the defaults from DEC-P2-6; write `item_translation` jsonb; insert `navigation_item_tag` rows from `tagTranslations`.
- `updateNavigationItem(id, input)` — reject if `is_immutable=1`; `sanitizeSvg`; update row + `item_translation`; delete + re-insert `navigation_item_tag` (replace-all); set `date_mod=now()`.
- `moveNavigationItem(id, { targetParentId, orderPosition })` — reject if `id ∈ {0,-1}` or `is_immutable=1`; reject if `isDescendant(items, targetParentId, id)` (cycle); update `id_item_parent` + `order_position`.
- `deleteNavigationItem(id)` — `canDeleteSubtree` guard (throws otherwise) → delete row (DB `ON DELETE CASCADE` removes descendants).

---

## 5. UI

### 5.1 `NavigationTree` extension
Add an optional `dnd?` prop bundling: a per-node `draggable(node): boolean` (false for `is_immutable`), and `onMove(id, targetParentId, orderPosition)`. When present, rows render a `⠿` handle and become `@dnd-kit` sortable/droppable; dropping among siblings reorders, dropping onto a category re-parents. When `dnd` is absent, the component renders exactly as in Phase 1 (PermissionsTree unaffected). The existing `renderTrailing`/`expandedByDefault` props are unchanged.

### 5.2 Tree page — `/functionalities`
Server Component loads `getNavigationSubtree('root')` + `getNavigationSubtree('operations')` → `FunctionalitiesTreeClient`:
- Tabs **Tutto** (root) / **Operazioni** (operations). Left: search input (client-side filter). Right: **"Crea nuovo"** → `/functionalities/create?root={activeRoot}`.
- `NavigationTree` with `dnd` enabled; `renderTrailing` provides the action buttons: CATEGORY `+`/`✎`/`🗑`, FUNCTIONALITY `✎`/`🗑`; `+` → create child (`?root` + `parent` prefilled), `✎` → `/functionalities/{id}/edit`, `🗑` → confirm modal → `deleteNavigationItem` → `router.refresh()`. Edit/delete and drag are disabled for `is_immutable=1`.

### 5.3 Create/Edit form
Shared `FunctionalityForm` (two-column), used by `create/page.tsx` (reads `?root`, `?parent`) and `[funcId]/edit/page.tsx` (pre-fills via `getNavigationItem`):
- **Left — Informazioni generali:** Nome (IT, required ≤100); Genitore dropdown (`getParentList`); `IconUpload` (SVG-only, drag&drop + file picker, reads file→text, inline preview); Descrizione (IT, required ≤500, counter); `TagInput` (IT). **Impostazioni:** radio Categoria/Funzionalità → when Funzionalità: Tipologia dropdown (5 types, required) + Link (required).
- **Right — Gestione traduzioni:** `TranslationsAccordion` over all 9 locales (EN/IT expanded by default); per locale: name, description, `TagInput`.
- Submit button (top-right) disabled until required fields valid → `createNavigationItem` / `updateNavigationItem` → redirect to `/functionalities`.

`IconUpload`, `TagInput`, `TranslationsAccordion` are small focused client components.

---

## 6. Testing

- [ ] **Unit (vitest):** `sanitizeSvg` (strips script/onload/foreignObject; preserves clean SVG; passes lucide names/empty); `canDeleteSubtree` (immutable target + immutable-descendant blocked; deletable subtree allowed; roots blocked); `isDescendant` cycle guard; `buildNavTree` (config_visibility filtered, nested fields + tagTranslations populated, order honored).
- [ ] **E2E (pytest/Playwright):** create a category → in tree; create a functionality under it (type + link + EN translation) → in tree; edit it → change persists on reload; delete it (confirm) → gone; an immutable seeded item (e.g. RBAC) shows no delete action / delete is blocked. Run against the dev server (`AUTH_TEST_CREDENTIALS=true`).
- [ ] **Browser verification:** tree renders both tabs; a drag-move reorders/re-parents and persists; the two-column form creates and edits.

---

## 7. Out of scope (later)
- Users area + role assignment (Phase 3).
- Enforcing granular OPERATIONS permissions at call sites.
- Batch Patch (overall DEC-10).
- Remaining Phase-1 minor debt CARRY-8/9/10 (atomicity RPC, DRY/perf, URL-state polish) — not required for Phase 2.
