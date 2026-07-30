import type { LanguagesQuery } from './types'
import {
  gridTextFilterToSearch, gridTextFilterToSearchParams, searchParamsToGridTextFilter,
  type GridTextFilterModel, type TextSearchOperator,
} from '@/lib/grid-text-search'
import {
  dateRangeToGridFilter, gridDateFilterToRange, gridNumberFilterToRange, numberRangeToGridFilter,
  type GridDateFilterModel, type GridNumberFilterModel,
} from '@/lib/grid-filter-models'
import { isSupportedLanguageCreatedTo } from './language-grid-boundaries'

export interface LanguagesGridFilterModel {
  code?: GridTextFilterModel
  locale?: GridTextFilterModel
  name?: GridTextFilterModel
  nativeName?: GridTextFilterModel
  isActive?: { value?: string | number }
  isDefault?: { value?: string | number }
  translated?: GridNumberFilterModel
  missing?: GridNumberFilterModel
  createdAt?: GridDateFilterModel
}

export interface LanguagesGridSortItem { colId: string; sort: 'asc' | 'desc' }

function enumBoolean(value: string | number | undefined): boolean | undefined {
  return value === 'true' ? true : value === 'false' ? false : undefined
}

export function buildLanguagesGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: LanguagesGridSortItem[],
  filterModel: LanguagesGridFilterModel,
): LanguagesQuery {
  const sortItem = sortModel[0]
  const translatedRange = gridNumberFilterToRange(filterModel.translated)
  const missingRange = gridNumberFilterToRange(filterModel.missing)
  const createdRange = gridDateFilterToRange(filterModel.createdAt)
  return {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    codeSearch: gridTextFilterToSearch(filterModel.code),
    localeSearch: gridTextFilterToSearch(filterModel.locale),
    nameSearch: gridTextFilterToSearch(filterModel.name),
    nativeNameSearch: gridTextFilterToSearch(filterModel.nativeName),
    isActive: enumBoolean(filterModel.isActive?.value),
    isDefault: enumBoolean(filterModel.isDefault?.value),
    translatedMin: translatedRange?.min,
    translatedMax: translatedRange?.max,
    missingMin: missingRange?.min,
    missingMax: missingRange?.max,
    createdFrom: createdRange?.from,
    createdTo: createdRange?.to,
    sort: (sortItem?.colId as LanguagesQuery['sort']) ?? 'code',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'ASC',
  }
}

export interface LanguagesUrlParams {
  codeSearch: string
  codeSearch2?: string
  codeSearchOperator?: TextSearchOperator | null
  localeSearch: string
  localeSearch2?: string
  localeSearchOperator?: TextSearchOperator | null
  search: string
  search2?: string
  searchOperator?: TextSearchOperator | null
  nativeNameSearch: string
  nativeNameSearch2?: string
  nativeNameSearchOperator?: TextSearchOperator | null
  isActive: boolean | null
  isDefault: boolean | null
  translatedMin: number | null
  translatedMax: number | null
  missingMin: number | null
  missingMax: number | null
  createdFrom: string | null
  createdTo: string | null
  sortField: string
  sortDir: 'ASC' | 'DESC'
}

const LANGUAGE_SORT_FIELDS = new Set<NonNullable<LanguagesQuery['sort']>>([
  'code', 'locale', 'name', 'nativeName', 'isActive', 'isDefault', 'createdAt',
])

function parseDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : null
}

