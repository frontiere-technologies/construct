import { describe, expect, it } from 'vitest'
import { slugSchema } from './tenant-action-schemas'
import { suggestSlug } from './tenant-slug'

describe('suggestSlug', () => {
  it.each([
    ['Acme Costruzioni', 'acme-costruzioni'],
    ['  Società  Più  ', 'societa-piu'],
    ['A&B -- Impianti!', 'a-b-impianti'],
    ['Tenant 42', 'tenant-42'],
    ['---', ''],
    ['', ''],
  ])('turns %j into %j', (name, slug) => {
    expect(suggestSlug(name)).toBe(slug)
  })

  it('stays within the 40 characters the database allows, without a trailing hyphen', () => {
    const slug = suggestSlug('Un nome davvero molto molto lungo per un tenant di prova di lunghezza')
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
    expect(slugSchema.safeParse(slug).success).toBe(true)
  })
})
