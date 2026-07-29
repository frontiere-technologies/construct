'use client'

import { useState } from 'react'
import { Columns3 } from 'lucide-react'
import type { GridApi } from 'ag-grid-community'
import { useI18n } from '@/context/I18nContext'

export interface ToggleableColumn { colId: string; label: string }

export default function ColumnVisibilityToggle<T>(
  { gridApi, columns }: { gridApi: GridApi<T> | null; columns: ToggleableColumn[] },
) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const toggle = (colId: string) => {
    if (!gridApi) return
    const willHide = !hidden.has(colId)
    const next = new Set(hidden)
    if (willHide) next.add(colId); else next.delete(colId)
    setHidden(next)
    gridApi.setColumnsVisible([colId], !willHide)
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border">
        <Columns3 size={16} /> {t('common.labels.columns')}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-20 w-48 p-2 rounded-lg border border-border bg-surface-overlay shadow">
          {columns.map(c => (
            <label key={c.colId} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
              <input type="checkbox" checked={!hidden.has(c.colId)} onChange={() => toggle(c.colId)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
