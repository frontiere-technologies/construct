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

  // Extract dnd refs/handlers before JSX to satisfy react-hooks/refs lint rule
  const dragActivatorRef = drag.setActivatorNodeRef
  const dragListeners = drag.listeners
  const dragAttributes = drag.attributes
  const beforeDropRef = beforeDrop.setNodeRef
  const intoDropRef = intoDrop.setNodeRef

  return (
    <div>
      <div
        ref={dnd ? beforeDropRef : undefined}
        className={`flex items-center gap-2 py-2.5 px-3 border-b border-gray-100 dark:border-gray-800 ${beforeDrop.isOver ? 'border-t-2 border-t-primary' : ''} ${intoDrop.isOver ? 'bg-primary/10' : ''}`}
        style={{ paddingLeft: 12 + depth * 24 }}
      >
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
          ref={dnd && isCategory ? intoDropRef : undefined}
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
