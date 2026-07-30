import { afterEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '@/lib/db/schema'
import { db } from '@/lib/db'
import {
  applyLanguageFilters, buildLanguagePageQuery, buildLanguageRowsQuery,
  buildLanguageTotalQuery, languageOrderBy, listLanguagesPage,
} from './language-service'
import type { LanguagesQuery } from './types'

const dialect = new PgDialect()
const baseQuery: LanguagesQuery = { page: 0, size: 50 }
const queryDb = drizzle.mock({ schema })

afterEach(() => vi.restoreAllMocks())

function render(query: LanguagesQuery) {
  return applyLanguageFilters(query).map(condition => dialect.sqlToQuery(condition))
}

function resultDatabase(results: unknown[][][]) {
  const unsafe = vi.fn(() => ({ values: vi.fn(async () => results.shift() ?? []) }))
  const client = { options: { parsers: {}, serializers: {} }, unsafe }
  return { database: drizzle(client as never, { schema }), unsafe }
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

  it('refuses to render SQL for the unsupported terminal created-to date', () => {
    expect(() => render({ ...baseQuery, createdTo: '9999-12-31' }))
      .toThrowError(/createdTo/i)
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

describe('language page query snapshot', () => {
  it('computes translated once and derives missing from that same projected count', () => {
    const rendered = buildLanguageRowsQuery(queryDb).toSQL()

    expect(rendered.sql.match(/from "translation_value"/g)).toHaveLength(1)
    expect(rendered.sql.match(/from "translation_key"/g)).toHaveLength(1)
    expect(rendered.sql).toContain(
      '"translation_value"."id_language" = "language_base"."id_language"',
    )
    expect(rendered.sql).toContain('as "translated"')
    expect(rendered.sql).toContain('"total_keys" - "translated" as "missing"')
  })

  it('projects the same count columns used by page filters and applies those filters to total', () => {
    const query = { ...baseQuery, translatedMin: 10, missingMax: 3 }
    const page = buildLanguagePageQuery(queryDb, query).toSQL()
    const total = buildLanguageTotalQuery(queryDb, query).toSQL()

    expect(page.sql).toContain('select "id_language", "code", "locale", "name", "native_name", "is_active", "is_default", "created_at", "updated_at", "translated", "missing"')
    expect(page.sql).toContain('where ("translated" >=')
    expect(page.sql).toContain('"missing" <=')
    expect(total.sql).toContain('where ("translated" >=')
    expect(total.sql).toContain('"missing" <=')
    expect(page.sql.match(/from "translation_value"/g)).toHaveLength(1)
    expect(total.sql.match(/from "translation_value"/g)).toHaveLength(1)
    expect(page.params.slice(0, 2)).toEqual([10, 3])
    expect(total.params).toEqual([10, 3])
  })

  it('maps projected counts and runs page/total inside a read-only repeatable-read transaction', async () => {
    const { database, unsafe } = resultDatabase([
      [[1, 'it', 'it-IT', 'Italian', 'Italiano', true, true, '2026-07-01', '2026-07-02', 10, 2]],
      [[1]],
    ])
    const transaction = vi.spyOn(db, 'transaction').mockImplementation(
      async callback => callback(database as never),
    )
    vi.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('page path must not query outside its transaction')
    })

    await expect(listLanguagesPage(baseQuery)).resolves.toEqual({
      total: 1,
      elements: [{
        id: 1, code: 'it', locale: 'it-IT', name: 'Italian', nativeName: 'Italiano',
        isActive: true, isDefault: true, translated: 10, missing: 2,
        createdAt: '2026-07-01', updatedAt: '2026-07-02',
      }],
    })
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
    expect(unsafe).toHaveBeenCalledTimes(2)
  })

  it('still reads the filtered total when the requested page is empty', async () => {
    const { database, unsafe } = resultDatabase([[], [[7]]])
    vi.spyOn(db, 'transaction').mockImplementation(
      async callback => callback(database as never),
    )

    await expect(listLanguagesPage({ ...baseQuery, page: 5 })).resolves.toEqual({
      total: 7,
      elements: [],
    })
    expect(unsafe).toHaveBeenCalledTimes(2)
  })
})
