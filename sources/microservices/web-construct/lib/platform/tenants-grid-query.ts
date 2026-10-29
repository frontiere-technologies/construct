import {
  gridTextFilterToSearch, gridTextFilterToSearchParams, searchParamsToGridTextFilter,
  type GridTextFilterModel, type TextSearch, type TextSearchOperator,
} from '@/lib/grid-text-search'
import { dateRangeToGridFilter, gridDateFilterToRange, type GridDateFilterModel } from '@/lib/grid-filter-models'

/**
 * La griglia dei tenant della console (specifica 2026-10-26, MT5-DEC-4): i tipi condivisi fra il
 * servizio, la rotta e la pagina, e il passaggio dal modello dei filtri di ag-grid alla richiesta e
 * all'indirizzo della pagina. Niente accesso ai dati: lo importa anche il componente client.
 */
export const TENANT_STATUSES = ['active', 'suspended', 'archived'] as const
export type PlatformTenantStatus = (typeof TENANT_STATUSES)[number]

/**
 * Una riga dell'elenco. Solo numeri e email degli amministratori: nessun altro dato di un tenant
 * entra qui (MT5-OK-2).
 */
export type PlatformTenantRow = {
  id: number
  slug: string
  name: string
  status: PlatformTenantStatus
  isTemplate: boolean
  primaryHost: string | null
  activeMembers: number
  adminEmails: string[]
  createdAt: string
}

/** Le colonne per cui si può ordinare: quelle che stanno nella tabella dei tenant. I conteggi si calcolano tenant per tenant. */
export const TENANT_SORT_FIELDS = ['name', 'slug', 'host', 'status', 'createdAt'] as const
export type TenantSortField = (typeof TENANT_SORT_FIELDS)[number]

export interface PlatformTenantsQuery {
  page: number
  size: number
  nameSearch?: TextSearch
  slugSearch?: TextSearch
  hostSearch?: TextSearch
  /** Gli archiviati si vedono solo con questo filtro (MT5-DEC-4). */
  status?: PlatformTenantStatus
  createdFrom?: string
  createdTo?: string
  sort?: TenantSortField
  direction?: 'ASC' | 'DESC'
}

export interface TenantsGridFilterModel {
  name?: GridTextFilterModel
  slug?: GridTextFilterModel
  host?: GridTextFilterModel
  status?: { value?: string | number }
  createdAt?: GridDateFilterModel
}

export interface TenantsGridSortItem { colId: string; sort: 'asc' | 'desc' }

function asStatus(value: unknown): PlatformTenantStatus | undefined {
  return TENANT_STATUSES.find(status => status === value)
}

export function buildTenantsGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: TenantsGridSortItem[],
  filterModel: TenantsGridFilterModel,
): PlatformTenantsQuery {
  const sortItem = sortModel[0]
  const created = gridDateFilterToRange(filterModel.createdAt)
  const query: PlatformTenantsQuery = {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    sort: (TENANT_SORT_FIELDS.find(field => field === sortItem?.colId)) ?? 'name',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'ASC',
  }
  const nameSearch = gridTextFilterToSearch(filterModel.name)
  const slugSearch = gridTextFilterToSearch(filterModel.slug)
  const hostSearch = gridTextFilterToSearch(filterModel.host)
  const status = asStatus(filterModel.status?.value)
  if (nameSearch) query.nameSearch = nameSearch
  if (slugSearch) query.slugSearch = slugSearch
  if (hostSearch) query.hostSearch = hostSearch
  if (status) query.status = status
  if (created?.from) query.createdFrom = created.from
  if (created?.to) query.createdTo = created.to
  return query
}

/** I parametri dell'indirizzo della pagina, come arrivano al server e come li riceve la griglia. */
export interface TenantsUrlParams {
  search: string
  search2?: string
  searchOperator?: TextSearchOperator | null
  slugSearch: string
  slugSearch2?: string
  slugSearchOperator?: TextSearchOperator | null
  hostSearch: string
  hostSearch2?: string
  hostSearchOperator?: TextSearchOperator | null
  status: PlatformTenantStatus | null
  createdFrom: string | null
  createdTo: string | null
  sortField: string
  sortDir: 'ASC' | 'DESC'
}

function parseDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null
}

const operatorOf = (value: string | undefined): TextSearchOperator | null => (value === 'AND' || value === 'OR' ? value : null)

export function parseTenantsGridUrlParams(params: Record<string, string | undefined>): TenantsUrlParams {
  const createdFrom = parseDate(params.createdFrom)
  const createdTo = parseDate(params.createdTo)
  const ordered = createdFrom !== null && createdTo !== null && createdFrom > createdTo
  return {
    search: params.search ?? '',
    search2: params.search2 ?? '',
    searchOperator: operatorOf(params.searchOperator),
    slugSearch: params.slugSearch ?? '',
    slugSearch2: params.slugSearch2 ?? '',
    slugSearchOperator: operatorOf(params.slugSearchOperator),
    hostSearch: params.hostSearch ?? '',
    hostSearch2: params.hostSearch2 ?? '',
    hostSearchOperator: operatorOf(params.hostSearchOperator),
    status: asStatus(params.status) ?? null,
    createdFrom: ordered ? null : createdFrom,
    createdTo: ordered ? null : createdTo,
    sortField: TENANT_SORT_FIELDS.find(field => field === params.sort) ?? 'name',
    sortDir: params.direction === 'DESC' ? 'DESC' : 'ASC',
  }
}

export function tenantsUrlParamsToFilterModel(p: TenantsUrlParams): TenantsGridFilterModel {
  const model: TenantsGridFilterModel = {}
  const name = searchParamsToGridTextFilter(p.search, p.search2, p.searchOperator)
  const slug = searchParamsToGridTextFilter(p.slugSearch, p.slugSearch2, p.slugSearchOperator)
  const host = searchParamsToGridTextFilter(p.hostSearch, p.hostSearch2, p.hostSearchOperator)
  const created = dateRangeToGridFilter({ from: p.createdFrom ?? undefined, to: p.createdTo ?? undefined })
  if (name) model.name = name
  if (slug) model.slug = slug
  if (host) model.host = host
  if (p.status) model.status = { value: p.status }
  if (created) model.createdAt = created
  return model
}

export function tenantsUrlParamsToSortModel(p: TenantsUrlParams): TenantsGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

function prefixedTextParams(prefix: string, model: GridTextFilterModel | undefined): Record<string, string | null> {
  const params = gridTextFilterToSearchParams(model)
  return { [prefix]: params.search, [`${prefix}2`]: params.search2, [`${prefix}Operator`]: params.searchOperator }
}

export function tenantsFilterModelToSearchParams(filterModel: TenantsGridFilterModel): Record<string, string | null> {
  const created = gridDateFilterToRange(filterModel.createdAt)
  return {
    ...gridTextFilterToSearchParams(filterModel.name),
    ...prefixedTextParams('slugSearch', filterModel.slug),
    ...prefixedTextParams('hostSearch', filterModel.host),
    status: filterModel.status?.value != null ? String(filterModel.status.value) : null,
    createdFrom: created?.from ?? null,
    createdTo: created?.to ?? null,
  }
}
