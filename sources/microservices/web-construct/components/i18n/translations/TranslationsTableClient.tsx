'use client'

import React, { useMemo, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import type { ColDef, FilterChangedEvent, GridApi, GridReadyEvent, SortChangedEvent } from 'ag-grid-community'
import DataGrid from '@/components/ui/DataGrid'
import GridToolbar from '@/components/ui/GridToolbar'
import { DATE_FILTER } from '@/components/ui/gridColumnFilters'
import { resetGridFilters } from '@/components/ui/grid-reset'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { actionsColumnDef } from '@/components/rbac/GridRowActionsMenu'
import EnumSelectFilter from '@/components/rbac/filters/EnumSelectFilter'
import { useI18n } from '@/context/I18nContext'
import { deleteTranslationKey } from '@/lib/i18n/translation-actions'
import {
  translationsFilterModelToSearchParams, translationsUrlParamsToFilterModel,
  translationsUrlParamsToSortModel, type TranslationsGridFilterModel, type TranslationsUrlParams,
} from '@/lib/i18n/translations-grid-query'
import type { TranslationRowDto } from '@/lib/i18n/types'
import { createTranslationsDatasource } from './translationsDatasource'
import TranslationEditorDrawer from './TranslationEditorDrawer'
import CreateTranslationKeyModal from './CreateTranslationKeyModal'
import TranslationValueCell from './TranslationValueCell'

interface Props {
  /** Full URL state, including dynamic value_<languageCode> filters (Task 4 consumes it). */
  urlParams: TranslationsUrlParams
  namespaces: string[]
  modules: string[]
}

const textFilter = {
  filter: 'agTextColumnFilter' as const,
  filterParams: { filterOptions: ['contains'], buttons: ['apply', 'reset'] },
}

const TRANSLATION_DATE_FILTER = DATE_FILTER as Pick<ColDef<TranslationRowDto>, 'filter' | 'filterParams'>

export default function TranslationsTableClient(props: Props) {
  const { t, fmt, languages } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const [editing, setEditing] = useState<TranslationRowDto | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<TranslationRowDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gridApi, setGridApi] = useState<GridApi<TranslationRowDto> | null>(null)
  const gridApiRef = useRef<GridApi<TranslationRowDto> | null>(null)

  const datasource = useMemo(() => createTranslationsDatasource(), [])
  const refresh = () => { router.refresh(); gridApiRef.current?.refreshInfiniteCache() }

  const columnDefs = useMemo<ColDef<TranslationRowDto>[]>(() => [
    actionsColumnDef<TranslationRowDto>(row => [
      { label: t('common.actions.edit'), onClick: () => setEditing(row) },
      { label: t('common.actions.delete'), onClick: () => setDeleting(row) },
    ]),
    {
      field: 'key', headerName: t('translation.key'), sortable: true,
      ...textFilter,
      minWidth: 260,
      cellRenderer: (p: { data?: TranslationRowDto }) => p.data ? <span className="font-mono text-xs">{p.data.key}</span> : null,
    },
    { field: 'description', headerName: t('translation.description'), sortable: false, ...textFilter, minWidth: 200 },
    {
      colId: 'namespace', field: 'namespace', headerName: t('translation.namespace'), sortable: true,
      filter: EnumSelectFilter,
      filterParams: { options: props.namespaces.map(n => ({ value: n, label: n })) },
      width: 140,
    },
    {
      colId: 'module', field: 'module', headerName: t('translation.module'), sortable: true,
      filter: EnumSelectFilter,
      filterParams: { options: props.modules.map(m => ({ value: m, label: m })) },
      width: 130,
    },
    // One column per active language: the value, or a "missing" chip.
    ...languages.map<ColDef<TranslationRowDto>>(language => ({
      colId: `value_${language.code}`,
      headerName: language.nativeName,
      sortable: false,
      ...textFilter,
      minWidth: 200,
      valueGetter: p => p.data && Object.hasOwn(p.data.values, language.code) ? p.data.values[language.code].value : '',
      cellRenderer: (p: { data?: TranslationRowDto }) => (
        <TranslationValueCell row={p.data} code={language.code} missingLabel={t('translation.missing')} />
      ),
    })),
    {
      colId: 'status', headerName: t('translation.status'), sortable: false, filter: EnumSelectFilter,
      filterParams: {
        options: [
          { value: 'missing', label: t('translation.filter.missing_only') },
          { value: 'complete', label: t('translation.filter.complete_only') },
        ],
      },
      width: 140,
      valueGetter: p => p.data ? (p.data.missingCodes.length ? t('translation.missing') : t('translation.complete')) : '',
    },
    {
      colId: 'language', headerName: t('profile.language'), hide: true, sortable: false, filter: EnumSelectFilter,
      filterParams: { options: languages.map(l => ({ value: l.code, label: l.nativeName })) },
      valueGetter: () => '',
    },
    {
      colId: 'updatedAt', headerName: t('translation.updated_at'), sortable: true, ...TRANSLATION_DATE_FILTER, width: 160,
      valueGetter: p => p.data ? fmt.dateTime(p.data.updatedAt) : '',
    },
  ], [t, fmt, languages, props.namespaces, props.modules])

  const columnLabels = useMemo(() => [
    { colId: 'key', label: t('translation.key') },
    { colId: 'description', label: t('translation.description') },
    { colId: 'namespace', label: t('translation.namespace') },
    { colId: 'module', label: t('translation.module') },
    ...languages.map(l => ({ colId: `value_${l.code}`, label: l.nativeName })),
    { colId: 'status', label: t('translation.status') },
    { colId: 'updatedAt', label: t('translation.updated_at') },
  ], [t, languages])

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(updates)) { if (v === null) next.delete(k); else next.set(k, v) }
    router.push(`${pathname}?${next.toString()}`)
  }

  return (
    <>
      <GridToolbar
        gridApi={gridApi}
        columns={columnLabels}
        onClearFilters={() => resetGridFilters(
          gridApiRef.current,
          () => setParam(translationsFilterModelToSearchParams({}, languages.map(language => language.code))),
        )}
      >
        <button onClick={() => setCreating(true)} className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white">
          {t('translation.actions.create')}
        </button>
      </GridToolbar>

      {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <DataGrid<TranslationRowDto>
        columnDefs={columnDefs}
        datasource={datasource}
        getRowId={r => String(r.id)}
        initialFilterModel={translationsUrlParamsToFilterModel(props.urlParams) as Record<string, unknown>}
        initialSortModel={translationsUrlParamsToSortModel(props.urlParams)}
        onFilterChanged={(e: FilterChangedEvent<TranslationRowDto>) =>
          setParam(translationsFilterModelToSearchParams(
            e.api.getFilterModel() as TranslationsGridFilterModel,
            languages.map(language => language.code),
          ))}
        onSortChanged={(e: SortChangedEvent<TranslationRowDto>) => {
          const active = e.api.getColumnState().find(c => c.sort)
          setParam({ sort: active?.colId ?? null, direction: active ? (active.sort === 'asc' ? 'ASC' : 'DESC') : null })
        }}
        onGridReady={(e: GridReadyEvent<TranslationRowDto>) => { gridApiRef.current = e.api; setGridApi(e.api) }}
      />

      {editing && (
        <TranslationEditorDrawer row={editing} onClose={saved => { setEditing(null); if (saved) refresh() }} />
      )}
      {creating && (
        <CreateTranslationKeyModal onClose={saved => { setCreating(false); if (saved) refresh() }} />
      )}
      {deleting && (
        <ConfirmModal
          title={t('translation.confirm.delete_title')}
          message={t('translation.confirm.delete_message', { key: deleting.key })}
          confirmLabel={t('common.actions.delete')}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const { error: message } = await deleteTranslationKey(deleting.id)
            setError(message)
            setDeleting(null)
            if (!message) refresh()
          }}
        />
      )}
    </>
  )
}
