import { afterAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { AREA_KEYS, FEATURE_KEYS } from './feature-catalog'
import { createPolicyFixture } from './policy-test-fixture'
import { readTenantPolicy, selectTenantPolicy } from './tenant-policy-service'
import { lockTenantPolicy } from './tenant-policy-lock'
import { defaultTestTenant, tenantIdForTest } from './testing'

describeIntegration('tenant policy service', () => {
  afterAll(closeOwner)

  it('preserves current access in the initial snapshot', async () => {
    const fixture = await createPolicyFixture('initial')
    try {
      const policy = await readTenantPolicy(fixture.tenantId)
      expect(policy.revision).toBe(1)
      expect((await readTenantPolicy(defaultTestTenant())).limits).toEqual(policy.limits)
      expect((await readTenantPolicy(defaultTestTenant())).areas).toEqual(policy.areas)
      expect(Object.values(policy.areas)).toEqual(AREA_KEYS.map(() => true))
      expect(policy.overrides).toEqual({})
      expect(policy.limits).toEqual({ queryTimeoutMs: null, maxMembers: null, maxRoles: null, maxMenuEntries: null })
      expect(policy.enabledFeatures).toEqual([...FEATURE_KEYS])
      expect(await withTenant(fixture.tenantId, selectTenantPolicy)).toEqual(policy)
    } finally { await fixture.close() }
  })

  it('applies overrides and dependency closure without disabling the essential core', async () => {
    const fixture = await createPolicyFixture('dependencies')
    try {
      await withOwner(async tx => {
        await tx.execute(sql`update public.tenant_area_entitlement set enabled = false where area_code in ('people', 'roles')`)
        await tx.execute(sql`insert into public.tenant_entitlement (feature_code, allowed) values
          ('invite-users', true), ('assign-user-roles', true), ('core-app', false)`)
      }, fixture.tenantId)
      const policy = await readTenantPolicy(fixture.tenantId)
      expect(policy.enabledFeatures).not.toContain('invite-users')
      expect(policy.enabledFeatures).not.toContain('assign-user-roles')
      expect(policy.enabledFeatures).toContain('core-app')
      await withOwner(tx => tx.execute(sql`insert into public.tenant_entitlement (feature_code, allowed) values ('read-users', true)`), fixture.tenantId)
      const updated = await readTenantPolicy(fixture.tenantId)
      expect(updated.enabledFeatures).toContain('invite-users')
      expect(updated.enabledFeatures).not.toContain('assign-user-roles')
      const codes = await withTenant(fixture.tenantId, tx => tx.execute<{ code: string }>(sql`select code from app_private.effective_tenant_feature_codes()`))
      expect(codes.map(row => row.code).sort()).toEqual([...updated.enabledFeatures].sort())
    } finally { await fixture.close() }
  })

  it('locks the full bigint tenant id and releases the policy lock on rollback', async () => {
    // Oltre int32: nessuna conversione o collisione con l'id basso.
    await expect(withOwner(async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', '4294967297', true)`)
      await tx.execute(sql`select app_private.lock_tenant_policy()`)
      throw new Error('rollback-lock')
    })).rejects.toThrow('rollback-lock')
    await withTenant(tenantIdForTest(4294967297), async tx => {
      await lockTenantPolicy(tx)
      await withTenant(defaultTestTenant(), async other => {
        await other.execute(sql`set local lock_timeout = '200ms'`)
        await lockTenantPolicy(other)
      })
    })
  })

  it('serializes writes for the same tenant, allows other tenants and ordinary reads', async () => {
    const a = await createPolicyFixture('lock-a')
    const b = await createPolicyFixture('lock-b')
    let release!: () => void
    let locked!: () => void
    const acquired = new Promise<void>(resolve => { locked = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    const first = withTenant(a.tenantId, async tx => { await lockTenantPolicy(tx); locked(); await held })
    try {
      await acquired
      await withTenant(b.tenantId, async tx => { await tx.execute(sql`set local lock_timeout = '200ms'`); await lockTenantPolicy(tx) })
      await readTenantPolicy(a.tenantId)
      await expect(withTenant(a.tenantId, async tx => {
        await tx.execute(sql`set local lock_timeout = '200ms'`)
        await lockTenantPolicy(tx)
      })).rejects.toMatchObject({ cause: { code: '55P03' } })
      for (const operation of [
        sql`select public.set_membership_status_guarded(${a.adminId}::uuid, 'active')`,
        sql`select public.replace_user_roles_guarded(${a.adminId}::uuid, '{}'::bigint[])`,
      ]) {
        await expect(withTenant(a.tenantId, async tx => {
          await tx.execute(sql`set local lock_timeout = '200ms'`)
          await tx.execute(operation)
        })).rejects.toMatchObject({ cause: { code: '55P03' } })
      }
    } finally { release(); await first; await a.close(); await b.close() }
  })
})
