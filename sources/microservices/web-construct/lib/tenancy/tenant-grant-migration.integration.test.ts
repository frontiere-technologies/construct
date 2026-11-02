import { readFileSync } from 'node:fs'
import { afterAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { createPolicyFixture } from './policy-test-fixture'

/** Prova la bozza 0066 nello stato di prova precedente e annulla tutto, inclusi DDL e catalogo. */
describeIntegration('tenant grant migration trial', () => {
  afterAll(closeOwner)
  it('migrates every preexisting settings delegation once without giving consent to other roles', async () => {
    const f = await createPolicyFixture('migration')
    const migration = readFileSync(new URL('../../../../devops/db/migrations/0066_tenant_grant_guards.sql', import.meta.url), 'utf8')
    try {
      await expect(withOwner(async tx => {
        await tx.execute(sql`insert into public.role_permission (id_role, id_permission)
          select ${f.roleId}, id_permission from public.permission where code = 'manage-tenant-settings'`)
        // Solo il database usa e getta con la bozza precedente: DDL locale alla transazione annullata.
        await tx.execute(sql`drop trigger if exists tenant_permission_feature_guard on public.role_permission`)
        await tx.execute(sql`drop trigger if exists tenant_functionality_feature_guard on public.role_functionality`)
        await tx.execute(sql`drop function if exists app_private.tenant_grant_feature_guard()`)
        const [catalog] = await tx.execute<{ present: boolean }>(sql`select exists(select 1 from public.permission where code = 'manage-support-consent') as present`)
        // Dopo l'installazione finale si esercita lo stesso blocco di backfill, senza duplicare il catalogo.
        const backfill = migration.split('-- BEGIN SUPPORT CONSENT BACKFILL')[1].split('-- END SUPPORT CONSENT BACKFILL')[0]
        await tx.execute(sql.raw(catalog.present ? backfill : migration))
        await tx.execute(sql`select set_config('app.tenant_id', ${String(f.tenantId)}, true)`)
        const grants = await tx.execute<{ code: string }>(sql`select p.code from public.role_permission rp
          join public.permission p on p.id_permission = rp.id_permission where rp.id_role = ${f.roleId} order by p.code`)
        expect(grants.map(row => row.code)).toEqual(['manage-support-consent', 'manage-tenant-settings'])
        const [missing] = await tx.execute<{ count: number }>(sql`select count(*)::int as count
          from public.role_permission rp join public.permission p on p.id_permission = rp.id_permission
          where p.code = 'manage-tenant-settings' and not exists (
            select 1 from public.role_permission e join public.permission ep on ep.id_permission = e.id_permission
            where e.id_role = rp.id_role and ep.code = 'manage-support-consent')`)
        expect(missing.count).toBe(0)
        const [base] = await tx.execute<{ count: number }>(sql`select count(*)::int as count
          from public.role_permission rp join public.role r on r.id_role = rp.id_role
          join public.permission p on p.id_permission = rp.id_permission
          where r.system_key = 'REGISTERED' and p.code = 'manage-support-consent'`)
        expect(base.count).toBe(0)
        throw new Error('migration_trial_rollback')
      }, f.tenantId)).rejects.toThrow('migration_trial_rollback')
    } finally { await f.close() }
  })
})
