'use client'

import React, { useState, useCallback, useRef } from 'react'
import { ChevronDown, ChevronRight, GripVertical, FolderTree, Code, Globe, Link as LinkIcon, Circle, type LucideIcon } from 'lucide-react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, pointerWithin,
  useDraggable, useDroppable, type DragStartEvent, type DragMoveEvent, type DragEndEvent,
  type CollisionDetection, type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useI18n } from '@/context/I18nContext'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'
import { nextKeyboardCoordinates, type KeyboardDragRow } from './navigation-tree-keyboard-drag'

type DropPos = 'before' | 'after' | 'into'
interface Indicator { id: number; pos: DropPos }

interface DndConfig {
  canDrag: (node: UserNavigationTreeDto) => boolean
  onMove: (id: number, targetParentId: number | null, orderPosition: number) => void
}
interface NavigationTreeProps {
  nodes: UserNavigationTreeDto[]
  renderTrailing?: (node: UserNavigationTreeDto) => React.ReactNode
  /** Qualcosa da mostrare subito dopo il nome, non in coda alla riga (per esempio «vuota»). */
  renderNameSuffix?: (node: UserNavigationTreeDto) => React.ReactNode
  expandedByDefault?: boolean
  dnd?: DndConfig
}

interface RowProps {
  node: UserNavigationTreeDto
  depth: number
  renderTrailing?: (node: UserNavigationTreeDto) => React.ReactNode
  renderNameSuffix?: (node: UserNavigationTreeDto) => React.ReactNode
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

const TreeRow: React.FC<RowProps> = ({ node, depth, renderTrailing, renderNameSuffix, expandedByDefault, dnd, activeId, indicator }) => {
  const { t } = useI18n()
  const isCategory = node.type === 'CATEGORY'
  const hasChildren = node.children.length > 0
  const [open, setOpen] = useState(expandedByDefault)
  const canDrag = dnd ? dnd.canDrag(node) : false
  const nameSuffix = renderNameSuffix?.(node)

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
          // Kept as a native <button>, not the Button primitive — but not
          // for the reason this comment used to give. Commit 3e1eda9 moved
          // ButtonBase onto ComponentPropsWithRef<'button'>, so `Button` does
          // accept and forward a ref now, on both the host and the asChild
          // branch (see button.types.tsx's withRef/withRefAsChild). The real
          // reason to keep this native: dnd-kit's setActivatorNodeRef,
          // dragListeners and dragAttributes are wired to a plain DOM button
          // today, and swapping the drag handle onto the primitive is a
          // drag & drop behaviour change that wants its own E2E coverage,
          // not a drive-by edit here.
          <button
            // eslint-disable-next-line react-hooks/refs -- ref e listener di dnd-kit sul nodo nativo, per il motivo nel commento qui sopra
            ref={dragActivatorRef}
            // eslint-disable-next-line react-hooks/refs -- ref e listener di dnd-kit sul nodo nativo, per il motivo nel commento qui sopra
            {...dragListeners}
            // eslint-disable-next-line react-hooks/refs -- ref e listener di dnd-kit sul nodo nativo, per il motivo nel commento qui sopra
            {...dragAttributes}
            data-testid="drag-handle"
            disabled={!canDrag}
            aria-label={t('functionalities.tree.drag_handle')}
            // Colour classes come from the `ghost` variant's own recipe
            // (buttonVariants) instead of being hand-copied, so this native
            // button and every `<Button variant="ghost">` in the app stay in
            // sync by construction. `p-0.5` overrides the variant's default
            // `icon` padding (twMerge — see lib/utils.ts — makes the later
            // class win); `touch-none` and the grab cursor are specific to
            // being a drag handle and aren't part of any variant.
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'p-0.5 touch-none', canDrag && 'cursor-grab active:cursor-grabbing')}
          >
            <GripVertical size={14} />
          </button>
        )}
        {isCategory && hasChildren ? (
          <Button
            variant="ghost" size="icon"
            data-testid="tree-toggle"
            aria-label={t('common.tree.toggle_row')}
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </Button>
        ) : (
          <span className="w-5" />
        )}
        {React.createElement(typeIcon(node), { size: 14, className: 'shrink-0 text-muted-foreground' })}
        {/* `min-w-0` prima di `truncate`: il nome del nodo lo scrive chi traduce,
            e un figlio flex con `min-width: auto` si rifiuta di stringersi sotto
            il proprio contenuto -- allargherebbe la riga e spingerebbe fuori le
            azioni in coda invece di andare in puntini. */}
        {nameSuffix == null ? (
          <span className={`flex-1 min-w-0 truncate text-sm ${isCategory ? 'font-medium' : ''}`}>
            {node.name}
          </span>
        ) : (
          // Con un suffisso il nome resta quello che va in puntini, e il suffisso gli sta accanto
          // invece di finire in coda alla riga: `flex-1` passa al contenitore dei due.
          <span className="flex flex-1 min-w-0 items-center gap-2">
            <span className={`min-w-0 truncate text-sm ${isCategory ? 'font-medium' : ''}`}>
              {node.name}
            </span>
            {nameSuffix}
          </span>
        )}
        {renderTrailing?.(node)}
      </div>
      {hasChildren && open && node.children.map(c => (
        <TreeRow key={c.id} node={c} depth={depth + 1} renderTrailing={renderTrailing} renderNameSuffix={renderNameSuffix} expandedByDefault={expandedByDefault} dnd={dnd} activeId={activeId} indicator={indicator} />
      ))}
    </div>
  )
}

