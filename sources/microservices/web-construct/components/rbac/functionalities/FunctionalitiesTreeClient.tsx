'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, SlidersHorizontal, Search, X } from 'lucide-react'
import NavigationTree from '@/components/rbac/NavigationTree'
import FilterDrawer from '@/components/rbac/FilterDrawer'
import { moveNavigationItem, deleteNavigationItem } from '@/lib/rbac/navigation-actions'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

interface Props { rootTree: UserNavigationTreeDto[]; operationsTree: UserNavigationTreeDto[] }

export default function FunctionalitiesTreeClient({ rootTree, operationsTree }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'root' | 'operations'>('root')
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const activeTree = tab === 'root' ? rootTree : operationsTree

  const filterTree = (nodes: UserNavigationTreeDto[]): UserNavigationTreeDto[] => {
    if (!search.trim()) return nodes
    const q = search.toLowerCase()
    const walk = (ns: UserNavigationTreeDto[]): UserNavigationTreeDto[] =>
      ns.map(n => ({ ...n, children: walk(n.children ?? []) }))
       .filter(n => n.name.toLowerCase().includes(q) || (n.children?.length ?? 0) > 0)
    return walk(nodes)
  }

  const onMove = async (id: number, targetParentId: number, orderPosition: number) => {
    try { await moveNavigationItem(id, { targetParentId, orderPosition }); router.refresh() }
    catch (e) { alert(e instanceof Error ? e.message : 'Move failed') }
  }

  const clearFilters = () => { setSearchDraft(''); setSearch('') }

  const trailing = (node: UserNavigationTreeDto) => {
    if (node.isImmutable) return null
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <button data-testid="nav-add" title="Aggiungi sotto-elemento" onClick={() => router.push(`/functionalities/create?root=${tab}&parent=${node.id}`)} className="p-1 text-gray-400 hover:text-gray-700"><Plus size={15} /></button>
        <button data-testid="nav-edit" title="Modifica" onClick={() => router.push(`/functionalities/${node.id}/edit`)} className="p-1 text-gray-400 hover:text-gray-700"><Pencil size={15} /></button>
        <button data-testid="nav-delete" title="Elimina" onClick={async () => {
            if (confirm(`Eliminare "${node.name}" e tutti i suoi figli?`)) {
              try { await deleteNavigationItem(node.id); router.refresh() }
              catch (e) { alert(e instanceof Error ? e.message : 'Delete failed') }
            }
          }} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Funzionalità</h1>
      <div className="flex items-center justify-end gap-2 mb-4">
        <button
          data-testid="open-filters"
          onClick={() => {
            if (!showFilters) setSearchDraft(search)
            setShowFilters(s => !s)
          }}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700"
        >
          <SlidersHorizontal size={16} /> Filtri
          {search.trim() !== '' && (
            <span data-testid="filters-badge" className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] leading-none">
              1
            </span>
          )}
        </button>
        {search.trim() !== '' && (
          <button data-testid="clear-filters" aria-label="Rimuovi filtri" onClick={clearFilters} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X size={14} />
          </button>
        )}
        <button onClick={() => router.push(`/functionalities/create?root=${tab}`)} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Crea nuovo</button>
      </div>
      <FilterDrawer
        open={showFilters}
        onClose={() => setShowFilters(false)}
        onApply={() => { setSearch(searchDraft); setShowFilters(false) }}
        onReset={clearFilters}
      >
        <div className="space-y-1">
          <label className="text-sm font-medium block">Cerca</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              data-testid="filter-search"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              placeholder="Cerca"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
            />
          </div>
        </div>
      </FilterDrawer>
      <div className="flex gap-6 border-b border-gray-200 dark:border-gray-800 mb-4">
        {(['root', 'operations'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setSearch(''); setSearchDraft('') }}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-gray-900 text-gray-900 dark:text-white dark:border-white' : 'border-transparent text-gray-500'}`}>
            {t === 'root' ? 'Tutto' : 'Operazioni'}
          </button>
        ))}
      </div>
      <NavigationTree
        nodes={filterTree(activeTree)}
        renderTrailing={trailing}
        dnd={search.trim() ? undefined : { canDrag: n => !n.isImmutable, onMove }}
      />
    </div>
  )
}
