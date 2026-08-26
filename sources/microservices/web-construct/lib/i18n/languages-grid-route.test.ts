import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/i18n/languages-grid/route'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listLanguagesPage: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/i18n/language-service', () => ({ listLanguagesPage: mocks.listLanguagesPage }))

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/i18n/languages-grid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

describe('POST /api/i18n/languages-grid', () => {
  beforeEach(() => {
    mocks.listLanguagesPage.mockClear()
    mocks.auth.mockResolvedValue({ user: { id: 'admin', isAdmin: true } })
    mocks.listLanguagesPage.mockResolvedValue({ elements: [], total: 0 })
  })

  it.each([
    ['a malformed date', { createdTo: '2026-02-30' }],
    ['an inverted count range', { translatedMin: 20, translatedMax: 10 }],
    ['an inverted date range', { createdFrom: '2026-07-30', createdTo: '2026-07-01' }],
    ['the unsupported terminal created-to date', { createdTo: '9999-12-31' }],
    ['a non-finite count', { missingMin: Number.NaN }],
    ['an invalid boolean', { isDefault: 'false' }],
  ])('returns 400 for %s before it reaches the service', async (_label, invalid) => {
    const response = await POST(request({ page: 0, size: 50, ...invalid }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Corpo della richiesta non valido.' })
    expect(mocks.listLanguagesPage).not.toHaveBeenCalled()
  })

  it('passes a valid complete payload to the service', async () => {
    const payload = {
      page: 0, size: 50,
      codeSearch: 'it', localeSearch: 'IT', nameSearch: 'Italian', nativeNameSearch: 'Italiano',
      isActive: true, isDefault: false,
      translatedMin: 10, translatedMax: 20, missingMin: 2, missingMax: 3,
      createdFrom: '2026-07-01', createdTo: '2026-07-30',
      sort: 'nativeName', direction: 'DESC',
    }

    const response = await POST(request(payload))

    expect(response.status).toBe(200)
    expect(mocks.listLanguagesPage).toHaveBeenCalledWith(payload)
  })
})
