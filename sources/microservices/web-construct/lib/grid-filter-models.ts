export interface GridNumberFilterModel {
  type?: 'equals' | 'inRange'
  filter?: number
  filterTo?: number
}

export interface NumberRange {
  min?: number
  max?: number
}

export interface GridDateFilterModel {
  filterType?: 'date'
  type?: 'inRange' | 'greaterThanOrEqual' | 'lessThanOrEqual'
  dateFrom?: string
  dateTo?: string
}

export interface DateRange {
  from?: string
  to?: string
}

export function gridNumberFilterToRange(model?: GridNumberFilterModel): NumberRange | undefined {
  if (model?.filter == null) return undefined

  return model.type === 'inRange'
    ? { min: model.filter, max: model.filterTo }
    : { min: model.filter, max: model.filter }
}

export function numberRangeToGridFilter(range?: NumberRange): GridNumberFilterModel | undefined {
  if (range?.min == null) return undefined
  if (range.max == null || range.max === range.min) return { type: 'equals', filter: range.min }

  return { type: 'inRange', filter: range.min, filterTo: range.max }
}

export function gridDateFilterToRange(model?: GridDateFilterModel): DateRange | undefined {
  if (!model?.dateFrom && !model?.dateTo) return undefined
  if (model.type === 'greaterThanOrEqual') return model.dateFrom ? { from: model.dateFrom.slice(0, 10) } : undefined
  if (model.type === 'lessThanOrEqual') return model.dateFrom ? { to: model.dateFrom.slice(0, 10) } : undefined

  return {
    from: model.dateFrom?.slice(0, 10),
    to: model.dateTo?.slice(0, 10),
  }
}

export function dateRangeToGridFilter(range?: DateRange): GridDateFilterModel | undefined {
  if (range?.from && range.to) {
    return {
      filterType: 'date',
      type: 'inRange',
      dateFrom: range.from.slice(0, 10),
      dateTo: range.to.slice(0, 10),
    }
  }
  if (range?.from) {
    return { filterType: 'date', type: 'greaterThanOrEqual', dateFrom: range.from.slice(0, 10) }
  }
  if (range?.to) {
    return { filterType: 'date', type: 'lessThanOrEqual', dateFrom: range.to.slice(0, 10) }
  }

  return undefined
}
