import { describe, expect, it } from 'vitest'
import { buildActor, hasPermission } from './actor'
import { PERMISSION_CODES } from './permission-catalog'

const active = { accountActive: true, roleIds: [0, 7], isAdmin: false }

describe('buildActor', () => {
  it('keeps only the catalog codes the roles grant', () => {
    const actor = buildActor('u1', active, ['read-menu', 'read-roles'])
    expect(actor && [...actor.permissions].sort()).toEqual(['read-menu', 'read-roles'])
  })

  it('ignores a code that is not in the catalog: a database row the source no longer knows', () => {
    const actor = buildActor('u1', active, ['read-menu', 'export-files'])
    expect(actor && [...actor.permissions]).toEqual(['read-menu'])
  })

  it('gives the Administrator every catalog code, with or without rows (DEC-5)', () => {
    const actor = buildActor('u1', { accountActive: true, roleIds: [0, 1], isAdmin: true }, [])
    expect(actor && [...actor.permissions].sort()).toEqual([...PERMISSION_CODES].sort())
  })

  it('returns no actor for a deactivated account, whatever its roles grant', () => {
    expect(buildActor('u1', { accountActive: false, roleIds: [], isAdmin: false }, ['read-menu'])).toBeNull()
  })
})

describe('hasPermission', () => {
  it('is false without an actor', () => {
    expect(hasPermission(null, 'read-menu')).toBe(false)
  })

  it('reads the permission set', () => {
    const actor = buildActor('u1', active, ['read-menu'])
    expect(hasPermission(actor, 'read-menu')).toBe(true)
    expect(hasPermission(actor, 'manage-menu')).toBe(false)
  })
})
