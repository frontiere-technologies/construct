'use client'

import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import type { ColDef, FilterChangedEvent, GridApi, GridReadyEvent, SortChangedEvent } from 'ag-grid-community'
import DataGrid from '@/components/ui/DataGrid'
import GridToolbar from '@/components/ui/GridToolbar'
import { DATE_FILTER, NUMBER_FILTER, TEXT_FILTER } from '@/components/ui/gridColumnFilters'
import { resetGridFilters } from '@/components/ui/grid-reset'
import { useGridUrlSync } from '@/components/ui/grid-url-sync'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { actionsColumnDef } from '@/components/rbac/GridRowActionsMenu'
import EnumSelectFilter from '@/components/rbac/filters/EnumSelectFilter'
import { useI18n } from '@/context/I18nContext'
import { deleteLanguage, setDefaultLanguage, setLanguageActive } from '@/lib/i18n/language-actions'
import { Button } from '@/components/ui/button'
import {
  languagesFilterModelToSearchParams, languagesUrlParamsToFilterModel, languagesUrlParamsToSortModel,
  type LanguagesGridFilterModel, type LanguagesUrlParams,
} from '@/lib/i18n/languages-grid-query'
import type { LanguagePageItemDto } from '@/lib/i18n/types'
import { createLanguagesDatasource } from './languagesDatasource'
import LanguageFormModal from './LanguageFormModal'

type Props = LanguagesUrlParams

const LANGUAGE_TEXT_FILTER = TEXT_FILTER as Pick<ColDef<LanguagePageItemDto>, 'filter' | 'filterParams'>
const LANGUAGE_NUMBER_FILTER = NUMBER_FILTER as Pick<ColDef<LanguagePageItemDto>, 'filter' | 'filterParams'>
const LANGUAGE_DATE_FILTER = DATE_FILTER as Pick<ColDef<LanguagePageItemDto>, 'filter' | 'filterParams'>

