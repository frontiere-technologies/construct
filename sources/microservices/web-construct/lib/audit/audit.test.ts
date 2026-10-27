import { describe, expect, it } from 'vitest'
import { defaultTestTenant } from '@/lib/tenancy/testing'
import type { Actor } from '@/lib/rbac/actor'
import { auditActorOf, sanitizeAuditDetails } from './audit-types'

describe('sanitizeAuditDetails', () => {
  it('details never contain password, token or link keys', () => {
    const cleaned = sanitizeAuditDetails({
      name: 'Redattori',
      password: 'x',
      passwordHash: 'x',
      resetToken: 'x',
      TOKEN: 'x',
      inviteLink: 'https://example.test/set-password?token=x',
      clientSecret: 'x',
      nested: { keep: 1, setPasswordLink: 'x', deeper: [{ secret: 'x', ok: true }] },
      list: [{ token: 'x', fine: 2 }],
    })
    expect(cleaned).toEqual({ name: 'Redattori', nested: { keep: 1, deeper: [{ ok: true }] }, list: [{ fine: 2 }] })
  })

  it('keeps the essential values and drops undefined ones', () => {
    expect(sanitizeAuditDetails({ before: { name: 'a' }, after: { name: 'b' }, gone: undefined, empty: null, n: 0 }))
      .toEqual({ before: { name: 'a' }, after: { name: 'b' }, empty: null, n: 0 })
  })

  it('answers an empty object when there are no details', () => {
    expect(sanitizeAuditDetails(undefined)).toEqual({})
  })
})

describe('auditActorOf', () => {
  it('presents a tenant actor as a person, whose email is read from the account when the row is written', () => {
    const actor: Actor = {
      userId: 'u1', tenantId: defaultTestTenant(), roleIds: [], isAdmin: true, isPlatformAdmin: false, permissions: new Set(),
    }
    expect(auditActorOf(actor)).toEqual({ userId: 'u1', email: null, kind: 'person' })
  })

  it('presents a platform admin acting from the console as the platform, with the email', () => {
    expect(auditActorOf({ userId: 'u2', email: 'admin@example.test' }))
      .toEqual({ userId: 'u2', email: 'admin@example.test', kind: 'platform' })
  })

  it('decides by the tenant the actor is bound to, not by which other fields it carries', () => {
    const tenantActor = {
      userId: 'u3', tenantId: defaultTestTenant(), roleIds: [], isAdmin: false, isPlatformAdmin: false,
      permissions: new Set<never>(), email: 'would-be-extra-field@example.test',
    }
    expect(auditActorOf(tenantActor)).toEqual({ userId: 'u3', email: null, kind: 'person' })
  })
})
