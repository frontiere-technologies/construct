import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listUsers: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/rbac/users-service', () => ({ listUsers: mocks.listUsers }))

import { POST } from '@/app/api/rbac/users-grid/route'

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/rbac/users-grid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

describe('POST /api/rbac/users-grid', () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ user: { id: 'admin', isAdmin: true } })
    mocks.listUsers.mockImplementation(async (query: { updatedTo?: string }) => {
      if (query.updatedTo === 'not-a-date') throw new RangeError('Invalid time value')
      return { users: [], total: 0 }
    })
  })

  it('returns 400 for malformed date filters before they reach the service', async () => {
    const response = await POST(request({ page: 0, size: 50, sort: 'dateIns', direction: 'DESC', updatedTo: 'not-a-date' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Corpo della richiesta non valido.' })
  })

  it.each(['createdTo', 'updatedTo'])('returns 400 for the terminal %s date before it reaches the service', async field => {
    const response = await POST(request({ page: 0, size: 50, sort: 'dateIns', direction: 'DESC', [field]: '9999-12-31' }))

    expect(response.status).toBe(400)
    expect(mocks.listUsers).not.toHaveBeenCalled()
  })

  it('accepts a valid complete payload', async () => {
    const response = await POST(request({
      page: 0, size: 50, nameSearch: 'Mario', emailSearch: 'mario@frontiere.it', roleIds: [1], statuses: [2],
      createdFrom: '2026-07-01', createdTo: '2026-07-15', updatedFrom: '2026-07-16', updatedTo: '2026-07-30',
      sort: 'email', direction: 'ASC',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ users: [], total: 0 })
  })
})