export default function LanguagesTableClient(props: Props) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const [editing, setEditing] = useState<LanguagePageItemDto | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<LanguagePageItemDto | null>(null)
  const [promoting, setPromoting] = useState<LanguagePageItemDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gridApi, setGridApi] = useState<GridApi<LanguagePageItemDto> | null>(null)
  const gridApiRef = useRef<GridApi<LanguagePageItemDto> | null>(null)

  const datasource = useMemo(() => createLanguagesDatasource(), [])

  // Stable identities: `columnDefs` below depends on `run` in its memo, and an
  // inline function here would give it a new reference every render, forcing
  // the column defs (and the grid) to rebuild on every render for no reason.
  const refresh = useCallback(() => { router.refresh(); gridApiRef.current?.refreshInfiniteCache() }, [router])

  const run = useCallback(async (fn: () => Promise<{ error: string | null }>) => {
    const { error: message } = await fn()
    setError(message)
    if (!message) refresh()
  }, [refresh])

  const columnDefs = useMemo<ColDef<LanguagePageItemDto>[]>(() => [
    actionsColumnDef<LanguagePageItemDto>(row => [
      { label: t('common.actions.edit'), onClick: () => setEditing(row) },
      {
        label: row.isActive ? t('language.actions.deactivate') : t('language.actions.activate'),
        disabled: row.isDefault,
        onClick: () => run(() => setLanguageActive(row.id, !row.isActive)),
      },
      {
        label: t('language.actions.set_default'),
        disabled: row.isDefault || !row.isActive,
        onClick: () => setPromoting(row),
      },
      { label: t('common.actions.delete'), disabled: row.isDefault, onClick: () => setDeleting(row) },
    ]),
    { field: 'code', headerName: t('language.form.code'), sortable: true, width: 100, ...LANGUAGE_TEXT_FILTER },
    { field: 'locale', headerName: t('language.form.locale'), sortable: true, width: 120, ...LANGUAGE_TEXT_FILTER },
    {
      field: 'name', headerName: t('language.form.name'), sortable: true,
      ...LANGUAGE_TEXT_FILTER,
    },
    { field: 'nativeName', headerName: t('language.form.native_name'), sortable: true, ...LANGUAGE_TEXT_FILTER },
    {
      colId: 'isActive', headerName: t('language.active'), sortable: true, filter: EnumSelectFilter,
      filterParams: { options: [{ value: 'true', label: t('common.labels.yes') }, { value: 'false', label: t('common.labels.no') }] },
      valueGetter: p => p.data ? (p.data.isActive ? t('common.labels.yes') : t('common.labels.no')) : '',
    },
    {
      colId: 'isDefault', headerName: t('language.default'), sortable: true, filter: EnumSelectFilter,
      filterParams: { options: [{ value: 'true', label: t('common.labels.yes') }, { value: 'false', label: t('common.labels.no') }] },
      valueGetter: p => p.data ? (p.data.isDefault ? t('common.labels.yes') : t('common.labels.no')) : '',
    },
    { field: 'translated', headerName: t('language.translated_count'), sortable: false, ...LANGUAGE_NUMBER_FILTER },
    { field: 'missing', headerName: t('language.missing_count'), sortable: false, ...LANGUAGE_NUMBER_FILTER },
    {
      colId: 'createdAt', headerName: t('language.created_at'), sortable: true, ...LANGUAGE_DATE_FILTER,
      valueGetter: p => p.data ? fmt.date(p.data.createdAt) : '',
    },
  ], [t, fmt, run])

  const columnLabels = useMemo(() => [
    { colId: 'code', label: t('language.form.code') },
    { colId: 'locale', label: t('language.form.locale') },
    { colId: 'name', label: t('language.form.name') },
    { colId: 'nativeName', label: t('language.form.native_name') },
    { colId: 'isActive', label: t('language.active') },
    { colId: 'isDefault', label: t('language.default') },
    { colId: 'translated', label: t('language.translated_count') },
    { colId: 'missing', label: t('language.missing_count') },
    { colId: 'createdAt', label: t('language.created_at') },
  ], [t])

  const gridUrlSync = useGridUrlSync(pathname, sp.toString(), url => router.replace(url))
  const setParam = (updates: Record<string, string | null>) => gridUrlSync.update(updates)

  return (
    <>
      <GridToolbar
        gridApi={gridApi}
        columns={columnLabels}
        onClearFilters={() => resetGridFilters(
          gridApiRef.current,
          () => setParam(languagesFilterModelToSearchParams({})),
        )}
      >
        <Button size="sm" onClick={() => setCreating(true)}>
          {t('language.actions.create')}
        </Button>
      </GridToolbar>

      {error && <p role="alert" className="mb-3 text-sm text-destructive-muted-foreground">{error}</p>}

      <DataGrid<LanguagePageItemDto>
        columnDefs={columnDefs}
        datasource={datasource}
        getRowId={r => String(r.id)}
        initialFilterModel={languagesUrlParamsToFilterModel(props) as Record<string, unknown>}
        initialSortModel={languagesUrlParamsToSortModel(props)}
        onFilterChanged={(e: FilterChangedEvent<LanguagePageItemDto>) =>
          setParam(languagesFilterModelToSearchParams(e.api.getFilterModel() as LanguagesGridFilterModel))}
        onSortChanged={(e: SortChangedEvent<LanguagePageItemDto>) => {
          const active = e.api.getColumnState().find(c => c.sort)
          setParam({ sort: active?.colId ?? null, direction: active ? (active.sort === 'asc' ? 'ASC' : 'DESC') : null })
        }}
        onGridReady={(e: GridReadyEvent<LanguagePageItemDto>) => { gridApiRef.current = e.api; setGridApi(e.api) }}
      />

      {(creating || editing) && (
        <LanguageFormModal
          language={editing}
          onClose={saved => { setCreating(false); setEditing(null); if (saved) refresh() }}
        />
      )}

      {promoting && (
        <ConfirmModal
          title={t('language.actions.set_default')}
          message={t('language.confirm.set_default', { name: promoting.name })}
          confirmLabel={t('common.actions.confirm')}
          onCancel={() => setPromoting(null)}
          onConfirm={async () => { await run(() => setDefaultLanguage(promoting.id)); setPromoting(null) }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title={t('language.confirm.delete_title')}
          message={t('language.confirm.delete_message', { name: deleting.name })}
          confirmLabel={t('common.actions.delete')}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => { await run(() => deleteLanguage(deleting.id)); setDeleting(null) }}
        />
      )}
    </>
  )
}
