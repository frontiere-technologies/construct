import { describe, expect, it } from 'vitest'
import { FEATURE_KEYS } from '@/lib/tenancy/feature-catalog'
import type { TenantPolicySnapshot } from '@/lib/tenancy/tenant-policy-types'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import type { Actor } from './actor'
import type { PermissionCode } from './permission-catalog'
import {
  assertCanChangeRoles, assertCanChangeStatus, assertCanGrantFunctionalities,
  assertCanGrantPermissions, canChangeRole, canGrantCode, canGrantFunctionality, symmetricDifference,
} from './grant-guards'

function limited(codes: PermissionCode[]): Actor {
  return { userId: 'u1', tenantId: defaultTestTenant(), roleIds: [0, 7], isAdmin: false, isPlatformAdmin: false, features: new Set(FEATURE_KEYS), canManageSupportConsent: false, permissions: new Set(codes) }
}
// Un id che non è 1: l'amministratore si riconosce dall'id del tenant, non da un id fisso.
const TENANT_ADMIN_ID = 57
const admin: Actor = { userId: 'a1', tenantId: defaultTestTenant(), roleIds: [0, 1], isAdmin: true, isPlatformAdmin: false, features: new Set(FEATURE_KEYS), canManageSupportConsent: true, permissions: new Set() }

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
    expect(() => assertCanGrantFunctionalities(limited([]), new Set([3]), [3, 9], context)).toThrow(/9/)
  })

  it('accepts menu entries the actor can see', () => {
    expect(() => assertCanGrantFunctionalities(limited([]), new Set([3, 9]), [3, 9], context)).not.toThrow()
  })
})

