'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, SlidersHorizontal, Search, X } from 'lucide-react'
import NavigationTree from '@/components/rbac/NavigationTree'
import FilterDrawer from '@/components/rbac/FilterDrawer'
import { PageContainer } from '@/components/PageContainer'
import { moveNavigationItem, deleteNavigationItem } from '@/lib/rbac/navigation-actions'
import { rowActions } from '@/lib/rbac/nav-row-actions'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

interface Props { tree: UserNavigationTreeDto[] }

export default function FunctionalitiesTreeClient({ tree }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [showFilters, setShowFilters] = useState(false)

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
    const actions = rowActions(node)
    if (!actions.add && !actions.edit && !actions.remove) return null
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        {actions.add && <button data-testid="nav-add" title="Aggiungi sotto-elemento" onClick={() => router.push(`/functionalities/create?parent=${node.id}`)} className="p-1 text-gray-400 hover:text-gray-700"><Plus size={15} /></button>}
        {actions.edit && <button data-testid="nav-edit" title="Modifica" onClick={() => router.push(`/functionalities/${node.id}/edit`)} className="p-1 text-gray-400 hover:text-gray-700"><Pencil size={15} /></button>}
        {actions.remove && <button data-testid="nav-delete" title="Elimina" onClick={async () => {
            if (confirm(`Eliminare "${node.name}" e tutti i suoi figli?`)) {
              try { await deleteNavigationItem(node.id); router.refresh() }
              catch (e) { alert(e instanceof Error ? e.message : 'Delete failed') }
            }
          }} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>}
      </div>
    )
  }

  return (
    <PageContainer title="Funzionalità">
      <div className="flex items-center justify-end gap-2">
        <div className="relative">
          <button
            data-testid="open-filters"
            onClick={() => {
              if (!showFilters) setSearchDraft(search)
              setShowFilters(s => !s)
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border"
          >
            <SlidersHorizontal size={16} /> Filtri
            {search.trim() !== '' && (
              <span data-testid="filters-badge" className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] leading-none">
                1
              </span>
            )}
          </button>
          {search.trim() !== '' && (
            <button data-testid="clear-filters" aria-label="Rimuovi filtri" onClick={clearFilters} className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-red-100 hover:bg-red-200 text-red-500 z-10">
              <X size={9} />
            </button>
          )}
        </div>
        <button onClick={() => router.push('/functionalities/create')} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Crea nuovo</button>
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
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface-overlay"
            />
          </div>
        </div>
      </FilterDrawer>
      <NavigationTree
        nodes={filterTree(tree)}
        renderTrailing={trailing}
        dnd={search.trim() ? undefined : { canDrag: n => !n.isImmutable, onMove }}
      />
    </PageContainer>
  )
}
