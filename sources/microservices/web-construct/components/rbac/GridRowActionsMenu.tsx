'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'

export interface RowMenuItem { label: string; onClick: () => void; disabled?: boolean }

export interface GridRowActionsMenuParams<T> extends ICellRendererParams<T> {
  getItems: (data: T) => RowMenuItem[]
}

/**
 * The row-actions column, shared by every grid: always the first column and always
 * pinned left, so it stays visible while the other columns scroll horizontally.
 * `lockPinned` + `lockPosition` keep it there even if a user drags columns around.
 */
export function actionsColumnDef<T>(getItems: (data: T) => RowMenuItem[], headerTooltip?: string): ColDef<T> {
  return {
    colId: 'actions',
    headerName: '',
    headerTooltip,
    pinned: 'left',
    lockPinned: true,
    lockPosition: 'left',
    suppressMovable: true,
    sortable: false,
    filter: false,
    resizable: false,
    width: 56,
    cellRenderer: GridRowActionsMenu,
    cellRendererParams: { getItems },
  }
}

export default function GridRowActionsMenu<T>(params: GridRowActionsMenuParams<T>) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => { setOpen(false); setPos(null) }, [])

  useEffect(() => {
    if (!open) return
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      close()
    }
    document.addEventListener('mousedown', handleOutside)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  if (!params.data) return null
  const rowId = params.node.id ?? ''
  const items = params.getItems(params.data)

  return (
    // `data-grid-no-row-click` is read by DataGrid's onRowClicked wrapper (via .closest())
    // to exclude this actions column from row-click navigation. React's stopPropagation()
    // below only stops the React synthetic event chain — it doesn't stop AG Grid's own
    // native row-click listener, which is attached directly to the DOM outside React.
    <div className="flex h-full items-center justify-center" data-grid-no-row-click onClick={e => e.stopPropagation()}>
      <button
        data-testid={`row-menu-${rowId}`}
        onClick={e => {
          if (open) { close(); return }
          const rect = e.currentTarget.getBoundingClientRect()
          // Opens rightwards from the button (the actions column is pinned to the
          // left edge, so the space is always on that side).
          setPos({ top: rect.bottom + 4, left: rect.left })
          setOpen(true)
        }}
        className="p-1 rounded hover:bg-surface-hover"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} style={{ top: pos.top, left: pos.left }} className="fixed z-50 w-40 p-1 rounded-lg border border-border bg-surface-overlay shadow-lg">
          {items.map(item => (
            <button
              key={item.label}
              disabled={item.disabled}
              onClick={() => { close(); item.onClick() }}
              className="block w-full text-left px-3 py-1.5 text-sm rounded enabled:hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
