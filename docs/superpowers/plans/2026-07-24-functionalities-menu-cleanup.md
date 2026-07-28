# Pulizia pagina Funzionalità Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rimuovere completamente la vista "Operations" dalla pagina Funzionalità, aggiungere icone per tipo nella tree view, e rimuovere la voce cliccabile "Genitore" dal dropdown del form.

**Architecture:** Tre modifiche indipendenti e non sovrapposte nel progetto `sources/microservices/web-construct/`: (1) rimozione di stato/route/query-param legati al tab "Operations" in tre file server/client della pagina Funzionalità; (2) una funzione pura `typeIcon` in `NavigationTree.tsx` che mappa `type`/`functionalityType` a un'icona Lucide, resa testabile e usata sia nella riga dell'albero sia nel `DragOverlay`; (3) rimozione di un blocco JSX in `CustomSelect.tsx`.

**Tech Stack:** Next.js 16 (App Router), React 19 + TypeScript, Tailwind CSS v4, lucide-react, Vitest (unit), Playwright/pytest (e2e, via `uv run pytest`).

## Global Constraints

- E2E: usare sempre `uv run pytest`, mai `python`/`python3` direttamente (da `CLAUDE.md`).
- Unit test: `npm run test` esegue `vitest run` (non watch mode); per un singolo file: `npm run test -- <path-o-pattern>`.
- Lint: `npm run lint` (ESLint, `next/core-web-vitals` + `next/typescript`) deve passare senza nuovi errori dopo ogni task.
- Tutti i comandi npm vanno eseguiti da `sources/microservices/web-construct/`; tutti i comandi `uv run pytest` da `sources/tests/e2e/` (o con il path del file dalla root, come documentato in `CLAUDE.md`).
- Non modificare `lib/rbac/sidebar-adapter.ts`, lo schema DB, `OPERATIONS_ID`/`ROOT_ID` in `lib/rbac/types.ts`, né i dati esistenti sotto `OPERATIONS_ID` — sono fuori scope (si veda `docs/superpowers/specs/2026-07-24-functionalities-menu-cleanup-design.md`).
- Nessuna funzionalità di ruoli/privilegi viene toccata in questo piano.

---

### Task 1: Rimozione completa della vista "Operations" dalla pagina Funzionalità

**Files:**
- Modify: `sources/microservices/web-construct/app/(protected)/functionalities/page.tsx`
- Modify: `sources/microservices/web-construct/components/rbac/functionalities/FunctionalitiesTreeClient.tsx`
- Modify: `sources/microservices/web-construct/app/(protected)/functionalities/create/page.tsx`
- Test: `sources/tests/e2e/test_functionalities.py`

**Interfaces:**
- Consumes: `getNavigationSubtree(root: 'root' | 'operations')` da `lib/rbac/functionalities-service.ts` (firma invariata, non toccare il file); `ROOT_ID` da `lib/rbac/types.ts`.
- Produces: `FunctionalitiesTreeClient` espone ora la prop `tree: UserNavigationTreeDto[]` (non più `rootTree`/`operationsTree`). Nessun altro task dipende da questa interfaccia.

- [ ] **Step 1: Scrivi il test e2e che fallisce (rosso) — l'albero non deve più mostrare i tab**

Apri `sources/tests/e2e/test_functionalities.py` e sostituisci interamente la funzione `test_tree_loads_with_tabs` (righe 33-40) con:

```python
def test_tree_loads(logged_in_page, base_url):
    page = logged_in_page
    nav(page, f"{base_url}/functionalities")
    expect(page.get_by_role("heading", name="Funzionalità")).to_be_visible()
    expect(page.get_by_role("button", name="Operazioni")).to_have_count(0)
    # Seeded immutable category Admin is visible in the tree
    expect(page.get_by_text("Admin", exact=True).first).to_be_visible()
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py::test_tree_loads -v`
Expected: FAIL — `expect(...).to_have_count(0)` trova 1 bottone "Operazioni" (il tab esiste ancora).

- [ ] **Step 3: Rimuovi la fetch di `operationsTree` dalla pagina server**

Sostituisci il contenuto di `app/(protected)/functionalities/page.tsx` con:

```tsx
import { getNavigationSubtree } from '@/lib/rbac/functionalities-service'
import FunctionalitiesTreeClient from '@/components/rbac/functionalities/FunctionalitiesTreeClient'

export default async function FunctionalitiesPage() {
  const tree = await getNavigationSubtree('root')
  return <FunctionalitiesTreeClient tree={tree} />
}
```

