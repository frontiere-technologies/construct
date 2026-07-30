import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { applyLanguageFilters, languageOrderBy } from './language-service'
import type { LanguagesQuery } from './types'

const dialect = new PgDialect()
const baseQuery: LanguagesQuery = { page: 0, size: 50 }

function render(query: LanguagesQuery) {
  return applyLanguageFilters(query).map(condition => dialect.sqlToQuery(condition))
}

describe('applyLanguageFilters', () => {
  it('applies each text search only to its own language column', () => {
    const rendered = render({
      ...baseQuery,
      codeSearch: 'it', localeSearch: 'IT', nameSearch: 'Italian', nativeNameSearch: 'Italiano',
    })

    expect(rendered).toHaveLength(4)
    expect(rendered[0].sql).toContain('"app_language"."code" ilike')
    expect(rendered[0].sql).not.toContain('"app_language"."locale"')
    expect(rendered[1].sql).toContain('"app_language"."locale" ilike')
    expect(rendered[1].sql).not.toContain('"app_language"."code"')
    expect(rendered[2].sql).toContain('"app_language"."name" ilike')
    expect(rendered[2].sql).not.toContain('"app_language"."native_name"')
    expect(rendered[3].sql).toContain('"app_language"."native_name" ilike')
    expect(rendered[3].sql).not.toContain('"app_language"."name" ilike')
    expect(rendered.map(item => item.params)).toEqual([
      ['%it%'], ['%IT%'], ['%Italian%'], ['%Italiano%'],
    ])
  })

  it('combines compound text conditions with AND/OR and escapes LIKE metacharacters literally', () => {
    const rendered = render({
      ...baseQuery,
      codeSearch: { operator: 'AND', conditions: [String.raw`i%_\\t`, 'lang'] },
      localeSearch: { operator: 'OR', conditions: ['IT', 'CH'] },
    })

    expect(rendered[0].sql).toContain(" escape '\\' and ")
    expect(rendered[0].params).toEqual([String.raw`%i\%\_\\\\t%`, '%lang%'])
    expect(rendered[1].sql).toContain(' or ')
    expect(rendered[1].params).toEqual(['%IT%', '%CH%'])
  })

  it('keeps isActive and isDefault as independent boolean conditions', () => {
    const rendered = render({ ...baseQuery, isActive: false, isDefault: true })

    expect(rendered).toHaveLength(2)
    expect(rendered[0].sql).toContain('"app_language"."is_active"')
    expect(rendered[0].params).toEqual([false])
    expect(rendered[1].sql).toContain('"app_language"."is_default"')
    expect(rendered[1].sql).not.toContain('"app_language"."is_active"')
    expect(rendered[1].params).toEqual([true])
  })

  it('uses correlated non-empty translation counts for inclusive translated and missing ranges', () => {
    const rendered = render({
      ...baseQuery,
      translatedMin: 10, translatedMax: 20,
      missingMin: 2, missingMax: 3,
    })

    expect(rendered).toHaveLength(4)
    expect(rendered[0].sql).toContain('"translation_value"."id_language" = "app_language"."id_language"')
    expect(rendered[0].sql).toContain('"translation_value"."value" <>')
    expect(rendered[0].sql).toContain('>=')
    expect(rendered[1].sql).toContain('<=')
    expect(rendered[2].sql).toContain('select count(*)::int from "translation_key"')
    expect(rendered[2].sql).toContain('"translation_value"."id_language" = "app_language"."id_language"')
    expect(rendered[2].sql).toContain('>=')
    expect(rendered[3].sql).toContain('<=')
    expect(rendered.flatMap(item => item.params)).toEqual([10, 20, 2, 3])
  })

  it('includes the full created-to day using the next-day exclusive boundary', () => {
    const rendered = render({
      ...baseQuery,
      createdFrom: '2026-07-01',
      createdTo: '2026-07-30',
    })

    expect(rendered.map(item => item.sql).join(' ')).toContain('"app_language"."created_at" >=')
    expect(rendered.map(item => item.sql).join(' ')).toContain('"app_language"."created_at" <')
    expect(rendered.map(item => item.params)).toEqual([['2026-07-01'], ['2026-07-31']])
  })

  it('returns no conditions when filters are omitted', () => {
    expect(applyLanguageFilters(baseQuery)).toEqual([])
  })
})

describe('languageOrderBy', () => {
  it('adds an id tie-breaker so paged results remain deterministic', () => {
    const rendered = languageOrderBy({ ...baseQuery, sort: 'isDefault', direction: 'DESC' })
      .map(order => dialect.sqlToQuery(order))

    expect(rendered).toHaveLength(2)
    expect(rendered[0].sql).toContain('"app_language"."is_default" desc')
    expect(rendered[1].sql).toContain('"app_language"."id_language" asc')
  })
})
