'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

interface NavigationTreeProps {
  nodes: UserNavigationTreeDto[]
  renderTrailing?: (node: UserNavigationTreeDto) => React.ReactNode
  expandedByDefault?: boolean
}

interface RowProps {
  node: UserNavigationTreeDto
  depth: number
  renderTrailing?: (node: UserNavigationTreeDto) => React.ReactNode
  expandedByDefault: boolean
}

const TreeRow: React.FC<RowProps> = ({ node, depth, renderTrailing, expandedByDefault }) => {
  const isCategory = node.type === 'CATEGORY'
  const hasChildren = node.children.length > 0
  const [open, setOpen] = useState(expandedByDefault)

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2.5 px-3 border-b border-gray-100 dark:border-gray-800"
        style={{ paddingLeft: 12 + depth * 24 }}
      >
        {isCategory && hasChildren ? (
          <button data-testid="tree-toggle" onClick={() => setOpen(o => !o)} className="p-0.5 text-gray-500">
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <span className={`flex-1 text-sm ${isCategory ? 'font-medium' : ''}`}>{node.name}</span>
        {renderTrailing?.(node)}
      </div>
      {hasChildren && open && node.children.map(c => (
        <TreeRow key={c.id} node={c} depth={depth + 1} renderTrailing={renderTrailing} expandedByDefault={expandedByDefault} />
      ))}
    </div>
  )
}

export default function NavigationTree({ nodes, renderTrailing, expandedByDefault = true }: NavigationTreeProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800">
      {nodes.map(n => (
        <TreeRow key={n.id} node={n} depth={0} renderTrailing={renderTrailing} expandedByDefault={expandedByDefault} />
      ))}
    </div>
  )
}