- [ ] **Step 4: Rimuovi il tab "Operations" dal client component**

Sostituisci il contenuto di `components/rbac/functionalities/FunctionalitiesTreeClient.tsx` con:

```tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, SlidersHorizontal, Search, X } from 'lucide-react'
import NavigationTree from '@/components/rbac/NavigationTree'
import FilterDrawer from '@/components/rbac/FilterDrawer'
import { PageContainer } from '@/components/PageContainer'
import { moveNavigationItem, deleteNavigationItem } from '@/lib/rbac/navigation-actions'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

interface Props { tree: UserNavigationTreeDto[] }

export default function FunctionalitiesTreeClient({ tree }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const filterTree = (nodes: UserNavigationTreeDto[]): UserNavigationTreeDto[] => {
    if (!search.trim()) return nodes
    const q = search.toLowerCase()
    const walk = (ns: UserNavigationTreeDto[]): UserNavigationTreeDto[] =>
      ns.map(n => ({ ...n, children: walk(n.children ?? []) }))
       .filter(n => n.name.toLowerCase().includes(q) || (n.children?.length ?? 0) > 0)
    return walk(nodes)
  }

  const onMove = async (id: number, targetParentId: number, orderPosition: number) => {
    try { await moveNavigationItem(id, { targetParentId, orderPosition }); router.refresh() }
    catch (e) { alert(e instanceof Error ? e.message : 'Move failed') }
  }

  const clearFilters = () => { setSearchDraft(''); setSearch('') }

  const trailing = (node: UserNavigationTreeDto) => {
    if (node.isImmutable) return null
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <button data-testid="nav-add" title="Aggiungi sotto-elemento" onClick={() => router.push(`/functionalities/create?parent=${node.id}`)} className="p-1 text-gray-400 hover:text-gray-700"><Plus size={15} /></button>
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
    <PageContainer title="Funzionalità">
      <div className="flex items-center justify-end gap-2">
        <div className="relative">
          <button
            data-testid="open-filters"
            onClick={() => {
              if (!showFilters) setSearchDraft(search)
              setShowFilters(s => !s)
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border"
          >
            <SlidersHorizontal size={16} /> Filtri
            {search.trim() !== '' && (
              <span data-testid="filters-badge" className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] leading-none">
                1
              </span>
            )}
          </button>
          {search.trim() !== '' && (
            <button data-testid="clear-filters" aria-label="Rimuovi filtri" onClick={clearFilters} className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-red-100 hover:bg-red-200 text-red-500 z-10">
              <X size={9} />
            </button>
          )}
        </div>
        <button onClick={() => router.push('/functionalities/create')} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Crea nuovo</button>
      </div>
      <FilterDrawer
        open={showFilters}
        onClose={() => setShowFilters(false)}
        onApply={() => { setSearch(searchDraft); setShowFilters(false) }}
        onReset={clearFilters}
      >
        <div className="space-y-1">
          <label className="text-sm font-medium block">Cerca</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              data-testid="filter-search"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              placeholder="Cerca"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface-overlay"
            />
          </div>
        </div>
      </FilterDrawer>
      <NavigationTree
        nodes={filterTree(tree)}
        renderTrailing={trailing}
        dnd={search.trim() ? undefined : { canDrag: n => !n.isImmutable, onMove }}
      />
    </PageContainer>
  )
}
```

- [ ] **Step 5: Rimuovi il branching su `OPERATIONS_ID` nella pagina di creazione**

Sostituisci il contenuto di `app/(protected)/functionalities/create/page.tsx` con:

```tsx
import { getParentList } from '@/lib/rbac/functionalities-service'
import FunctionalityForm from '@/components/rbac/functionalities/FunctionalityForm'
import { ROOT_ID } from '@/lib/rbac/types'

export default async function CreateFunctionalityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const parents = await getParentList()
  const parentId = sp.parent ? Number(sp.parent) : null
  return (
    <FunctionalityForm
      mode="create"
      parents={parents}
      initial={{
        description: '', idItemType: 2, idFunctionalityType: null,
        functionalityLink: '', iconPath: '', idItemParent: parentId,
        idRootParent: ROOT_ID,
        translations: {}, tagTranslations: {},
      }}
    />
  )
}
```

