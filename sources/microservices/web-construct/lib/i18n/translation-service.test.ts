import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { applyTranslationFilters, buildTranslationRows, toSerialisableTranslationRow, translationOrderBy } from './translation-service'
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
  it('treats LIKE metacharacters literally in a key contains filter', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      search: String.raw`100%_\ready`,
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toHaveLength(1)
    expect(rendered[0].sql).toContain('"translation_key"."key" ilike $1 escape \'\\\'')
    expect(rendered[0].sql).not.toContain('100%')
    expect(rendered[0].params).toEqual([String.raw`%100\%\_\\ready%`])
  })

  it('treats LIKE metacharacters literally in a description contains filter', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      descriptionSearch: String.raw`100%_\ready`,
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toHaveLength(1)
    expect(rendered[0].sql).toContain('"translation_key"."description" ilike $1 escape \'\\\'')
    expect(rendered[0].sql).not.toContain('100%')
    expect(rendered[0].params).toEqual([String.raw`%100\%\_\\ready%`])
  })

  it('treats LIKE metacharacters literally in a translation value contains filter', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      valueSearches: { en: String.raw`100%_\ready` },
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toHaveLength(1)
    expect(rendered[0].sql).toContain("), '') ilike $2 escape '\\'")
    expect(rendered[0].sql).not.toContain('100%')
    expect(rendered[0].params).toEqual([1, String.raw`%100\%\_\\ready%`])
  })

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
    expect(rendered[0].sql).toContain('"translation_key"."description" ilike $1 escape \'\\\' or "translation_key"."description" ilike $2 escape \'\\\'')
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
    expect(rendered[0].sql).toContain("), '') ilike $2 escape '\\' and coalesce((")
    expect(rendered[0].params).toEqual([1, '%save%', 1, '%now%'])
  })

  it('combines value terms with OR for one active language', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      valueSearches: { en: { operator: 'OR', conditions: ['save', 'store'] } },
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toHaveLength(1)
    expect(rendered[0].sql).toContain("), '') ilike $2 escape '\\' or coalesce((")
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

  it('uses an inclusive updated date range without including the following day', () => {
    const rendered = applyTranslationFilters({
      page: 0,
      size: 50,
      updatedFrom: '2026-07-01',
      updatedTo: '2026-07-30',
    }, languages).map(condition => dialect.sqlToQuery(condition))

    expect(rendered).toHaveLength(2)
    expect(rendered.map(condition => condition.sql)).toEqual([
      '"translation_key"."updated_at" >= $1',
      '"translation_key"."updated_at" < $1',
    ])
    expect(rendered.map(condition => condition.params)).toEqual([
      ['2026-07-01'],
      ['2026-07-31'],
    ])
  })

  it('rejects an unsupported updated upper bound before computing the next day', () => {
    expect(() => applyTranslationFilters({ page: 0, size: 50, updatedTo: '9999-12-31' }, languages))
      .toThrow('updatedTo exceeds the supported inclusive upper bound')
  })

  it('uses the translation key id as a stable ordering tie-breaker', () => {
    const rendered = translationOrderBy({ page: 0, size: 50, sort: 'updatedAt', direction: 'DESC' })
      .map(order => dialect.sqlToQuery(order).sql)

    expect(rendered).toEqual([
      '"translation_key"."updated_at" desc',
      '"translation_key"."id_translation_key" asc',
    ])
  })
})

const key = {
  idTranslationKey: 7, key: 'auth.login.title', description: 'Login card title',
  namespace: 'auth', module: 'core', version: 3, updatedAt: '2026-09-01T10:00:00Z',
}

