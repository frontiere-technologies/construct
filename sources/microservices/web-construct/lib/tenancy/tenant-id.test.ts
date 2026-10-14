import { describe, expect, it } from 'vitest'
import { toTenantId } from './tenant-id'

describe('toTenantId', () => {
  it('accepts a positive safe integer', () => {
    expect(toTenantId(1)).toBe(1)
    expect(toTenantId(42)).toBe(42)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects %s before it reaches the database',
    value => {
      expect(() => toTenantId(value)).toThrow('invalid tenant id')
    },
  )
})