- [ ] **Step 6: Esegui il test e verifica che passi (verde)**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py::test_tree_loads -v`
Expected: PASS

- [ ] **Step 7: Ripulisci i residui `?root=root` ormai obsoleti nella suite e2e**

Nello stesso file `sources/tests/e2e/test_functionalities.py`:

a) riga 14, dentro `_create_functionality`, sostituisci:
```python
    nav(page, f"{base_url}/functionalities/create?root=root")
```
con:
```python
    nav(page, f"{base_url}/functionalities/create")
```

b) righe 97-98, dentro `test_create_edit_delete_functionality`, sostituisci:
```python
    # Create — navigate with ?root=root so the server knows which subtree
    nav(page, f"{base_url}/functionalities/create?root=root")
```
con:
```python
    nav(page, f"{base_url}/functionalities/create")
```

c) riga 208, dentro `test_functionality_create_annulla_navigates_back`, sostituisci:
```python
    nav(page, f"{base_url}/functionalities/create?root=root")
```
con:
```python
    nav(page, f"{base_url}/functionalities/create")
```

- [ ] **Step 8: Esegui l'intera suite e2e di functionalities e verifica che passi**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py -v`
Expected: PASS (tutti i test, incluso il nuovo `test_tree_loads`)

- [ ] **Step 9: Lint**

Run (da `sources/microservices/web-construct/`): `npm run lint`
Expected: nessun nuovo errore/warning sui file toccati

- [ ] **Step 10: Commit**

```bash
git add sources/microservices/web-construct/app/\(protected\)/functionalities/page.tsx \
        sources/microservices/web-construct/components/rbac/functionalities/FunctionalitiesTreeClient.tsx \
        sources/microservices/web-construct/app/\(protected\)/functionalities/create/page.tsx \
        sources/tests/e2e/test_functionalities.py
git commit -m "feat(functionalities): remove Operations tab from the page entirely"
```

---

### Task 2: Icone per tipo di funzionalità nella tree view

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/NavigationTree.tsx`
- Create: `sources/microservices/web-construct/components/rbac/NavigationTree.test.tsx`

**Interfaces:**
- Consumes: `UserNavigationTreeDto` (`type: 'CATEGORY' | 'FUNCTIONALITY'`, `functionalityType?: FunctionalityType | null`) da `lib/rbac/types.ts` — nessuna modifica a quel file.
- Produces: esporta una nuova funzione pura `typeIcon(node: Pick<UserNavigationTreeDto, 'type' | 'functionalityType'>): LucideIcon` da `NavigationTree.tsx`. Nessun altro task la consuma.

- [ ] **Step 1: Scrivi il test unitario che fallisce (rosso)**

Crea `components/rbac/NavigationTree.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { FolderTree, Code, Globe, Link as LinkIcon, Circle } from 'lucide-react'
import { typeIcon } from './NavigationTree'

describe('typeIcon', () => {
  it('returns FolderTree for categories regardless of functionalityType', () => {
    expect(typeIcon({ type: 'CATEGORY', functionalityType: null })).toBe(FolderTree)
  })
  it('returns Code for embedded-page functionalities', () => {
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: 'EMBEDDED_PAGE' })).toBe(Code)
  })
  it('returns Globe for external-link functionalities', () => {
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: 'EXTERNAL_LINK' })).toBe(Globe)
  })
  it('returns LinkIcon for internal-link functionalities', () => {
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: 'INTERNAL_FUNCTIONALITY' })).toBe(LinkIcon)
  })
  it('falls back to Circle for types not creatable from the form', () => {
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: 'REMOTE_DESKTOP' })).toBe(Circle)
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: 'PERMISSION' })).toBe(Circle)
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: null })).toBe(Circle)
  })
})
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run (da `sources/microservices/web-construct/`): `npm run test -- components/rbac/NavigationTree.test.tsx`
Expected: FAIL — `typeIcon` non è esportato da `./NavigationTree`

- [ ] **Step 3: Implementa `typeIcon` e integra le icone nell'albero**

Sostituisci il contenuto di `components/rbac/NavigationTree.tsx` con:

