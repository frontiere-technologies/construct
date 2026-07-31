import { describe, expect, it } from 'vitest'
import { translationStatusFilterOptions } from './translationStatusFilter'

describe('translationStatusFilterOptions', () => {
  it('uses the plain Missing and Complete translation keys', () => {
    const requested: string[] = []
    const options = translationStatusFilterOptions(((key: string) => {
      requested.push(key)
      return key
    }) as never)

    expect(options).toEqual([
      { value: 'missing', label: 'translation.missing' },
      { value: 'complete', label: 'translation.complete' },
    ])
    expect(requested).not.toContain('translation.filter.missing_only')
    expect(requested).not.toContain('translation.filter.complete_only')
  })
})
