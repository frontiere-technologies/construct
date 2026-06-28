import { describe, it, expect } from 'vitest'
import { computeIsAdmin } from './auth-roles'

describe('computeIsAdmin', () => {
  it('is true when Administrator (1) is present', () => {
    expect(computeIsAdmin([0, 1])).toBe(true)
  })
  it('is false without Administrator', () => {
    expect(computeIsAdmin([0])).toBe(false)
    expect(computeIsAdmin([])).toBe(false)
  })
})
