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
})
