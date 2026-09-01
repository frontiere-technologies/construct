import { describe, expect, it } from 'vitest'
import {
  translationCreateHref, translationEditHref, translationsListHref,
} from './translations-return-url'

describe('translationsListHref', () => {
  it('falls back to the bare list when there is nothing to restore', () => {
    expect(translationsListHref(undefined)).toBe('/admin/translations')
    expect(translationsListHref(null)).toBe('/admin/translations')
    expect(translationsListHref('')).toBe('/admin/translations')
  })

  it('restores the grid query it was given', () => {
    expect(translationsListHref('sort=namespace&direction=ASC'))
      .toBe('/admin/translations?sort=namespace&direction=ASC')
  })

  it('tolerates a leading question mark', () => {
    expect(translationsListHref('?sort=key')).toBe('/admin/translations?sort=key')
  })

  // The path is a constant in the module, never taken from `from`, so a hostile
  // value cannot move the destination — it can only become a useless parameter.
  it('cannot be pushed off the translations route', () => {
    for (const hostile of [
      'https://evil.example/steal',
      '//evil.example',
      '/admin/languages',
      '../../etc/passwd',
      'javascript:alert(1)',
    ]) {
      expect(translationsListHref(hostile).startsWith('/admin/translations')).toBe(true)
    }
  })

  it('keeps a filter value that itself contains a URL', () => {
    const search = new URLSearchParams({ value_it: 'https://www.lescienze.it/' }).toString()
    const restored = translationsListHref(search)
    expect(restored.startsWith('/admin/translations?')).toBe(true)
    const back = new URLSearchParams(restored.split('?')[1])
    expect(back.get('value_it')).toBe('https://www.lescienze.it/')
  })
})

describe('the hrefs the grid navigates to', () => {
  it('points at the edit page and carries the list query in one round trip', () => {
    const search = 'sort=namespace&direction=ASC&namespace=auth'
    const href = translationEditHref(42, search)

    expect(href.startsWith('/admin/translations/42/edit?')).toBe(true)
    const from = new URLSearchParams(href.split('?')[1]).get('from')
    expect(translationsListHref(from)).toBe(`/admin/translations?${search}`)
  })

  it('omits the parameter entirely when the list has no state', () => {
    expect(translationEditHref(42, '')).toBe('/admin/translations/42/edit')
    expect(translationCreateHref('')).toBe('/admin/translations/create')
  })

  it('points at the create page and carries the list query', () => {
    const href = translationCreateHref('sort=key')
    const from = new URLSearchParams(href.split('?')[1]).get('from')
    expect(translationsListHref(from)).toBe('/admin/translations?sort=key')
  })
})
