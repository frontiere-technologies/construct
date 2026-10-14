import { describe, expect, it } from 'vitest'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import type { Actor } from './actor'
import type { PermissionCode } from './permission-catalog'
import {
  assertCanChangeRoles, assertCanChangeStatus, assertCanGrantFunctionalities,
  assertCanGrantPermissions, canChangeRole, canGrantCode, canGrantFunctionality, symmetricDifference,
} from './grant-guards'

function limited(codes: PermissionCode[]): Actor {
  return { userId: 'u1', tenantId: defaultTestTenant(), roleIds: [0, 7], isAdmin: false, permissions: new Set(codes) }
}
const admin: Actor = { userId: 'a1', tenantId: defaultTestTenant(), roleIds: [0, 1], isAdmin: true, permissions: new Set() }

describe('assertCanGrantPermissions (DEC-6)', () => {
  it('lets an actor grant what it holds', () => {
    expect(() => assertCanGrantPermissions(limited(['read-menu', 'grant-role-permissions']), ['read-menu'])).not.toThrow()
  })

  it('refuses a code the actor does not hold, and names it', () => {
    expect(() => assertCanGrantPermissions(limited(['grant-role-permissions']), ['manage-menu']))
      .toThrow(/manage-menu/)
  })

  it('lets the Administrator grant anything', () => {
    expect(() => assertCanGrantPermissions(admin, ['manage-menu', 'read-users'])).not.toThrow()
  })
})

describe('assertCanGrantFunctionalities (DEC-29)', () => {
  it('refuses a menu entry the actor cannot see', () => {
    expect(() => assertCanGrantFunctionalities(limited([]), new Set([3]), [3, 9])).toThrow(/9/)
  })

  it('accepts menu entries the actor can see', () => {
    expect(() => assertCanGrantFunctionalities(limited([]), new Set([3, 9]), [3, 9])).not.toThrow()
  })
})

describe('assertCanChangeRoles (DEC-29)', () => {
  const reader = limited(['assign-user-roles', 'read-menu'])

  it('refuses to add or remove the Administrator role for a non-administrator', () => {
    expect(() => assertCanChangeRoles(reader, new Set(), [{ idRole: 1, codes: [], functionalityIds: [], uncataloguedIds: [] }]))
      .toThrow(/Administrator/)
  })

  it('refuses a role that grants a permission the actor does not hold', () => {
    expect(() => assertCanChangeRoles(reader, new Set(), [{ idRole: 7, codes: ['manage-menu'], functionalityIds: [], uncataloguedIds: [] }]))
      .toThrow(/manage-menu/)
  })

  it('refuses a role that grants a menu entry the actor cannot see', () => {
    expect(() => assertCanChangeRoles(reader, new Set([3]), [{ idRole: 7, codes: [], functionalityIds: [4], uncataloguedIds: [] }]))
      .toThrow(/4/)
  })

  it('refuses a role holding a GRANT row outside the catalog: nobody holds it (M3)', () => {
    expect(() => assertCanChangeRoles(reader, new Set(), [{ idRole: 7, codes: ['read-menu'], functionalityIds: [], uncataloguedIds: [42] }]))
      .toThrow(/outside the catalog: 42/)
  })

  it('accepts a role whose grants the actor holds entirely', () => {
    expect(() => assertCanChangeRoles(reader, new Set([3]), [{ idRole: 7, codes: ['read-menu'], functionalityIds: [3], uncataloguedIds: [] }]))
      .not.toThrow()
  })

  it('lets the Administrator change any role, the Administrator role included', () => {
    expect(() => assertCanChangeRoles(admin, new Set(), [{ idRole: 1, codes: [], functionalityIds: [], uncataloguedIds: [] }])).not.toThrow()
  })
})

describe('assertCanChangeStatus (DEC-29)', () => {
  it('refuses a non-administrator changing the status of an administrator', () => {
    expect(() => assertCanChangeStatus(limited(['set-user-status']), true)).toThrow(/administrator/)
  })

  it('accepts a non-administrator changing the status of a normal user', () => {
    expect(() => assertCanChangeStatus(limited(['set-user-status']), false)).not.toThrow()
  })

  it('accepts the Administrator in every case', () => {
    expect(() => assertCanChangeStatus(admin, true)).not.toThrow()
  })
})

describe('symmetricDifference', () => {
  it('returns what was added and what was removed, once each', () => {
    expect(symmetricDifference([0, 1, 5], [0, 5, 7]).sort()).toEqual([1, 7])
  })
})

// I3 della revisione finale: la pagina chiede in anticipo che cosa offrire, con le stesse regole
// che l'azione applica al salvataggio. I predicati sono la regola; le assert li usano.
describe('canGrantCode / canGrantFunctionality (DEC-6, DEC-29)', () => {
  it('lets an actor grant a code it holds, and nothing else', () => {
    const reader = limited(['read-menu'])
    expect(canGrantCode(reader, 'read-menu')).toBe(true)
    expect(canGrantCode(reader, 'manage-menu')).toBe(false)
  })

  it('treats a GRANT row without a code as held by nobody but the Administrator', () => {
    expect(canGrantCode(limited(['read-menu']), null)).toBe(false)
    expect(canGrantCode(admin, null)).toBe(true)
  })

  it('lets the Administrator grant any code and any menu entry', () => {
    expect(canGrantCode(admin, 'manage-menu')).toBe(true)
    expect(canGrantFunctionality(admin, new Set(), 9)).toBe(true)
  })

  it('lets an actor grant only the menu entries it can see', () => {
    expect(canGrantFunctionality(limited([]), new Set([3]), 3)).toBe(true)
    expect(canGrantFunctionality(limited([]), new Set([3]), 9)).toBe(false)
  })
})

describe('canChangeRole (DEC-29)', () => {
  const reader = limited(['assign-user-roles', 'read-menu'])
  const grants = (over: Partial<{ idRole: number; codes: string[]; functionalityIds: number[]; uncataloguedIds: number[] }>) =>
    ({ idRole: 7, codes: [], functionalityIds: [], uncataloguedIds: [], ...over })

  it('answers as assertCanChangeRoles does, one role at a time', () => {
    expect(canChangeRole(reader, new Set([3]), grants({ codes: ['read-menu'], functionalityIds: [3] }))).toBe(true)
    expect(canChangeRole(reader, new Set(), grants({ codes: ['manage-menu'] }))).toBe(false)
    expect(canChangeRole(reader, new Set([3]), grants({ functionalityIds: [4] }))).toBe(false)
    expect(canChangeRole(reader, new Set(), grants({ uncataloguedIds: [42] }))).toBe(false)
  })

  it('never offers the Administrator role to a non-administrator', () => {
    expect(canChangeRole(reader, new Set(), grants({ idRole: 1 }))).toBe(false)
    expect(canChangeRole(admin, new Set(), grants({ idRole: 1 }))).toBe(true)
  })
})