describe('buildTranslationRows', () => {
  it('groups each key with its own values and reports the untranslated languages', () => {
    const [row] = buildTranslationRows(
      [key],
      [
        { id: 11, keyId: 7, code: 'it', value: 'Accedi', version: 2 },
        // A value belonging to another key must not leak into this row.
        { id: 12, keyId: 8, code: 'en', value: 'Sign in', version: 1 },
      ],
      [{ code: 'it' }, { code: 'en' }],
    )

    expect(row.id).toBe(7)
    expect(row.key).toBe('auth.login.title')
    expect(row.version).toBe(3)
    expect(row.values.it).toEqual({ id: 11, value: 'Accedi', version: 2 })
    expect(row.values.en).toBeUndefined()
    expect(row.missingCodes).toEqual(['en'])
  })

  it('counts a present-but-empty value as missing', () => {
    const [row] = buildTranslationRows(
      [key],
      [{ id: 11, keyId: 7, code: 'it', value: '', version: 2 }],
      [{ code: 'it' }],
    )
    expect(row.missingCodes).toEqual(['it'])
  })

  // The reason the buckets are Object.create(null) rather than {}. Language
  // codes come from the database, so a code named after an Object.prototype
  // member must read as "no translation", not as an inherited function.
  it('treats a prototype-shaped language code as untranslated, not as an inherited member', () => {
    const [row] = buildTranslationRows([key], [], [{ code: 'constructor' }, { code: '__proto__' }])

    expect(row.missingCodes).toEqual(['constructor', '__proto__'])
    expect(Object.hasOwn(row.values, 'constructor')).toBe(false)
    expect(row.values.constructor as unknown).toBeUndefined()
  })

  it('keeps a prototype-shaped code that really has a value', () => {
    const [row] = buildTranslationRows(
      [key],
      [{ id: 11, keyId: 7, code: 'constructor', value: 'Costruttore', version: 1 }],
      [{ code: 'constructor' }],
    )
    expect(row.values.constructor).toEqual({ id: 11, value: 'Costruttore', version: 1 })
    expect(row.missingCodes).toEqual([])
  })

  it('accepts the string ids the postgres driver returns for bigint columns', () => {
    const [row] = buildTranslationRows(
      [{ ...key, idTranslationKey: '7' }],
      [{ id: '11', keyId: '7', code: 'it', value: 'Accedi', version: 2 }],
      [{ code: 'it' }],
    )
    expect(row.id).toBe(7)
    expect(row.values.it.id).toBe(11)
  })
})

describe('toSerialisableTranslationRow', () => {
  it('returns a row whose values has Object.prototype as its prototype', () => {
    const original = buildTranslationRows(
      [key],
      [{ id: 11, keyId: 7, code: 'it', value: 'Accedi', version: 2 }],
      [{ code: 'it' }],
    )[0]

    const serialisable = toSerialisableTranslationRow(original)

    expect(Object.getPrototypeOf(serialisable.values)).toBe(Object.prototype)
  })

  it('preserves a __proto__ code as an own property with its value intact', () => {
    const original = buildTranslationRows(
      [key],
      [{ id: 11, keyId: 7, code: '__proto__', value: 'Proto Value', version: 1 }],
      [{ code: '__proto__' }],
    )[0]

    const serialisable = toSerialisableTranslationRow(original)

    expect(Object.hasOwn(serialisable.values, '__proto__')).toBe(true)
    expect(serialisable.values.__proto__).toEqual({ id: 11, value: 'Proto Value', version: 1 })
    expect(Object.getPrototypeOf(serialisable.values)).toBe(Object.prototype)
  })

  it('preserves a constructor code as an own property with its value intact', () => {
    const original = buildTranslationRows(
      [key],
      [{ id: 12, keyId: 7, code: 'constructor', value: 'Costruttore', version: 1 }],
      [{ code: 'constructor' }],
    )[0]

    const serialisable = toSerialisableTranslationRow(original)

    expect(Object.hasOwn(serialisable.values, 'constructor')).toBe(true)
    expect(serialisable.values.constructor).toEqual({ id: 12, value: 'Costruttore', version: 1 })
  })

  it('keeps all other row fields unchanged', () => {
    const original = buildTranslationRows(
      [key],
      [{ id: 11, keyId: 7, code: 'it', value: 'Accedi', version: 2 }],
      [{ code: 'it' }, { code: 'en' }],
    )[0]

    const serialisable = toSerialisableTranslationRow(original)

    expect(serialisable.id).toBe(original.id)
    expect(serialisable.key).toBe(original.key)
    expect(serialisable.description).toBe(original.description)
    expect(serialisable.namespace).toBe(original.namespace)
    expect(serialisable.module).toBe(original.module)
    expect(serialisable.version).toBe(original.version)
    expect(serialisable.updatedAt).toBe(original.updatedAt)
    expect(serialisable.missingCodes).toEqual(original.missingCodes)
  })
})
