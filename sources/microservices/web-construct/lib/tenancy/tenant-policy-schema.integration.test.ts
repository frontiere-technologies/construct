import { afterAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { AREA_KEYS, FEATURE_CATALOG } from './feature-catalog'
import { createPolicyFixture } from './policy-test-fixture'

const TABLES = ['tenant_platform_policy', 'tenant_area_entitlement', 'tenant_entitlement'] as const

describeIntegration('protected tenant policy schema', () => {
  afterAll(closeOwner)

  it('stores exactly the global T01 catalog, permission references and dependencies', async () => {
    const areas = await withGlobal(tx => tx.execute<{ code: string }>(sql`select code from public.feature_area order by code`))
    expect(areas.map(row => row.code)).toEqual([...AREA_KEYS].sort())
    const features = await withGlobal(tx => tx.execute<{ key: string; area: string | null; permission: string | null }>(sql`
      select f.code as key, f.area_code as area, p.code as permission from public.app_feature f
      left join public.permission p on p.id_permission = f.id_permission order by f.code`))
    expect(features).toEqual(FEATURE_CATALOG.map(({ key, area, permission }) => ({ key, area, permission })).sort((a, b) => a.key.localeCompare(b.key)))
    const dependencies = await withGlobal(tx => tx.execute<{ feature: string; dependency: string }>(sql`
      select feature_code as feature, dependency_code as dependency from public.app_feature_dependency order by 1, 2`))
    expect(dependencies).toEqual(FEATURE_CATALOG.flatMap(f => f.dependencies.map(dependency => ({ feature: f.key, dependency })))
      .sort((a, b) => a.feature.localeCompare(b.feature) || a.dependency.localeCompare(b.dependency)))
  })

  it('rejects every runtime write, including empty updates and deletes, while isolating reads', async () => {
    const a = await createPolicyFixture('schema-a')
    const b = await createPolicyFixture('schema-b')
    try {
      for (const fixture of [a, b]) await withOwner(tx => tx.execute(sql`insert into public.tenant_entitlement (feature_code, allowed) values ('read-users', false)`), fixture.tenantId)
      for (const table of TABLES) {
        const rows = await withTenant(a.tenantId, tx => tx.execute<{ id_tenant: string }>(sql`select id_tenant::text from ${sql.identifier(table)}`))
        expect(rows.length).toBeGreaterThan(0)
        await expect(withGlobal(tx => tx.execute(sql`select * from ${sql.identifier(table)}`))).rejects.toMatchObject({ cause: { code: '42501', message: 'tenant context missing' } })
        expect(rows.every(row => row.id_tenant === String(a.tenantId))).toBe(true)
        expect(await withTenant(a.tenantId, tx => tx.execute(sql`select * from ${sql.identifier(table)} where id_tenant = ${b.tenantId}`))).toHaveLength(0)
        for (const statement of [sql`delete from ${sql.identifier(table)} where false`, sql`update ${sql.identifier(table)} set id_tenant = id_tenant where false`,
          sql`insert into ${sql.identifier(table)} (id_tenant) values (${a.tenantId})`]) {
          await expect(withTenant(a.tenantId, tx => tx.execute(statement))).rejects.toMatchObject({ cause: { code: '42501' } })
        }
      }
      for (const table of ['feature_area', 'app_feature', 'app_feature_dependency']) {
        await expect(withGlobal(tx => tx.execute(sql`delete from ${sql.identifier(table)} where false`))).rejects.toMatchObject({ cause: { code: '42501' } })
      }
    } finally { await a.close(); await b.close() }
  })

  it('rejects unknown keys, invalid limits and revisions through owner writes', async () => {
    const fixture = await createPolicyFixture('constraints')
    try {
      for (const [statement, code] of [
        [sql`insert into public.tenant_entitlement (feature_code, allowed) values ('unknown', true)`, '23503'],
        [sql`insert into public.tenant_area_entitlement (area_code, enabled) values ('unknown', true)`, '23503'],
        [sql`update public.tenant_platform_policy set revision = 0`, '23514'],
        [sql`update public.tenant_platform_policy set query_timeout_ms = 0`, '23514'],
        [sql`update public.tenant_platform_policy set max_members = -1`, '23514'],
        [sql`update public.tenant_platform_policy set max_roles = -1`, '23514'],
        [sql`update public.tenant_platform_policy set max_menu_entries = -1`, '23514'],
      ] as const) await expect(withOwner(tx => tx.execute(statement), fixture.tenantId)).rejects.toMatchObject({ cause: { code } })
    } finally { await fixture.close() }
  })
})
