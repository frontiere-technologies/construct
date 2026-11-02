import { describe, expect, it } from 'vitest'
import { effectiveQueryTimeoutMs } from './tenant-limits'

describe('effectiveQueryTimeoutMs', () => {
  it.each([
    [1000, 2000, 1000], [0, 2000, 2000], [1000, null, 1000],
    [2000, 1000, 1000], [0, null, 0], [1000, 1000, 1000],
  ])('connection %s and tenant %s enforce %s ms', (connection, tenant, expected) => {
    expect(effectiveQueryTimeoutMs(connection, tenant)).toBe(expected)
  })
})
