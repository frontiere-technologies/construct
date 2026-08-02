import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn() }))

vi.mock('@/lib/rbac/auth-guard', () => ({ requireAdmin: mocks.requireAdmin }))

const { default: AdminLayout } = await import('@/app/(protected)/(admin)/layout')

describe('administrative route layout', () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset()
  })

  it('does not render privileged page content when the live admin guard rejects', async () => {
    mocks.requireAdmin.mockImplementation(async () => {
      throw new Error('Unauthorized')
    })

    let thrown: unknown
    try {
      await AdminLayout({ children: createElement('div', null, 'privileged') })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('Unauthorized')
  })

  it('returns page content after the live admin guard succeeds', async () => {
    mocks.requireAdmin.mockResolvedValue({ userId: 'admin-1', roleIds: [0, 1] })

    const child = createElement('div', null, 'privileged')
    await expect(AdminLayout({ children: child })).resolves.toBe(child)
  })
})