describe('assertCanChangeRoles (DEC-29)', () => {
  const reader = limited(['assign-user-roles', 'read-menu'])

  it('refuses to add or remove the Administrator role for a non-administrator', () => {
    expect(() => assertCanChangeRoles(reader, new Set(), [{ idRole: TENANT_ADMIN_ID, codes: [], functionalityIds: [], uncataloguedIds: [] }], TENANT_ADMIN_ID, context))
      .toThrow(/Administrator/)
  })

  it('refuses a role that grants a permission the actor does not hold', () => {
    expect(() => assertCanChangeRoles(reader, new Set(), [{ idRole: 7, codes: ['manage-menu'], functionalityIds: [], uncataloguedIds: [] }], TENANT_ADMIN_ID, context))
      .toThrow(/manage-menu/)
  })

  it('refuses a role that grants a menu entry the actor cannot see', () => {
    expect(() => assertCanChangeRoles(reader, new Set([3]), [{ idRole: 7, codes: [], functionalityIds: [4], uncataloguedIds: [] }], TENANT_ADMIN_ID, context))
      .toThrow(/4/)
  })

  it('refuses a role holding a GRANT row outside the catalog: nobody holds it (M3)', () => {
    expect(() => assertCanChangeRoles(reader, new Set(), [{ idRole: 7, codes: ['read-menu'], functionalityIds: [], uncataloguedIds: [42] }], TENANT_ADMIN_ID, context))
      .toThrow(/outside the catalog: 42/)
  })

  it('accepts a role whose grants the actor holds entirely', () => {
    expect(() => assertCanChangeRoles(reader, new Set([3]), [{ idRole: 7, codes: ['read-menu'], functionalityIds: [3], uncataloguedIds: [] }], TENANT_ADMIN_ID, context))
      .not.toThrow()
  })

  it('lets the Administrator change any role, the Administrator role included', () => {
    expect(() => assertCanChangeRoles(admin, new Set(), [{ idRole: TENANT_ADMIN_ID, codes: [], functionalityIds: [], uncataloguedIds: [] }], TENANT_ADMIN_ID, context)).not.toThrow()
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

  it('rejects a GRANT row without a mapped feature for every actor', () => {
    expect(canGrantCode(limited(['read-menu']), null)).toBe(false)
    expect(canGrantCode(admin, null)).toBe(false)
  })

  it('lets the Administrator grant any code and any menu entry', () => {
    expect(canGrantCode(admin, 'manage-menu')).toBe(true)
    expect(canGrantFunctionality(admin, new Set(), 9, context)).toBe(true)
  })

  it('lets an actor grant only the menu entries it can see', () => {
    expect(canGrantFunctionality(limited([]), new Set([3]), 3, context)).toBe(true)
    expect(canGrantFunctionality(limited([]), new Set([3]), 9, context)).toBe(false)
  })
})

describe('canChangeRole (DEC-29)', () => {
  const reader = limited(['assign-user-roles', 'read-menu'])
  const grants = (over: Partial<{ idRole: number; codes: string[]; functionalityIds: number[]; uncataloguedIds: number[] }>) =>
    ({ idRole: 7, codes: [], functionalityIds: [], uncataloguedIds: [], ...over })

  it('answers as assertCanChangeRoles does, one role at a time', () => {
    expect(canChangeRole(reader, new Set([3]), grants({ codes: ['read-menu'], functionalityIds: [3] }), TENANT_ADMIN_ID, context)).toBe(true)
    expect(canChangeRole(reader, new Set(), grants({ codes: ['manage-menu'] }), TENANT_ADMIN_ID, context)).toBe(false)
    expect(canChangeRole(reader, new Set([3]), grants({ functionalityIds: [4] }), TENANT_ADMIN_ID, context)).toBe(false)
    expect(canChangeRole(reader, new Set(), grants({ uncataloguedIds: [42] }), TENANT_ADMIN_ID, context)).toBe(false)
  })

  it('never offers the Administrator role to a non-administrator', () => {
    expect(canChangeRole(reader, new Set(), grants({ idRole: TENANT_ADMIN_ID }), TENANT_ADMIN_ID, context)).toBe(false)
    expect(canChangeRole(admin, new Set(), grants({ idRole: TENANT_ADMIN_ID }), TENANT_ADMIN_ID, context)).toBe(true)
  })

  it('treats a role with id 1 as an ordinary role when it is not the tenant administrator', () => {
    expect(canChangeRole(reader, new Set(), grants({ idRole: 1 }), TENANT_ADMIN_ID, context)).toBe(true)
  })
})

const policy: TenantPolicySnapshot = {
  revision: 1, areas: { people: true, roles: true, navigation: true, appearance: true, catalogs: true, 'tenant-settings': true },
  overrides: {}, limits: { queryTimeoutMs: null, maxMembers: null, maxRoles: null, maxMenuEntries: null }, enabledFeatures: [...FEATURE_KEYS],
}
const context = { policy, menuBindings: new Map([3, 4, 9].map(id => [id, { areaKey: 'people' as const, featureKey: 'read-users' as const }])) }

describe('tenant grant ceiling', () => {
  it('rejects suspended codes for the administrator', () => {
    expect(canGrantCode({ ...admin, features: new Set(['core-app']) }, 'read-users')).toBe(false)
  })
  it('rejects suspended and missing menu bindings even for the administrator', () => {
    const disabled = { ...context, policy: { ...policy, enabledFeatures: ['core-app'] } satisfies TenantPolicySnapshot }
    expect(canGrantFunctionality(admin, new Set(), 9, disabled)).toBe(false)
    expect(canGrantFunctionality(admin, new Set(), 99, context)).toBe(false)
  })
  it('assigns an existing role using only effective rights and keeps the administrator restriction', () => {
    const disabled = { ...context, policy: { ...policy, enabledFeatures: ['core-app'] } satisfies TenantPolicySnapshot }
    const dormant = { idRole: 7, codes: ['read-users'], functionalityIds: [9], uncataloguedIds: [] }
    expect(canChangeRole(limited([]), new Set(), dormant, TENANT_ADMIN_ID, disabled)).toBe(true)
    expect(canChangeRole(limited([]), new Set(), { ...dormant, idRole: TENANT_ADMIN_ID }, TENANT_ADMIN_ID, disabled)).toBe(false)
  })
})

it('refuses an existing role with a missing menu binding even for the administrator', () => {
  expect(canChangeRole(admin, new Set(), { idRole: 7, codes: [], functionalityIds: [99], uncataloguedIds: [] }, TENANT_ADMIN_ID, context)).toBe(false)
})
