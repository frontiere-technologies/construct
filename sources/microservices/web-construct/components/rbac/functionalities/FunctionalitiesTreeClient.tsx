'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import NavigationTree from '@/components/rbac/NavigationTree'
import { moveNavigationItem, deleteNavigationItem } from '@/lib/rbac/navigation-actions'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

interface Props { rootTree: UserNavigationTreeDto[]; operationsTree: UserNavigationTreeDto[] }

export default function FunctionalitiesTreeClient({ rootTree, operationsTree }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'root' | 'operations'>('root')
  const [search, setSearch] = useState('')

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

  const trailing = (node: UserNavigationTreeDto) => {
    if (node.isImmutable) return null
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        {node.type === 'CATEGORY' && (
          <button data-testid="nav-add" title="Crea figlio" onClick={() => router.push(`/functionalities/create?root=${tab}&parent=${node.id}`)} className="p-1 text-gray-400 hover:text-gray-700"><Plus size={15} /></button>
        )}
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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Funzionalità</h1>
        <button onClick={() => router.push(`/functionalities/create?root=${tab}`)} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white">Crea nuovo</button>
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca"
        className="w-full max-w-sm mb-4 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent" />
      <div className="flex gap-6 border-b border-gray-200 dark:border-gray-800 mb-4">
        {(['root', 'operations'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-gray-900 text-gray-900 dark:text-white dark:border-white' : 'border-transparent text-gray-500'}`}>
            {t === 'root' ? 'Tutto' : 'Operazioni'}
          </button>
        ))}
      </div>
      <NavigationTree
        nodes={filterTree(activeTree)}
        renderTrailing={trailing}
        dnd={{ canDrag: n => !n.isImmutable, onMove }}
      />
    </div>
  )
}
