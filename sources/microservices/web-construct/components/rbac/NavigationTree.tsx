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
        {React.createElement(typeIcon(node), { size: 14, className: 'shrink-0 text-gray-400' })}
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
        {activeNode ? (
          <div className="flex items-center gap-2 rounded-lg border border-primary bg-surface-overlay px-3 py-2 text-sm shadow-lg">
            <GripVertical size={14} className="text-gray-400" />
            {React.createElement(typeIcon(activeNode), { size: 14, className: 'shrink-0 text-gray-400' })}
            <span className={activeNode.type === 'CATEGORY' ? 'font-medium' : ''}>{activeNode.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
