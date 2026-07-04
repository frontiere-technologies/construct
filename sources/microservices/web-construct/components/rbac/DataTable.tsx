'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { SlidersHorizontal, Columns3, MoreHorizontal, ChevronUp, ChevronDown, ChevronRight, X } from 'lucide-react'
import FilterDrawer from './FilterDrawer'

export interface Column<T> {
  key: string
  header: string
  sortable?: boolean
  render?: (row: T) => React.ReactNode
}

interface RowMenuItem { label: string; onClick: () => void; disabled?: boolean }

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  sort?: { field: string; direction: 'ASC' | 'DESC' }
  onSortChange?: (field: string) => void
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  filtersSlot?: React.ReactNode
  onOpenFilters?: () => void
  onApplyFilters?: () => void
  onResetFilters?: () => void
  activeFilterCount?: number
  onClearFilters?: () => void
  actionButton?: React.ReactNode
  rowMenu?: (row: T) => RowMenuItem[]
  onRowClick?: (row: T) => void
}

export default function DataTable<T>(props: DataTableProps<T>) {
  const { columns, rows, rowKey, sort, onSortChange, page, totalPages, onPageChange,
    filtersSlot, onOpenFilters, onApplyFilters, onResetFilters, activeFilterCount, onClearFilters, actionButton, rowMenu, onRowClick } = props
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [showCols, setShowCols] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [openMenu, setOpenMenu] = useState<string | number | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => {
    setOpenMenu(null)
    setMenuPos(null)
  }, [])

  const toggleMenu = (e: React.MouseEvent<HTMLButtonElement>, k: string | number) => {
    if (openMenu === k) {
      closeMenu()
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setOpenMenu(k)
  }

  useEffect(() => {
    if (openMenu === null) return
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      closeMenu()
    }
    document.addEventListener('mousedown', handleOutside)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
    }
  }, [openMenu, closeMenu])

  const visibleCols = columns.filter(c => !hidden.has(c.key))
  const toggleCol = (key: string) => {
    setHidden(prev => {
      const n = new Set(prev)
      if (n.has(key)) {
        n.delete(key)
      } else {
        n.add(key)
      }
      return n
    })
  }

  const pages: (number | '…')[] = []
  for (let i = 0; i < totalPages; i++) {
    if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 1) pages.push(i)
    else if (pages[pages.length - 1] !== '…') pages.push('…')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowCols(s => !s)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700">
              <Columns3 size={16} /> Colonne
            </button>
            {showCols && (
              <div className="absolute right-0 mt-1 z-20 w-48 p-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow">
                {columns.map(c => (
                  <label key={c.key} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleCol(c.key)} />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
          {filtersSlot && (
            <div className="relative">
              <button data-testid="open-filters" onClick={() => {
                if (!showFilters) onOpenFilters?.()
                setShowFilters(s => !s)
              }} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700">
                <SlidersHorizontal size={16} /> Filtri
                {!!activeFilterCount && (
                  <span data-testid="filters-badge" className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] leading-none">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {!!activeFilterCount && (
                <button data-testid="clear-filters" aria-label="Rimuovi filtri" onClick={onClearFilters} className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-red-100 hover:bg-red-200 text-red-500 z-10">
                  <X size={9} />
                </button>
              )}
            </div>
          )}
          {actionButton}
        </div>
      </div>

      {filtersSlot && (
        <FilterDrawer
          open={showFilters}
          onClose={() => setShowFilters(false)}
          onApply={() => { onApplyFilters?.(); setShowFilters(false) }}
          onReset={() => onResetFilters?.()}
        >
          {filtersSlot}
        </FilterDrawer>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-white">
            <tr>
              {visibleCols.map(c => (
                <th key={c.key} className="text-left font-medium px-4 py-3">
                  <button
                    disabled={!c.sortable}
                    onClick={() => c.sortable && onSortChange?.(c.key)}
                    className={`flex items-center gap-1 ${c.sortable ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    {c.header}
                    {c.sortable && sort?.field === c.key && (sort.direction === 'ASC' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                </th>
              ))}
              {rowMenu && <th className="w-10 px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const k = rowKey(row)
              return (
                <tr
                  key={k}
                  onClick={() => onRowClick?.(row)}
                  className={`border-t border-gray-100 dark:border-gray-800 ${onRowClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50' : ''}`}
                >
                  {visibleCols.map(c => (
                    <td key={c.key} className="px-4 py-3">{c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}</td>
                  ))}
                  {rowMenu && (
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button data-testid={`row-menu-${k}`} onClick={e => toggleMenu(e, k)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                        <MoreHorizontal size={16} />
                      </button>
                      {openMenu === k && menuPos && createPortal(
                        <div
                          ref={menuRef}
                          style={{ top: menuPos.top, right: menuPos.right }}
                          className="fixed z-50 w-40 p-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
                        >
                          {rowMenu(row).map(item => (
                            <button
                              key={item.label}
                              disabled={item.disabled}
                              onClick={() => { closeMenu(); item.onClick() }}
                              className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>,
                        document.body
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center gap-1">
        {pages.map((p, i) => p === '…'
          ? <span key={`e${i}`} className="px-2 text-gray-400">…</span>
          : <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`min-w-8 h-8 px-2 rounded-lg text-sm ${p === page ? 'bg-gray-900 text-white' : 'border border-gray-200 dark:border-gray-700'}`}
            >{p + 1}</button>
        )}
        <button
          onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
          className="min-w-8 h-8 px-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700 disabled:opacity-40"
        ><ChevronRight size={16} /></button>
      </div>
    </div>
  )
}
