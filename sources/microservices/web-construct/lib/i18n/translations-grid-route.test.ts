import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listTranslations: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/i18n/translation-service', () => ({ listTranslations: mocks.listTranslations }))

import { POST } from '@/app/api/i18n/translations-grid/route'

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/i18n/translations-grid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

describe('POST /api/i18n/translations-grid', () => {
  beforeEach(() => {
    mocks.listTranslations.mockClear()
    mocks.auth.mockResolvedValue({ user: { id: 'admin', isAdmin: true } })
    mocks.listTranslations.mockResolvedValue({ elements: [], total: 0 })
  })

  it.each([
    ['a malformed updated date', { updatedTo: '2026-02-30' }],
    ['an inverted updated range', { updatedFrom: '2026-07-31', updatedTo: '2026-07-01' }],
    ['the unsupported terminal updated-to date', { updatedTo: '9999-12-31' }],
    ['an invalid status', { status: 'partial' }],
    ['an invalid value search', { valueSearches: { en: { operator: 'AND', conditions: [] } } }],
  ])('returns 400 for %s before it reaches the service', async (_label, invalid) => {
    const response = await POST(request({ page: 0, size: 50, ...invalid }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Corpo della richiesta non valido.' })
    expect(mocks.listTranslations).not.toHaveBeenCalled()
  })

  it('passes a valid complete payload to the service', async () => {
    const payload = {
      page: 0, size: 50,
      search: 'common', descriptionSearch: 'button', valueSearches: { en: 'save' },
      languageCode: 'en', namespace: 'common', module: 'actions', status: 'missing',
      updatedFrom: '2026-07-01', updatedTo: '2026-07-30', sort: 'updatedAt', direction: 'DESC',
    }

    const response = await POST(request(payload))

    expect(response.status).toBe(200)
    expect(mocks.listTranslations).toHaveBeenCalledWith(payload)
  })
})
