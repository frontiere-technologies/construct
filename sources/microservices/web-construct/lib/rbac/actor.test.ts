import { describe, expect, it } from 'vitest'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import { buildActor, hasPermission } from './actor'
import { PERMISSION_CODES } from './permission-catalog'

const active = { accountActive: true, roleIds: [0, 7], isAdmin: false, isPlatformAdmin: false }
// Il tenant dell'attore è il predefinito (slug 'default') o un altro.
const IN_DEFAULT = { defaultTenant: true }
const ELSEWHERE = { defaultTenant: false }
const CATALOG_WRITES = ['manage-languages', 'edit-translations', 'manage-translation-keys']

describe('buildActor', () => {
  it('keeps only the catalog codes the roles grant', () => {
    const actor = buildActor('u1', defaultTestTenant(), active, ['read-menu', 'read-roles'], IN_DEFAULT)
    expect(actor && [...actor.permissions].sort()).toEqual(['read-menu', 'read-roles'])
  })

  it('carries the tenant it was built for', () => {
    expect(buildActor('u1', defaultTestTenant(), active, [], IN_DEFAULT)?.tenantId).toBe(defaultTestTenant())
  })

  it('ignores a code that is not in the catalog: a database row the source no longer knows', () => {
    const actor = buildActor('u1', defaultTestTenant(), active, ['read-menu', 'export-files'], IN_DEFAULT)
    expect(actor && [...actor.permissions]).toEqual(['read-menu'])
  })

  it('gives the Administrator every catalog code, with or without rows (DEC-5)', () => {
    const actor = buildActor('u1', defaultTestTenant(), { accountActive: true, roleIds: [0, 1], isAdmin: true, isPlatformAdmin: false }, [], IN_DEFAULT)
    expect(actor && [...actor.permissions].sort()).toEqual([...PERMISSION_CODES].sort())
  })

  // Fino al pezzo 5 i cataloghi globali di lingue e traduzioni si scrivono solo dal tenant
  // predefinito (MT2-DEC-11; specifica 2026-10-21, §5.3).
  it('outside the default tenant the Administrator gets every code except the global catalog writes', () => {
    const actor = buildActor('u1', defaultTestTenant(), { accountActive: true, roleIds: [0, 1], isAdmin: true, isPlatformAdmin: false }, [], ELSEWHERE)
    expect(actor && [...actor.permissions].sort())
      .toEqual(PERMISSION_CODES.filter(code => !CATALOG_WRITES.includes(code)).sort())
    expect(actor?.isAdmin).toBe(true)
  })

  it('outside the default tenant a granted global catalog write does not count', () => {
    const actor = buildActor('u1', defaultTestTenant(), active, ['read-menu', ...CATALOG_WRITES], ELSEWHERE)
    expect(actor && [...actor.permissions]).toEqual(['read-menu'])
  })

  it('in the default tenant a granted global catalog write counts', () => {
    const actor = buildActor('u1', defaultTestTenant(), active, ['read-menu', ...CATALOG_WRITES], IN_DEFAULT)
    expect(actor && [...actor.permissions].sort()).toEqual(['read-menu', ...CATALOG_WRITES].sort())
  })

  it('returns no actor for a deactivated account, whatever its roles grant', () => {
    expect(buildActor('u1', defaultTestTenant(), { accountActive: false, roleIds: [], isAdmin: false, isPlatformAdmin: false }, ['read-menu'], IN_DEFAULT)).toBeNull()
  })
})

describe('buildActor and the platform admin attribute', () => {
  it('carries the attribute without turning it into a tenant permission', () => {
    const actor = buildActor('u1', defaultTestTenant(), { ...active, isPlatformAdmin: true }, ['read-menu'], ELSEWHERE)
    expect(actor?.isPlatformAdmin).toBe(true)
    expect(actor && [...actor.permissions]).toEqual(['read-menu'])
    expect(buildActor('u1', defaultTestTenant(), active, [], IN_DEFAULT)?.isPlatformAdmin).toBe(false)
  })
})

describe('hasPermission', () => {
  it('is false without an actor', () => {
    expect(hasPermission(null, 'read-menu')).toBe(false)
  })

  it('reads the permission set', () => {
    const actor = buildActor('u1', defaultTestTenant(), active, ['read-menu'], IN_DEFAULT)
    expect(hasPermission(actor, 'read-menu')).toBe(true)
    expect(hasPermission(actor, 'manage-menu')).toBe(false)
  })
})
