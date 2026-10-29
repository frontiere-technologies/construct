import { describe, expect, it } from 'vitest'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import { buildActor, hasPermission } from './actor'
import { PERMISSION_CODES } from './permission-catalog'

const active = { accountActive: true, roleIds: [0, 7], isAdmin: false, isPlatformAdmin: false }
const CATALOG_WRITES = ['manage-languages', 'edit-translations', 'manage-translation-keys']

describe('buildActor', () => {
  it('keeps only the catalog codes the roles grant', () => {
    const actor = buildActor('u1', defaultTestTenant(), active, ['read-menu', 'read-roles'])
    expect(actor && [...actor.permissions].sort()).toEqual(['read-menu', 'read-roles'])
  })

  it('carries the tenant it was built for', () => {
    expect(buildActor('u1', defaultTestTenant(), active, [])?.tenantId).toBe(defaultTestTenant())
  })

  it('ignores a code that is not in the catalog: a database row the source no longer knows', () => {
    const actor = buildActor('u1', defaultTestTenant(), active, ['read-menu', 'export-files'])
    expect(actor && [...actor.permissions]).toEqual(['read-menu'])
  })

  it('gives the Administrator every catalog code, with or without rows (DEC-5)', () => {
    const actor = buildActor('u1', defaultTestTenant(), { accountActive: true, roleIds: [0, 1], isAdmin: true, isPlatformAdmin: false }, [])
    expect(actor && [...actor.permissions].sort()).toEqual([...PERMISSION_CODES].sort())
  })

  // I cataloghi globali di lingue e traduzioni sono della piattaforma (MT5-DEC-17): nessuna regola
  // sul tenant predefinito. I loro permessi restano nel catalogo ma nessuna porta li chiede più
  // (le scritture chiedono l'amministratore di piattaforma): il tenant non li concede né li toglie.
  it('does not treat the global catalog permissions specially in any tenant', () => {
    const admin = buildActor('u1', defaultTestTenant(), { accountActive: true, roleIds: [0, 1], isAdmin: true, isPlatformAdmin: false }, [])
    expect(admin && [...admin.permissions].sort()).toEqual([...PERMISSION_CODES].sort())
    const granted = buildActor('u1', defaultTestTenant(), active, ['read-menu', ...CATALOG_WRITES])
    expect(granted && [...granted.permissions].sort()).toEqual(['read-menu', ...CATALOG_WRITES].sort())
  })

  it('returns no actor for a deactivated account, whatever its roles grant', () => {
    expect(buildActor('u1', defaultTestTenant(), { accountActive: false, roleIds: [], isAdmin: false, isPlatformAdmin: false }, ['read-menu'])).toBeNull()
  })
})

describe('buildActor and the platform admin attribute', () => {
  it('carries the attribute without turning it into a tenant permission', () => {
    const actor = buildActor('u1', defaultTestTenant(), { ...active, isPlatformAdmin: true }, ['read-menu'])
    expect(actor?.isPlatformAdmin).toBe(true)
    expect(actor && [...actor.permissions]).toEqual(['read-menu'])
    expect(buildActor('u1', defaultTestTenant(), active, [])?.isPlatformAdmin).toBe(false)
  })
})

describe('hasPermission', () => {
  it('is false without an actor', () => {
    expect(hasPermission(null, 'read-menu')).toBe(false)
  })

  it('reads the permission set', () => {
    const actor = buildActor('u1', defaultTestTenant(), active, ['read-menu'])
    expect(hasPermission(actor, 'read-menu')).toBe(true)
    expect(hasPermission(actor, 'manage-menu')).toBe(false)
  })
})
