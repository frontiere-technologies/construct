import { describe, expect, it, vi } from 'vitest'
import { toAuditRow } from './audit-read-service'

// Il lettore vero apre il database e legge la sessione: qui si prova solo la forma della riga.
vi.mock('@/lib/rbac/auth-guard', () => ({ requirePermission: vi.fn() }))
vi.mock('@/lib/db/tenant-db', () => ({ withTenant: vi.fn() }))

describe('toAuditRow', () => {
  const base = {
    id: 7, occurredAt: '2026-07-01T10:00:00.000Z', actorEmail: 'a@example.test', actorKind: 'person',
    operation: 'role.create', objectType: 'role', objectId: '3',
  }

  it('turns the id into text and the time into an ISO string', () => {
    expect(toAuditRow({ ...base, details: {} })).toEqual({
      id: '7', occurredAt: '2026-07-01T10:00:00.000Z', actorEmail: 'a@example.test', actorKind: 'person',
      operation: 'role.create', objectType: 'role', objectId: '3', details: {},
    })
  })

  it('cleans the details again on the way out, at every level', () => {
    const row = toAuditRow({ ...base, details: { name: 'x', Password: 'p', list: [{ apiToken: 't', keep: 1 }], nested: { inviteLink: 'l' } } })
    expect(row.details).toEqual({ name: 'x', list: [{ keep: 1 }], nested: {} })
  })

  it('shows empty details for anything that is not an object', () => {
    expect(toAuditRow({ ...base, details: null }).details).toEqual({})
    expect(toAuditRow({ ...base, details: ['a'] }).details).toEqual({})
    expect(toAuditRow({ ...base, details: 'text' }).details).toEqual({})
  })
})