```tsx
'use client'

import React, { useState, useCallback, useRef } from 'react'
import { ChevronDown, ChevronRight, GripVertical, FolderTree, Code, Globe, Link as LinkIcon, Circle, type LucideIcon } from 'lucide-react'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, pointerWithin,
  useDraggable, useDroppable, type DragStartEvent, type DragMoveEvent, type DragEndEvent,
} from '@dnd-kit/core'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

type DropPos = 'before' | 'after' | 'into'
interface Indicator { id: number; pos: DropPos }

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
  activeId: number | null
  indicator: Indicator | null
}

/** Icon shown before the node name, one per functionality "kind" (F-05). */
export function typeIcon(node: Pick<UserNavigationTreeDto, 'type' | 'functionalityType'>): LucideIcon {
  if (node.type === 'CATEGORY') return FolderTree
  switch (node.functionalityType) {
    case 'EMBEDDED_PAGE': return Code
    case 'EXTERNAL_LINK': return Globe
    case 'INTERNAL_FUNCTIONALITY': return LinkIcon
    default: return Circle
  }
}

const TreeRow: React.FC<RowProps> = ({ node, depth, renderTrailing, expandedByDefault, dnd, activeId, indicator }) => {
  const isCategory = node.type === 'CATEGORY'
  const hasChildren = node.children.length > 0
  const [open, setOpen] = useState(expandedByDefault)
  const canDrag = dnd ? dnd.canDrag(node) : false
  const TypeIcon = typeIcon(node)

  const drag = useDraggable({ id: `item-${node.id}`, disabled: !canDrag })
  // One droppable per row; before/after/into is derived from the pointer position in onDragOver.
  const drop = useDroppable({ id: `row-${node.id}` })

  // Extract dnd refs/handlers before JSX to satisfy react-hooks/refs lint rule
  const dragActivatorRef = drag.setActivatorNodeRef
  const dragNodeRef = drag.setNodeRef
  const dragListeners = drag.listeners
  const dragAttributes = drag.attributes
  const dropRef = drop.setNodeRef

  // dnd-kit needs setNodeRef on the draggable element (not just the activator handle)
  // to measure the active rect; merge the draggable + droppable refs onto the row line.
  const setRowRef = useCallback((el: HTMLElement | null) => {
    dragNodeRef(el)
    dropRef(el)
  }, [dragNodeRef, dropRef])

  const ind = indicator && indicator.id === node.id ? indicator.pos : null
  const isDragged = activeId === node.id

  return (
    <div>
      <div
        ref={dnd ? setRowRef : undefined}
        className={`relative flex items-center gap-2 py-2.5 px-3 border-b border-border-subtle ${ind === 'into' ? 'bg-primary/10 ring-1 ring-inset ring-primary/40' : ''} ${isDragged ? 'opacity-40' : ''}`}
        style={{ paddingLeft: 12 + depth * 24 }}
      >
        {/* Insertion line (F-03) — a clear blue bar with a dot on the left.
            left matches the row's own paddingLeft (not just left-2) so the line
            starts indented at the target depth — otherwise absolute positioning
            ignores padding and every depth's line starts at the same x. */}
        {(ind === 'before' || ind === 'after') && (
          <span
            data-testid={`drop-line-${ind}`}
            className={`pointer-events-none absolute right-2 h-0.5 bg-primary z-10 ${ind === 'before' ? '-top-px' : '-bottom-px'}`}
            style={{ left: 12 + depth * 24 }}
          >
            <span className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-primary" />
          </span>
        )}
        {dnd && (
          <button
            // eslint-disable-next-line react-hooks/refs
            ref={dragActivatorRef}
            // eslint-disable-next-line react-hooks/refs
            {...dragListeners}
            // eslint-disable-next-line react-hooks/refs
            {...dragAttributes}
            data-testid="drag-handle"
            disabled={!canDrag}
            className={`p-0.5 text-gray-400 touch-none ${canDrag ? 'cursor-grab active:cursor-grabbing hover:text-gray-600' : 'opacity-30 cursor-not-allowed'}`}
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
        <TypeIcon size={14} className="shrink-0 text-gray-400" />
        <span className={`flex-1 text-sm ${isCategory ? 'font-medium' : ''}`}>
          {node.name}
        </span>
        {renderTrailing?.(node)}
      </div>
      {hasChildren && open && node.children.map(c => (
        <TreeRow key={c.id} node={c} depth={depth + 1} renderTrailing={renderTrailing} expandedByDefault={expandedByDefault} dnd={dnd} activeId={activeId} indicator={indicator} />
      ))}
    </div>
  )
}

export default function NavigationTree({ nodes, renderTrailing, expandedByDefault = true, dnd }: NavigationTreeProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [activeId, setActiveId] = useState<number | null>(null)
  const [indicator, setIndicator] = useState<Indicator | null>(null)
  const indicatorRef = useRef<Indicator | null>(null)
  // Pointer Y at drag start; combined with the live delta it gives the exact pointer
  // position, which is far more reliable for before/after than the dragged item's rect.
  const pointerStartY = useRef(0)

  const index = React.useMemo(() => {
    const byId = new Map<number, UserNavigationTreeDto>()
    const walk = (ns: UserNavigationTreeDto[]) => ns.forEach(n => { byId.set(n.id, n); walk(n.children) })
    walk(nodes)
    return byId
  }, [nodes])

  // Is `maybeChild` inside the subtree rooted at `ancestorId`? (avoid showing a drop into own subtree)
  const isInSubtree = useCallback((ancestorId: number, maybeChild: number): boolean => {
    const root = index.get(ancestorId)
    if (!root) return false
    let found = false
    const walk = (n: UserNavigationTreeDto) => { if (n.id === maybeChild) found = true; n.children.forEach(walk) }
    root.children.forEach(walk)
    return found
  }, [index])

  // Mirror the indicator in a ref so onDragEnd reads the latest computed value even if
  // the pointer is released before React flushes the onDragMove state update (real race).
  const setInd = useCallback((v: Indicator | null) => { indicatorRef.current = v; setIndicator(v) }, [])

  const onDragStart = useCallback((e: DragStartEvent) => {
    const ae = e.activatorEvent as { clientY?: number }
    pointerStartY.current = ae?.clientY ?? 0
    setActiveId(Number(String(e.active.id).replace('item-', '')))
  }, [])

  // onDragMove (not onDragOver) so the indicator updates continuously as the pointer
  // moves *within* the same row — onDragOver only fires when the over droppable changes.
  const onDragMove = useCallback((e: DragMoveEvent) => {
    const { active, over } = e
    if (!over) { setInd(null); return }
    const activeNum = Number(String(active.id).replace('item-', ''))
    const overNum = Number(String(over.id).replace('row-', ''))
    // No-op when hovering itself or one of its own descendants.
    if (overNum === activeNum || isInSubtree(activeNum, overNum)) { setInd(null); return }

    const overNode = index.get(overNum)
    const overRect = over.rect
    if (!overNode) { setInd(null); return }

    const pointerY = pointerStartY.current + e.delta.y
    const rel = Math.min(1, Math.max(0, (pointerY - overRect.top) / overRect.height))

    let pos: DropPos
    if (overNode.type === 'CATEGORY') {
      // before (top) / into (middle, nest as child) / after (bottom)
      pos = rel < 0.30 ? 'before' : rel > 0.70 ? 'after' : 'into'
    } else {
      pos = rel < 0.5 ? 'before' : 'after'
    }
    setInd({ id: overNum, pos })
  }, [index, isInSubtree, setInd])

  const reset = useCallback(() => { setActiveId(null); setInd(null) }, [setInd])

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const ind = indicatorRef.current
    reset()
    if (!dnd || !ind) return
    const activeNum = Number(String(e.active.id).replace('item-', ''))
    const overNode = index.get(ind.id)
    if (!overNode) return

    if (ind.pos === 'into') {
      // Append as the last child of the hovered category.
      const childCount = overNode.children.filter(n => n.id !== activeNum).length
      dnd.onMove(activeNum, overNode.id, childCount)
      return
    }
    // before/after: reorder among the hovered row's siblings.
    const targetParent = overNode.parentId ?? 0
    const siblings = (index.has(targetParent) ? index.get(targetParent)!.children : nodes)
      .filter(n => n.id !== activeNum)
    const overIdx = siblings.findIndex(n => n.id === ind.id)
    if (overIdx < 0) { dnd.onMove(activeNum, targetParent, siblings.length); return }
    dnd.onMove(activeNum, targetParent, ind.pos === 'before' ? overIdx : overIdx + 1)
  }, [dnd, index, nodes, reset])

  const tree = (
    <div className="rounded-lg border border-border-subtle">
      {nodes.map(n => (
        <TreeRow key={n.id} node={n} depth={0} renderTrailing={renderTrailing} expandedByDefault={expandedByDefault} dnd={dnd} activeId={activeId} indicator={indicator} />
      ))}
    </div>
  )

  if (!dnd) return tree

  const activeNode = activeId != null ? index.get(activeId) : null
  const ActiveIcon = activeNode ? typeIcon(activeNode) : null
  return (
    <DndContext
      id="navigation-tree"
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      {tree}
      <DragOverlay dropAnimation={null}>
        {activeNode && ActiveIcon ? (
          <div className="flex items-center gap-2 rounded-lg border border-primary bg-surface-overlay px-3 py-2 text-sm shadow-lg">
            <GripVertical size={14} className="text-gray-400" />
            <ActiveIcon size={14} className="shrink-0 text-gray-400" />
            <span className={activeNode.type === 'CATEGORY' ? 'font-medium' : ''}>{activeNode.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `npm run test -- components/rbac/NavigationTree.test.tsx`
Expected: PASS (5 test)

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: nessun nuovo errore/warning

- [ ] **Step 6: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/NavigationTree.tsx \
        sources/microservices/web-construct/components/rbac/NavigationTree.test.tsx
git commit -m "feat(functionalities): add per-type icons to the navigation tree"
```

