import {
  gridTextFilterToSearch, gridTextFilterToSearchParams, searchParamsToGridTextFilter,
  type GridTextFilterModel, type TextSearch, type TextSearchOperator,
} from '@/lib/grid-text-search'
import { dateRangeToGridFilter, gridDateFilterToRange, type GridDateFilterModel } from '@/lib/grid-filter-models'
import { AUDIT_OPERATIONS, type AuditActorKind, type AuditOperation } from './audit-types'

/**
 * La griglia del registro (specifica 2026-10-26, MT5-DEC-16): i tipi condivisi fra i servizi, le
 * rotte e le pagine, e il passaggio dal modello dei filtri di ag-grid alla richiesta e all'indirizzo
 * della pagina. Niente accesso ai dati: lo importa anche il componente client.
 */

/** Una voce del registro come la vede chi la legge. I dettagli passano da `sanitizeAuditDetails` anche in lettura. */
export type AuditRow = {
  id: string
  occurredAt: string
  actorEmail: string | null
  actorKind: AuditActorKind
  operation: AuditOperation
  objectType: string | null
  objectId: string | null
  details: Record<string, unknown>
  /** Solo nel registro della piattaforma: il tenant toccato, se c'è. */
  tenantId?: number | null
  /** Solo nel registro della piattaforma: il nome del tenant toccato (la tabella dei tenant è globale). */
  tenantName?: string | null
}

/** Le colonne per cui si può ordinare: una lista chiusa, mai un nome di colonna che arriva dalla richiesta. */
export const AUDIT_SORT_FIELDS = ['occurredAt', 'actor', 'operation'] as const
export type AuditSortField = (typeof AUDIT_SORT_FIELDS)[number]

/**
 * La chiave di traduzione del nome di un'operazione: `audit.operation.` più il codice (che ha i
 * punti: `role.create`). Concatenata e non scritta come modello di testo, perché l'inventario delle
 * chiavi (`devops/i18n-key-inventory.test.mjs`) legge un segnaposto come una sola parola, senza punti.
 * Che ogni codice abbia la sua chiave lo prova `lib/platform/platform-translations.integration.test.ts`.
 */
export function auditOperationKey(operation: AuditOperation): string {
  return 'audit.operation.' + operation
}

export interface AuditQuery {
  page: number
  size: number
  /** La persona: un pezzo dell'email di chi ha agito. */
  actorSearch?: TextSearch
  operation?: AuditOperation
  /** Il periodo, giorni inclusi (`AAAA-MM-GG`). */
  from?: string
  to?: string
  sort?: AuditSortField
  direction?: 'ASC' | 'DESC'
}

export interface AuditGridFilterModel {
  occurredAt?: GridDateFilterModel
  actor?: GridTextFilterModel
  operation?: { value?: string | number }
}

export interface AuditGridSortItem { colId: string; sort: 'asc' | 'desc' }

function asOperation(value: unknown): AuditOperation | undefined {
  return AUDIT_OPERATIONS.find(operation => operation === value)
}

export function buildAuditGridQuery(
  startRow: number,
  pageSize: number,
  sortModel: AuditGridSortItem[],
  filterModel: AuditGridFilterModel,
): AuditQuery {
  const sortItem = sortModel[0]
  const period = gridDateFilterToRange(filterModel.occurredAt)
  const query: AuditQuery = {
    page: Math.floor(startRow / pageSize),
    size: pageSize,
    sort: AUDIT_SORT_FIELDS.find(field => field === sortItem?.colId) ?? 'occurredAt',
    direction: sortItem ? (sortItem.sort === 'asc' ? 'ASC' : 'DESC') : 'DESC',
  }
  const actorSearch = gridTextFilterToSearch(filterModel.actor)
  const operation = asOperation(filterModel.operation?.value)
  if (actorSearch) query.actorSearch = actorSearch
  if (operation) query.operation = operation
  if (period?.from) query.from = period.from
  if (period?.to) query.to = period.to
  return query
}

/** I parametri dell'indirizzo della pagina, come arrivano al server e come li riceve la griglia. */
export interface AuditUrlParams {
  search: string
  search2?: string
  searchOperator?: TextSearchOperator | null
  operation: AuditOperation | null
  from: string | null
  to: string | null
  sortField: AuditSortField
  sortDir: 'ASC' | 'DESC'
}

function parseDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null
}

const operatorOf = (value: string | undefined): TextSearchOperator | null => (value === 'AND' || value === 'OR' ? value : null)

export function parseAuditGridUrlParams(params: Record<string, string | undefined>): AuditUrlParams {
  const from = parseDate(params.from)
  const to = parseDate(params.to)
  const ordered = from !== null && to !== null && from > to
  return {
    search: params.search ?? '',
    search2: params.search2 ?? '',
    searchOperator: operatorOf(params.searchOperator),
    operation: asOperation(params.operation) ?? null,
    from: ordered ? null : from,
    to: ordered ? null : to,
    sortField: AUDIT_SORT_FIELDS.find(field => field === params.sort) ?? 'occurredAt',
    sortDir: params.direction === 'ASC' ? 'ASC' : 'DESC',
  }
}

export function auditUrlParamsToFilterModel(p: AuditUrlParams): AuditGridFilterModel {
  const model: AuditGridFilterModel = {}
  const actor = searchParamsToGridTextFilter(p.search, p.search2, p.searchOperator)
  const period = dateRangeToGridFilter({ from: p.from ?? undefined, to: p.to ?? undefined })
  if (actor) model.actor = actor
  if (p.operation) model.operation = { value: p.operation }
  if (period) model.occurredAt = period
  return model
}

export function auditUrlParamsToSortModel(p: AuditUrlParams): AuditGridSortItem[] {
  return [{ colId: p.sortField, sort: p.sortDir === 'ASC' ? 'asc' : 'desc' }]
}

export function auditFilterModelToSearchParams(filterModel: AuditGridFilterModel): Record<string, string | null> {
  const period = gridDateFilterToRange(filterModel.occurredAt)
  return {
    ...gridTextFilterToSearchParams(filterModel.actor),
    operation: filterModel.operation?.value != null ? String(filterModel.operation.value) : null,
    from: period?.from ?? null,
    to: period?.to ?? null,
  }
}
