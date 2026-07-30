import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listRoles: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/rbac/roles-service', () => ({ listRoles: mocks.listRoles }))

import { POST } from '@/app/api/rbac/roles-grid/route'

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/rbac/roles-grid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

describe('POST /api/rbac/roles-grid', () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ user: { id: 'admin', isAdmin: true } })
    mocks.listRoles.mockResolvedValue({ elements: [], total: 0, pagination: { currentElements: 0, currentPage: 0, totalPages: 1 } })
  })

  it('returns 400 for a malformed date before it reaches the service', async () => {
    const response = await POST(request({ page: 0, size: 50, startDateMod: '2026-02-30', sort: 'id', direction: 'ASC' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Corpo della richiesta non valido.' })
    expect(mocks.listRoles).not.toHaveBeenCalled()
  })

  it.each([
    ['an inverted ID range', { idMin: 20, idMax: 10 }],
    ['an inverted associated-users range', { associatedUsersMin: 4, associatedUsersMax: 3 }],
    ['an inverted created-date range', { startDateIns: '2026-07-31', endDateIns: '2026-07-01' }],
    ['an inverted updated-date range', { startDateMod: '2026-07-31', endDateMod: '2026-07-01' }],
    ['the terminal created upper date', { endDateIns: '9999-12-31' }],
    ['the terminal updated upper date', { endDateMod: '9999-12-31' }],
  ])('returns 400 for %s before it reaches the service', async (_label, range) => {
    const response = await POST(request({ page: 0, size: 50, sort: 'id', direction: 'ASC', ...range }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Corpo della richiesta non valido.' })
    expect(mocks.listRoles).not.toHaveBeenCalled()
  })

  it('accepts a valid full filter payload', async () => {
    const payload = {
      page: 0, size: 50, search: 'admin', hasPermission: true,
      idMin: 10, idMax: 20, associatedUsersMin: 3, associatedUsersMax: 3,
      startDateIns: '2026-06-01', endDateIns: '2026-06-30',
      startDateMod: '2026-07-01', endDateMod: '2026-07-30', sort: 'id', direction: 'ASC',
    }

    const response = await POST(request(payload))

    expect(response.status).toBe(200)
    expect(mocks.listRoles).toHaveBeenCalledWith(payload)
  })
})
