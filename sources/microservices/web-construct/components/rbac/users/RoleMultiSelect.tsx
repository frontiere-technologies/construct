'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'

interface RoleOption { id: number; name: string }

interface Props {
  options: RoleOption[]
  selected: Set<number>
  onToggle: (id: number) => void
  lockedId?: number
  lockedLabel?: string
}

export default function RoleMultiSelect({ options, selected, onToggle, lockedId, lockedLabel }: Props) {
  const [query, setQuery] = useState('')

  const selectedRoles = options.filter(o => selected.has(o.id))
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter(o => o.name.toLowerCase().includes(q)) : options
  }, [options, query])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 focus-within:border-gray-400 dark:focus-within:border-gray-500">
        {selectedRoles.map(r => (
          <span key={r.id} className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">
            {r.name}
            {r.id !== lockedId && (
              <button type="button" aria-label={`Rimuovi ${r.name}`} onClick={() => onToggle(r.id)}>
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={selectedRoles.length === 0 ? 'Cerca un ruolo…' : ''}
          className="flex-1 min-w-24 bg-transparent text-sm outline-none py-0.5"
        />
      </div>

      <div className="mt-2 space-y-0.5 max-h-56 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="px-2 py-2 text-sm text-gray-400">Nessun ruolo trovato</p>
        )}
        {filtered.map(r => {
          const isSelected = selected.has(r.id)
          const locked = r.id === lockedId
          return (
            <label
              key={r.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${locked ? 'opacity-60' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                data-testid={`role-checkbox-${r.id}`}
                checked={isSelected}
                disabled={locked}
                onChange={() => onToggle(r.id)}
              />
              <span className={isSelected ? 'font-semibold' : ''}>
                {r.name}{locked && lockedLabel ? ` (${lockedLabel})` : ''}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
