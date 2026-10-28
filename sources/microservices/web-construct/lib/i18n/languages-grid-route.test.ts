import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Sits above vi.hoisted()/vi.mock() on purpose: Vitest hoists both above every
// import regardless of source position, and the factories below close over
// nothing imported — so this order cannot change which mocks apply.
import { POST } from '@/app/api/i18n/languages-grid/route'

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  listLanguagesPage: vi.fn(),
}))

// Un guasto si registra: il registro vero scriverebbe nell'uscita dei test.
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }))
vi.mock('@/lib/rbac/auth-guard', () => ({ requirePermission: mocks.requirePermission }))
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
    mocks.requirePermission.mockResolvedValue({ userId: 'admin', roleIds: [0, 1], isAdmin: true, permissions: new Set() })
    mocks.listLanguagesPage.mockResolvedValue({ elements: [], total: 0 })
  })

  it('returns 403 when the read permission is missing', async () => {
    mocks.requirePermission.mockRejectedValue(new Error('Unauthorized'))
    const response = await POST(request({ page: 0, size: 50 }))
    expect(response.status).toBe(403)
    expect(mocks.listLanguagesPage).not.toHaveBeenCalled()
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

  it('answers a failure with a generic message, never with the text of the error', async () => {
    mocks.listLanguagesPage.mockRejectedValue(new Error('connection to db-internal-host refused'))
    const response = await POST(request({ page: 0, size: 50 }))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Errore interno.' })
  })
})
