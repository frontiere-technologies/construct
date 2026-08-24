'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '@/context/I18nContext'

interface RoleOption { id: number; name: string }

interface Props {
  options: RoleOption[]
  selected: Set<number>
  onToggle: (id: number) => void
  lockedId?: number
  lockedLabel?: string
}

export default function RoleMultiSelect({ options, selected, onToggle, lockedId, lockedLabel }: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')

  const selectedRoles = options.filter(o => selected.has(o.id))
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter(o => o.name.toLowerCase().includes(q)) : options
  }, [options, query])

  return (
    <div>
      <div
        data-testid="selected-roles-scroll-area"
        className="max-h-28 overflow-x-auto overflow-y-auto rounded-lg border border-border px-2 py-1.5 focus-within:border-gray-400 dark:focus-within:border-gray-500"
      >
        <div className="flex min-w-full flex-wrap items-center gap-1.5">
          {selectedRoles.map(r => (
            <span key={r.id} className="flex shrink-0 whitespace-nowrap items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm">
              {r.name}
              {r.id !== lockedId && (
                <button type="button" aria-label={t('users.roles.remove_label', { name: r.name })} onClick={() => onToggle(r.id)}>
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={selectedRoles.length === 0 ? t('users.roles.search_placeholder') : ''}
            className="flex-1 min-w-24 bg-transparent text-sm outline-none py-0.5"
          />
        </div>
      </div>

      <div className="mt-2 space-y-0.5 max-h-56 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="px-2 py-2 text-sm text-gray-400">{t('users.roles.no_results')}</p>
        )}
        {filtered.map(r => {
          const isSelected = selected.has(r.id)
          const locked = r.id === lockedId
          return (
            <label
              key={r.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent ${locked ? 'opacity-60' : 'cursor-pointer'}`}
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
