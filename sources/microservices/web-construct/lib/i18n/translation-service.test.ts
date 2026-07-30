import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { applyTranslationFilters } from './translation-service'
import type { LanguageDto } from './types'

const dialect = new PgDialect()
const languages: LanguageDto[] = [
  {
    id: 1,
    code: 'en',
    locale: 'en-US',
    name: 'English',
    nativeName: 'English',
    isActive: true,
    isDefault: false,
  },
  {
    id: 2,
    code: 'it',
    locale: 'it-IT',
    name: 'Italian',
    nativeName: 'Italiano',
    isActive: true,
    isDefault: true,
  },
  {
    id: 3,
    code: 'fr',
    locale: 'fr-FR',
    name: 'French',
    nativeName: 'Français',
    isActive: false,
    isDefault: false,
  },
]

describe('applyTranslationFilters', () => {
  it('filters description with compound AND conditions', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      descriptionSearch: { operator: 'AND', conditions: ['button', 'label'] },
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toHaveLength(1)
    expect(rendered[0].sql).toContain('"translation_key"."description"')
    expect(rendered[0].sql).toContain(' and ')
    expect(rendered[0].params).toEqual(['%button%', '%label%'])
  })

  it('filters description with compound OR conditions', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      descriptionSearch: { operator: 'OR', conditions: ['button', 'label'] },
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toHaveLength(1)
    expect(rendered[0].sql).toContain('"translation_key"."description" ilike $1 or "translation_key"."description" ilike $2')
    expect(rendered[0].params).toEqual(['%button%', '%label%'])
  })

  it('filters a translation value only for a matching active language', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      valueSearches: { en: 'save', removed: 'ignored' },
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toHaveLength(1)
    expect(rendered[0].sql).toContain('translation_value')
    expect(rendered[0].params).toEqual([1, '%save%'])
  })

  it('combines value terms with AND for one active language', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      valueSearches: { en: { operator: 'AND', conditions: ['save', 'now'] } },
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toHaveLength(1)
    expect(rendered[0].sql).toContain("), '') ilike $2 and coalesce((")
    expect(rendered[0].params).toEqual([1, '%save%', 1, '%now%'])
  })

  it('combines value terms with OR for one active language', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      valueSearches: { en: { operator: 'OR', conditions: ['save', 'store'] } },
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toHaveLength(1)
    expect(rendered[0].sql).toContain("), '') ilike $2 or coalesce((")
    expect(rendered[0].params).toEqual([1, '%save%', 1, '%store%'])
  })

  it('adds separate conditions for filters on two active languages', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      valueSearches: { en: 'save', it: 'salva' },
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toHaveLength(2)
    expect(rendered.map(condition => condition.params)).toEqual([[1, '%save%'], [2, '%salva%']])
  })

  it('ignores inactive and unknown language codes', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      valueSearches: { fr: 'enregistrer', removed: 'ignored' },
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toEqual([])
  })

  it('coalesces missing translation rows to an empty value before filtering', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      valueSearches: { en: 'save' },
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered[0].sql).toContain("coalesce((\n      select \"translation_value\".\"value\"")
    expect(rendered[0].sql).toContain("), '') ilike $2")
    expect(rendered[0].params).toEqual([1, '%save%'])
  })
})
