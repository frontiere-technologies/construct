export type TextSearchOperator = 'AND' | 'OR'

export interface CompoundTextSearch {
  operator: TextSearchOperator
  conditions: string[]
}

export type TextSearch = string | CompoundTextSearch

/** Escape PostgreSQL LIKE metacharacters so an AG Grid `contains` term is literal. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

export function normalizeTextSearch(search: TextSearch | undefined): CompoundTextSearch | undefined {
  if (typeof search === 'string') {
    return search ? { operator: 'AND', conditions: [search] } : undefined
  }
  if (!search || !Array.isArray(search.conditions)) return undefined
  const conditions = search.conditions.filter(condition => typeof condition === 'string' && condition.length > 0)
  if (conditions.length === 0) return undefined
  return { operator: search.operator === 'OR' ? 'OR' : 'AND', conditions }
}

export interface GridTextFilterModel {
  filterType?: 'text'
  type?: 'contains'
  filter?: string | null
  operator?: TextSearchOperator
  conditions?: { filterType?: 'text'; type?: 'contains'; filter?: string | null }[]
}

export function searchParamsToGridTextFilter(
  search: string,
  search2?: string,
  operator?: TextSearchOperator | null,
): GridTextFilterModel | undefined {
  if (!search) return undefined
  if (!search2) return { filter: search }
  return {
    filterType: 'text',
    operator: operator === 'OR' ? 'OR' : 'AND',
    conditions: [
      { filterType: 'text', type: 'contains', filter: search },
      { filterType: 'text', type: 'contains', filter: search2 },
    ],
  }
}

export function gridTextFilterToSearch(model: GridTextFilterModel | undefined): TextSearch | undefined {
  if (!model) return undefined
  if (model.conditions) {
    const conditions = model.conditions
      .map(condition => condition.filter)
      .filter((value): value is string => Boolean(value))
    if (conditions.length === 0) return undefined
    if (conditions.length === 1) return conditions[0]
    return { operator: model.operator === 'OR' ? 'OR' : 'AND', conditions }
  }
  return model.filter || undefined
}

export function gridTextFilterToSearchParams(model: GridTextFilterModel | undefined): {
  search: string | null
  search2: string | null
  searchOperator: TextSearchOperator | null
} {
  const search = gridTextFilterToSearch(model)
  if (!search) return { search: null, search2: null, searchOperator: null }
  if (typeof search === 'string') return { search, search2: null, searchOperator: null }
  return {
    search: search.conditions[0] ?? null,
    search2: search.conditions[1] ?? null,
    searchOperator: search.operator,
  }
}
