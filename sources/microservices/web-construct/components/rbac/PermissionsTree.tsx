'use client'

import React from 'react'
import NavigationTree from './NavigationTree'
import { applyToggle } from '@/lib/rbac/permission-tree'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

interface PermissionsTreeProps {
  trees: UserNavigationTreeDto[]
  map: Map<number, boolean>
  onChange: (next: Map<number, boolean>) => void
  editable: boolean
}

const Toggle: React.FC<{ on: boolean; disabled: boolean; onToggle: () => void }> = ({ on, disabled, onToggle }) => (
  <button
    data-testid="perm-toggle"
    role="switch"
    aria-checked={on}
    disabled={disabled}
    onClick={onToggle}
    // BTN-7: the on-state collapses to plain bg-primary, matching Sidebar.tsx's
    // theme toggle — the dark: pairing is unnecessary once the token itself
    // changes with the theme. The off-state track moves onto bg-input, the
    // token globals.css defines specifically for shadcn-sourced form chrome
    // (see the comment by --input in globals.css), rather than leaving the
    // Sidebar toggle's still-raw grey/grey-dark pairing in place.
    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${on ? 'bg-primary' : 'bg-input'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
  >
    <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-1'}`} />
  </button>
)

export default function PermissionsTree({ trees, map, onChange, editable }: PermissionsTreeProps) {
  return (
    <NavigationTree
      nodes={trees}
      renderTrailing={node => (
        <Toggle
          on={map.get(node.id) ?? false}
          disabled={!editable}
          onToggle={() => onChange(applyToggle(trees, map, node.id, !(map.get(node.id) ?? false)))}
        />
      )}
    />
  )
}