export default function NavigationTree({ nodes, renderTrailing, renderNameSuffix, expandedByDefault = true, dnd }: NavigationTreeProps) {
  const { t } = useI18n()
  const [activeId, setActiveId] = useState<number | null>(null)
  // Se una pressione precedente ha gia' collocato il puntatore virtuale. Non e'
  // deducibile dalla sua posizione: nasce a (0,0), che e' dentro la prima riga
  // ogni volta che l'albero comincia in cima alla finestra.
  const keyboardPositioned = useRef(false)
  const isKeyboardDrag = useRef(false)
  // L'ultima posizione annunciata, per non ripetere la stessa frase a ogni pixel.
  const lastAnnounced = useRef<string | null>(null)
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

  /**
   * A11Y-3. Il `KeyboardSensor` parte da coordinate (0,0) e vi somma quelle che
   * questo getter restituisce, e `pointerStartY` resta 0 su un trascinamento da
   * tastiera perche' un evento di tastiera non ha `clientY`. Restituendo
   * coordinate *assolute* si guida quindi un puntatore virtuale che
   * `handleDragMove` legge esattamente come quello vero: mouse e tastiera
   * condividono una sola definizione di prima/dopo/dentro, invece di averne due
   * che col tempo divergono.
   */
  const keyboardCoordinateGetter = useCallback<KeyboardCoordinateGetter>((event, { currentCoordinates, context }) => {
    const activeNum = Number(String(context.active?.id ?? '').replace('item-', ''))
    const rows: KeyboardDragRow[] = [...context.droppableRects.entries()]
      .map(([id, rect]) => ({ id: Number(String(id).replace('row-', '')), rect }))
      // La riga trascinata e i suoi discendenti non sono posizioni da cui passare.
      .filter(r => r.id !== activeNum && !isInSubtree(activeNum, r.id))
      .sort((a, b) => a.rect.top - b.rect.top)
      .map(r => ({ id: r.id, top: r.rect.top, height: r.rect.height, isCategory: index.get(r.id)?.type === 'CATEGORY' }))

    const initial = context.active?.rect.current.initial
    const anchorY = initial ? initial.top + initial.height / 2 : 0

    const next = nextKeyboardCoordinates(event.key, currentCoordinates, rows, {
      positioned: keyboardPositioned.current,
      anchorY,
    })
    if (!next) return currentCoordinates
    keyboardPositioned.current = true
    return next
  }, [index, isInSubtree])

  /**
   * `pointerWithin` ha bisogno di coordinate del puntatore, e da tastiera dnd-kit
   * non ne produce di utilizzabili: le sue `pointerCoordinates` valgono
   * `(0,0) + traslazione`, cioe' uno scostamento, non una posizione sullo
   * schermo. Restituirebbe sempre l'insieme vuoto. La riga sorvolata si trova
   * invece sul rettangolo tradotto, il cui bordo alto e' esattamente la
   * posizione che il getter ha chiesto.
   */
  const collisionDetection = useCallback<CollisionDetection>(args => {
    if (!isKeyboardDrag.current) return pointerWithin(args)
    const y = args.collisionRect.top
    for (const [id, rect] of args.droppableRects) {
      if (y >= rect.top && y < rect.top + rect.height) return [{ id }]
    }
    return []
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinateGetter }),
  )

  // Mirror the indicator in a ref so onDragEnd reads the latest computed value even if
  // the pointer is released before React flushes the onDragMove state update (real race).
  const setInd = useCallback((v: Indicator | null) => { indicatorRef.current = v; setIndicator(v) }, [])

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const ae = e.activatorEvent as { clientY?: number }
    // Un evento di tastiera non ha `clientY`, e questo zero non e' un ripiego:
    // e' cio' che rende le coordinate assolute del getter da tastiera leggibili
    // qui sotto come `pointerStartY + delta`, esattamente come quelle del mouse.
    pointerStartY.current = ae?.clientY ?? 0
    isKeyboardDrag.current = ae?.clientY === undefined
    keyboardPositioned.current = false
    setActiveId(Number(String(e.active.id).replace('item-', '')))
  }, [])

  // Col mouse serve onDragMove: onDragOver scatta solo quando cambia la riga
  // sorvolata, mentre la posizione cambia anche muovendosi *dentro* la stessa
  // riga. Da tastiera serve l'opposto — dnd-kit aggiorna la traslazione e
  // ricalcola le collisioni, ma non emette onDragMove: misurato, non dedotto.
  // Entrambi puntano qui, e chiamarlo due volte non costa niente perche' ricalcola
  // lo stesso indicatore dagli stessi dati.
  const handleDragMove = useCallback((e: DragMoveEvent) => {
    const { active, over } = e
    if (!over) { setInd(null); return }
    const activeNum = Number(String(active.id).replace('item-', ''))
    const overNum = Number(String(over.id).replace('row-', ''))
    // No-op when hovering itself or one of its own descendants.
    if (overNum === activeNum || isInSubtree(activeNum, overNum)) { setInd(null); return }

    const overNode = index.get(overNum)
    const overRect = over.rect
    if (!overNode) { setInd(null); return }

    // Col mouse la Y e' quella del puntatore. Da tastiera un puntatore non c'e',
    // e nemmeno un accumulo utilizzabile: il KeyboardSensor traduce di
    // `ritorno - riferimento`, quindi cio' che il getter chiede si legge
    // sull'unico posto dove arriva intatto — il bordo alto del rettangolo
    // tradotto dell'elemento trascinato.
    const pointerY = isKeyboardDrag.current
      ? (active.rect.current.translated?.top ?? 0)
      : pointerStartY.current + e.delta.y
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

  const reset = useCallback(() => {
    setActiveId(null); setInd(null)
    keyboardPositioned.current = false
    isKeyboardDrag.current = false
  }, [setInd])

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
    // before/after: reorder among the hovered row's siblings. A null parentId IS the menu
    // root (Task 5) — not the old ROOT_ID sentinel — so it's passed through as-is, and the
    // siblings are the top-level `nodes` rather than some indexed item's children.
    const targetParent = overNode.parentId
    const siblings = (targetParent !== null && index.has(targetParent) ? index.get(targetParent)!.children : nodes)
      .filter(n => n.id !== activeNum)
    const overIdx = siblings.findIndex(n => n.id === ind.id)
    if (overIdx < 0) { dnd.onMove(activeNum, targetParent, siblings.length); return }
    dnd.onMove(activeNum, targetParent, ind.pos === 'before' ? overIdx : overIdx + 1)
  }, [dnd, index, nodes, reset])

  const tree = (
    <div className="rounded-lg border border-border-subtle">
      {nodes.map(n => (
        <TreeRow key={n.id} node={n} depth={0} renderTrailing={renderTrailing} renderNameSuffix={renderNameSuffix} expandedByDefault={expandedByDefault} dnd={dnd} activeId={activeId} indicator={indicator} />
      ))}
    </div>
  )

  if (!dnd) return tree

  const activeNode = activeId != null ? index.get(activeId) : null
  const nameOf = (id: number | null | undefined) => (id != null ? index.get(id)?.name : undefined) ?? ''
  const draggedName = (id: string | number) => nameOf(Number(String(id).replace('item-', '')))

  const announceDropPosition = ({ active }: { active: { id: string | number } }) => {
    const ind = indicatorRef.current
    const key = ind ? `${ind.id}:${ind.pos}` : null
    if (key === lastAnnounced.current) return undefined
    lastAnnounced.current = key
    if (!ind) return undefined
    return t(`functionalities.tree.dnd.over_${ind.pos}`, {
      name: draggedName(active.id), target: nameOf(ind.id),
    })
  }

  return (
    <DndContext
      id="navigation-tree"
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{
        screenReaderInstructions: { draggable: t('functionalities.tree.dnd.instructions') },
        announcements: {
          onDragStart: ({ active }) => t('functionalities.tree.dnd.lifted', { name: draggedName(active.id) }),
          // Col mouse questo scatta a ogni pixel, quindi si annuncia solo quando la
          // posizione cambia davvero: una zona viva che ripete se stessa e' rumore,
          // e il rumore e' il modo piu' rapido per far spegnere un lettore di schermo.
          // Le due sorgenti si dividono il lavoro esattamente come i due gestori
          // qui sopra: col mouse arriva onDragMove, da tastiera onDragOver. Puntano
          // alla stessa funzione, e il confronto con l'ultima frase detta impedisce
          // di ripeterla — una zona viva che si ripete a ogni pixel e' rumore, e il
          // rumore e' il modo piu' rapido per far spegnere un lettore di schermo.
          onDragOver: announceDropPosition,
          onDragMove: announceDropPosition,
          onDragEnd: ({ active }) => {
            const moved = indicatorRef.current != null
            lastAnnounced.current = null
            return t(moved ? 'functionalities.tree.dnd.dropped' : 'functionalities.tree.dnd.cancelled',
              { name: draggedName(active.id) })
          },
          onDragCancel: ({ active }) => {
            lastAnnounced.current = null
            return t('functionalities.tree.dnd.cancelled', { name: draggedName(active.id) })
          },
        },
      }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragMove}

      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      {tree}
      <DragOverlay dropAnimation={null}>
        {activeNode ? (
          <div className="flex items-center gap-2 rounded-lg border border-primary bg-popover px-3 py-2 text-sm shadow-lg">
            <GripVertical size={14} className="text-muted-foreground" />
            {React.createElement(typeIcon(activeNode), { size: 14, className: 'shrink-0 text-muted-foreground' })}
            <span className={activeNode.type === 'CATEGORY' ? 'font-medium' : ''}>{activeNode.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
