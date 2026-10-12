import { describe, expect, it } from 'vitest'
import type { Actor } from './actor'
import type { PermissionCode } from './permission-catalog'
import {
  assertCanChangeRoles, assertCanChangeStatus, assertCanGrantFunctionalities,
  assertCanGrantPermissions, symmetricDifference,
} from './grant-guards'

function limited(codes: PermissionCode[]): Actor {
  return { userId: 'u1', roleIds: [0, 7], isAdmin: false, permissions: new Set(codes) }
}
const admin: Actor = { userId: 'a1', roleIds: [0, 1], isAdmin: true, permissions: new Set() }

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
    expect(() => assertCanChangeRoles(reader, new Set(), [{ idRole: 1, codes: [], functionalityIds: [] }]))
      .toThrow(/Administrator/)
  })

  it('refuses a role that grants a permission the actor does not hold', () => {
    expect(() => assertCanChangeRoles(reader, new Set(), [{ idRole: 7, codes: ['manage-menu'], functionalityIds: [] }]))
      .toThrow(/manage-menu/)
  })

  it('refuses a role that grants a menu entry the actor cannot see', () => {
    expect(() => assertCanChangeRoles(reader, new Set([3]), [{ idRole: 7, codes: [], functionalityIds: [4] }]))
      .toThrow(/4/)
  })

  it('accepts a role whose grants the actor holds entirely', () => {
    expect(() => assertCanChangeRoles(reader, new Set([3]), [{ idRole: 7, codes: ['read-menu'], functionalityIds: [3] }]))
      .not.toThrow()
  })

  it('lets the Administrator change any role, the Administrator role included', () => {
    expect(() => assertCanChangeRoles(admin, new Set(), [{ idRole: 1, codes: [], functionalityIds: [] }])).not.toThrow()
  })
})

describe('assertCanChangeStatus (DEC-29)', () => {
  it('refuses a non-administrator changing the status of an administrator', () => {
    expect(() => assertCanChangeStatus(limited(['set-user-status']), true)).toThrow()
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