---

### Task 3: Rimozione della voce cliccabile "Genitore" dal dropdown

**Files:**
- Modify: `sources/microservices/web-construct/components/rbac/CustomSelect.tsx`
- Test: `sources/tests/e2e/test_functionalities.py`

**Interfaces:**
- Consumes: nessuna dipendenza da Task 1/2.
- Produces: nessuna nuova interfaccia pubblica; comportamento di `CustomSelect` invariato per chi non passa `placeholder` (il campo "Tipologia" nello stesso form, verificato senza `placeholder`, non è impattato).

- [ ] **Step 1: Scrivi il test e2e che fallisce (rosso)**

Aggiungi in `sources/tests/e2e/test_functionalities.py` (dopo `test_functionality_create_annulla_navigates_back`, alla fine del file):

```python
def test_genitore_dropdown_has_no_clickable_placeholder_row(logged_in_page, base_url):
    """The open Genitore dropdown must list only actual Category options, no clickable 'Genitore' row."""
    page = logged_in_page
    nav(page, f"{base_url}/functionalities/create")
    page.locator('[data-testid="select-genitore"]').click()
    menu = page.locator('.max-h-56.overflow-y-auto')
    expect(menu.get_by_role("button", name="Genitore", exact=True)).to_have_count(0)
    expect(menu.get_by_role("button", name="Admin", exact=True)).to_be_visible()
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py::test_genitore_dropdown_has_no_clickable_placeholder_row -v`
Expected: FAIL — la riga cliccabile "Genitore" esiste ancora nel menu aperto (count 1, non 0)