function parseCount(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function orderedRange<T extends number | string>(
  min: T | null,
  max: T | null,
): [T | null, T | null] {
  if (min == null || (max != null && min > max)) return [null, null]
  return [min, max]
}

function orderedDateRange(from: string | null, to: string | null): [string | null, string | null] {
  return from != null && to != null && from > to ? [null, null] : [from, to]
}

export function parseLanguagesGridUrlParams(params: Record<string, string | undefined>): LanguagesUrlParams {
  const sort = params.sort as LanguagesQuery['sort'] | undefined
  const [translatedMin, translatedMax] = orderedRange(
    parseCount(params.translatedMin), parseCount(params.translatedMax),
  )
  const [missingMin, missingMax] = orderedRange(
    parseCount(params.missingMin), parseCount(params.missingMax),
  )
  const [createdFrom, createdTo] = orderedDateRange(
    parseDate(params.createdFrom),
    (() => {
      const value = parseDate(params.createdTo)
      return value && isSupportedLanguageCreatedTo(value) ? value : null
    })(),
  )
  return {
    codeSearch: params.codeSearch ?? '',
    codeSearch2: params.codeSearch2 ?? '',
    codeSearchOperator: params.codeSearchOperator === 'AND' || params.codeSearchOperator === 'OR'
      ? params.codeSearchOperator
      : null,
    localeSearch: params.localeSearch ?? '',
    localeSearch2: params.localeSearch2 ?? '',
    localeSearchOperator: params.localeSearchOperator === 'AND' || params.localeSearchOperator === 'OR'
      ? params.localeSearchOperator
      : null,
    search: params.search ?? '',
    search2: params.search2 ?? '',
    searchOperator: params.searchOperator === 'AND' || params.searchOperator === 'OR'
      ? params.searchOperator
      : null,
    nativeNameSearch: params.nativeNameSearch ?? '',
    nativeNameSearch2: params.nativeNameSearch2 ?? '',
    nativeNameSearchOperator: params.nativeNameSearchOperator === 'AND' || params.nativeNameSearchOperator === 'OR'
      ? params.nativeNameSearchOperator
      : null,
    isActive: params.isActive === 'true' ? true : params.isActive === 'false' ? false : null,
    isDefault: params.isDefault === 'true' ? true : params.isDefault === 'false' ? false : null,
    translatedMin,
    translatedMax,
    missingMin,
    missingMax,
    createdFrom,
    createdTo,
    sortField: sort && LANGUAGE_SORT_FIELDS.has(sort) ? sort : 'code',
    sortDir: params.direction === 'DESC' ? 'DESC' : 'ASC',
  }
}

export function languagesUrlParamsToFilterModel(p: LanguagesUrlParams): LanguagesGridFilterModel {
  const model: LanguagesGridFilterModel = {}
  const codeFilter = searchParamsToGridTextFilter(p.codeSearch, p.codeSearch2, p.codeSearchOperator)
  const localeFilter = searchParamsToGridTextFilter(p.localeSearch, p.localeSearch2, p.localeSearchOperator)
  const nameFilter = searchParamsToGridTextFilter(p.search, p.search2, p.searchOperator)
  const nativeNameFilter = searchParamsToGridTextFilter(
    p.nativeNameSearch, p.nativeNameSearch2, p.nativeNameSearchOperator,
  )
  if (codeFilter) model.code = codeFilter
  if (localeFilter) model.locale = localeFilter
  if (nameFilter) model.name = nameFilter
  if (nativeNameFilter) model.nativeName = nativeNameFilter
  if (p.isActive != null) model.isActive = { value: String(p.isActive) }
  if (p.isDefault != null) model.isDefault = { value: String(p.isDefault) }
  const translatedFilter = numberRangeToGridFilter({
    min: p.translatedMin ?? undefined, max: p.translatedMax ?? undefined,
  })
  const missingFilter = numberRangeToGridFilter({
    min: p.missingMin ?? undefined, max: p.missingMax ?? undefined,
  })
  const createdFilter = dateRangeToGridFilter({
    from: p.createdFrom ?? undefined, to: p.createdTo ?? undefined,
  })
  if (translatedFilter) model.translated = translatedFilter
  if (missingFilter) model.missing = missingFilter
  if (createdFilter) model.createdAt = createdFilter
  return model
}

export function languagesUrlParamsToSortModel(p: LanguagesUrlParams): LanguagesGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

function prefixedTextParams(
  prefix: string,
  model: GridTextFilterModel | undefined,
): Record<string, string | null> {
  const params = gridTextFilterToSearchParams(model)
  return {
    [prefix]: params.search,
    [`${prefix}2`]: params.search2,
    [`${prefix}Operator`]: params.searchOperator,
  }
}

export function languagesFilterModelToSearchParams(
  filterModel: LanguagesGridFilterModel,
): Record<string, string | null> {
  const translatedRange = gridNumberFilterToRange(filterModel.translated)
  const missingRange = gridNumberFilterToRange(filterModel.missing)
  const createdRange = gridDateFilterToRange(filterModel.createdAt)
  return {
    ...prefixedTextParams('codeSearch', filterModel.code),
    ...prefixedTextParams('localeSearch', filterModel.locale),
    ...gridTextFilterToSearchParams(filterModel.name),
    ...prefixedTextParams('nativeNameSearch', filterModel.nativeName),
    isActive: filterModel.isActive?.value != null ? String(filterModel.isActive.value) : null,
    isDefault: filterModel.isDefault?.value != null ? String(filterModel.isDefault.value) : null,
    translatedMin: translatedRange?.min != null ? String(translatedRange.min) : null,
    translatedMax: translatedRange?.max != null ? String(translatedRange.max) : null,
    missingMin: missingRange?.min != null ? String(missingRange.min) : null,
    missingMax: missingRange?.max != null ? String(missingRange.max) : null,
    createdFrom: createdRange?.from ?? null,
    createdTo: createdRange?.to ?? null,
  }
}
