'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import type { ICellRendererParams } from 'ag-grid-community'

export interface RowMenuItem { label: string; onClick: () => void; disabled?: boolean }

export interface GridRowActionsMenuParams<T> extends ICellRendererParams<T> {
  getItems: (data: T) => RowMenuItem[]
}

export default function GridRowActionsMenu<T>(params: GridRowActionsMenuParams<T>) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
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
    <div className="flex justify-end" onClick={e => e.stopPropagation()}>
      <button
        data-testid={`row-menu-${rowId}`}
        onClick={e => {
          if (open) { close(); return }
          const rect = e.currentTarget.getBoundingClientRect()
          setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
          setOpen(true)
        }}
        className="p-1 rounded hover:bg-surface-hover"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-40 p-1 rounded-lg border border-border bg-surface-overlay shadow-lg">
          {items.map(item => (
            <button
              key={item.label}
              disabled={item.disabled}
              onClick={() => { close(); item.onClick() }}
              className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
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