- [ ] **Step 3: Rimuovi il blocco della riga placeholder cliccabile**

In `components/rbac/CustomSelect.tsx`, sostituisci il blocco (righe 63-98) da `{/* ── Dropdown ── */}` alla chiusura del `div` esterno con:

```tsx
      {/* ── Dropdown ── */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-lg border border-border bg-surface-overlay shadow-lg overflow-hidden">
          <div className="max-h-56 overflow-y-auto py-1">
            {options.map(opt => {
              const selected = String(opt.value) === String(value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-testid={testId ? `${testId}-option-${opt.value}` : undefined}
                  onClick={() => { onChange(opt.value); close() }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-surface-hover
                    ${selected
                      ? 'font-medium text-foreground'
                      : 'text-foreground-secondary'}`}
                >
                  <span className="flex-1">{opt.label}</span>
                  {selected && <Check size={13} className="text-primary shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
```

(Il blocco condizionale `{placeholder && (...)}` che renderizzava il bottone "Genitore" cliccabile viene eliminato; `placeholder` resta usato solo alla riga del trigger chiuso, invariata.)

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py::test_genitore_dropdown_has_no_clickable_placeholder_row -v`
Expected: PASS

- [ ] **Step 5: Esegui l'intera suite e2e di functionalities**

Run: `uv run pytest sources/tests/e2e/test_functionalities.py -v`
Expected: PASS (tutti i test)

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: nessun nuovo errore/warning

- [ ] **Step 7: Commit**

```bash
git add sources/microservices/web-construct/components/rbac/CustomSelect.tsx \
        sources/tests/e2e/test_functionalities.py
git commit -m "fix(functionalities): remove clickable Genitore placeholder row from the dropdown"
```
