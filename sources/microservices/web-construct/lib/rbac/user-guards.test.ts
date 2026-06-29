import { describe, it, expect } from 'vitest'
import { assertRoleChangeAllowed, assertStatusChangeAllowed } from './user-guards'

describe('assertRoleChangeAllowed', () => {
  const base = { targetUserId: 'u1', currentUserId: 'admin', targetCurrentlyAdmin: true, newRolesIncludeAdmin: true, otherAdminCount: 1 }
  it('allows when admin stays admin', () => {
    expect(() => assertRoleChangeAllowed(base)).not.toThrow()
  })
  it('allows removing admin from someone else when another admin exists', () => {
    expect(() => assertRoleChangeAllowed({ ...base, newRolesIncludeAdmin: false, otherAdminCount: 1 })).not.toThrow()
  })
  it('blocks removing your OWN admin role', () => {
    expect(() => assertRoleChangeAllowed({ ...base, targetUserId: 'admin', newRolesIncludeAdmin: false, otherAdminCount: 5 }))
      .toThrow(/tuo accesso admin/i)
  })
  it('blocks removing the LAST admin', () => {
    expect(() => assertRoleChangeAllowed({ ...base, targetUserId: 'u1', newRolesIncludeAdmin: false, otherAdminCount: 0 }))
      .toThrow(/ultimo amministratore/i)
  })
  it('allows when target was not admin', () => {
    expect(() => assertRoleChangeAllowed({ ...base, targetCurrentlyAdmin: false, newRolesIncludeAdmin: false, otherAdminCount: 0 })).not.toThrow()
  })
})

describe('assertStatusChangeAllowed', () => {
  const base = { targetUserId: 'u1', currentUserId: 'admin', newStatus: 1 as const, targetIsAdmin: false, otherActiveAdminCount: 1 }
  it('allows activating (newStatus=2) unconditionally', () => {
    expect(() => assertStatusChangeAllowed({ ...base, newStatus: 2, targetUserId: 'admin', targetIsAdmin: true, otherActiveAdminCount: 0 })).not.toThrow()
  })
  it('blocks deactivating yourself', () => {
    expect(() => assertStatusChangeAllowed({ ...base, targetUserId: 'admin' })).toThrow(/tuo account/i)
  })
  it('blocks deactivating the last active admin', () => {
    expect(() => assertStatusChangeAllowed({ ...base, targetIsAdmin: true, otherActiveAdminCount: 0 })).toThrow(/ultimo amministratore attivo/i)
  })
  it('allows deactivating a non-admin', () => {
    expect(() => assertStatusChangeAllowed({ ...base, targetIsAdmin: false })).not.toThrow()
  })
  it('allows deactivating an admin when another active admin exists', () => {
    expect(() => assertStatusChangeAllowed({ ...base, targetIsAdmin: true, otherActiveAdminCount: 1 })).not.toThrow()
  })
})
