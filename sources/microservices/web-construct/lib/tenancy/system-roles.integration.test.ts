import { expect, it } from 'vitest'
import { withTenant } from '@/lib/db/tenant-db'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { getSystemRoleIds } from './system-roles'
import { resolveRequestTenant } from './request-tenant'
import { defaultTestTenant } from './testing'

describeIntegration('tenant context', () => {
  it('resolves the request tenant from the tenant table', async () => {
    expect(await resolveRequestTenant()).toBe(defaultTestTenant())
  })

  it('finds the system roles of the tenant by key', async () => {
    expect(await withTenant(defaultTestTenant(), getSystemRoleIds)).toEqual({ registered: 0, tenantAdmin: 1 })
  })
})
