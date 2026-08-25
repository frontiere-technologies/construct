'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, SlidersHorizontal, Search, X } from 'lucide-react'
import NavigationTree from '@/components/rbac/NavigationTree'
import FilterDrawer from '@/components/rbac/FilterDrawer'
import { PageContainer } from '@/components/PageContainer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { moveNavigationItem, deleteNavigationItem } from '@/lib/rbac/navigation-actions'
import { rowActions } from '@/lib/rbac/nav-row-actions'
import { useI18n } from '@/context/I18nContext'
import type { UserNavigationTreeDto } from '@/lib/rbac/types'

interface Props { tree: UserNavigationTreeDto[] }

export default function FunctionalitiesTreeClient({ tree }: Props) {
  const { t } = useI18n()
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
    catch (e) { alert(e instanceof Error ? e.message : t('functionalities.tree.move_failed')) }
  }

  const clearFilters = () => { setSearchDraft(''); setSearch('') }

  const trailing = (node: UserNavigationTreeDto) => {
    const actions = rowActions(node)
    if (!actions.add && !actions.edit && !actions.remove) return null
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        {actions.add && (
          <Button
            variant="ghost" size="icon"
            data-testid="nav-add" title={t('functionalities.tree.add_child')} aria-label={t('functionalities.tree.add_child')}
            onClick={() => router.push(`/functionalities/create?parent=${node.id}`)}
          ><Plus size={15} /></Button>
        )}
        {actions.edit && (
          <Button
            variant="ghost" size="icon"
            data-testid="nav-edit" title={t('common.actions.edit')} aria-label={t('common.actions.edit')}
            onClick={() => router.push(`/functionalities/${node.id}/edit`)}
          ><Pencil size={15} /></Button>
        )}
        {actions.remove && (
          <Button
            variant="ghost" size="icon"
            className="enabled:hover:text-destructive"
            data-testid="nav-delete" title={t('common.actions.delete')} aria-label={t('common.actions.delete')}
            onClick={async () => {
              if (confirm(t('functionalities.tree.confirm_delete', { name: node.name }))) {
                try { await deleteNavigationItem(node.id); router.refresh() }
                catch (e) { alert(e instanceof Error ? e.message : t('functionalities.tree.delete_failed')) }
              }
            }}
          ><Trash2 size={15} /></Button>
        )}
      </div>
    )
  }

  return (
    <PageContainer title={t('functionalities.list.title')}>
      <div className="flex items-center justify-end gap-2">
        <div className="relative">
          <Button
            variant="outline" size="sm"
            data-testid="open-filters"
            onClick={() => {
              if (!showFilters) setSearchDraft(search)
              setShowFilters(s => !s)
            }}
          >
            <SlidersHorizontal size={16} /> {t('common.labels.filters')}
            {search.trim() !== '' && (
              <span data-testid="filters-badge" className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[11px] leading-none">
                1
              </span>
            )}
          </Button>
          {search.trim() !== '' && (
            <button data-testid="clear-filters" aria-label={t('functionalities.list.clear_filters_label')} onClick={clearFilters} className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-destructive-muted enabled:hover:bg-destructive enabled:hover:text-destructive-foreground text-destructive-muted-foreground z-10">
              <X size={9} />
            </button>
          )}
        </div>
        <Button size="sm" onClick={() => router.push('/functionalities/create')}>{t('functionalities.actions.create')}</Button>
      </div>
      <FilterDrawer
        open={showFilters}
        onClose={() => setShowFilters(false)}
        onApply={() => { setSearch(searchDraft); setShowFilters(false) }}
        onReset={clearFilters}
      >
        <div className="space-y-1">
          <label className="text-sm font-medium block">{t('common.actions.search')}</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="filter-search"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              placeholder={t('common.actions.search')}
              className="pl-9 pr-3"
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
