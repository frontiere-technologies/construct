import { readFileSync } from 'node:fs'
import { afterAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { createPolicyFixture, type PolicyFixture } from '@/lib/tenancy/policy-test-fixture'
import { normalizeMenuTargetUrl } from './menu-target-url'

type UpgradeTx = Parameters<Parameters<typeof withOwner>[0]>[0]

const origin = 'https://construct.example.test'
const migration = readFileSync(new URL('../../../../devops/db/migrations/0065_menu_feature_binding.sql', import.meta.url), 'utf8')
const backfill = migration.slice(migration.indexOf('do $$ declare v_tenant'), migration.indexOf('create function app_private.menu_feature_binding_guard'))

afterAll(closeOwner)

function failureText(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  return ('message' in error ? String(error.message) : '') + ('cause' in error ? failureText(error.cause) : '')
}

/** Fixture della fotografia: i valori attesi dei test sono letterali, non derivati da questa. */
async function prepareSnapshot(tx: UpgradeTx) {
  await tx.execute(sql`create temporary table menu_target_backfill (
    id_tenant bigint not null, id_menu_entry bigint not null, raw_link text,
    functionality_type bigint, canonical_link text, primary key (id_tenant, id_menu_entry)
  ) on commit drop`)
  const tenants = await tx.execute<{ id: string }>(sql`select id::text as id from public.tenant order by id`)
  for (const tenant of tenants) {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`)
    const rows = await tx.execute<{ id: string; raw: string | null; type: number | null }>(sql`
      select id_menu_entry::text as id, functionality_link as raw, id_functionality_type::int as type from public.menu_entry`)
    for (const row of rows) await tx.execute(sql`insert into pg_temp.menu_target_backfill values (
      ${tenant.id}::bigint, ${row.id}::bigint, ${row.raw}, ${row.type}, ${normalizeMenuTargetUrl(row.raw, row.type, origin)})`)
  }
}

async function upgradeTrial(f: PolicyFixture, seed: (tx: UpgradeTx) => Promise<void>, check: (tx: UpgradeTx) => Promise<void>) {
  const rollback = new Error('rollback_upgrade_trial')
  try {
    await withOwner(async tx => {
      await tx.execute(sql`lock table public.tenant in share mode`)
      await tx.execute(sql`lock table public.menu_entry in share row exclusive mode`)
      await tx.execute(sql`select set_config('app.menu_origin', ${origin}, true)`)
      await seed(tx)
      await prepareSnapshot(tx)
      await tx.execute(sql`select set_config('app.tenant_id', ${String(f.tenantId)}, true)`)
      await check(tx)
      throw rollback
    }, f.tenantId)
  } catch (error) { if (error !== rollback) throw error }
}

describeIntegration('0065 historical upgrade snapshot', () => {
  it('runs the actual backfill on previously usable Unicode and noncanonical strings while preserving authoring data', async () => {
    const f = await createPolicyFixture('upgrade')
    const cases = [
      ['Unicode', 2, 'https://bücher.example/page', 'https://xn--bcher-kva.example/page', 'use-custom-content'],
      ['Triple', 2, '///construct.example.test/user-management', '//construct.example.test/user-management', 'read-users'],
      ['Encoded', 2, '/a%2f..%2fuser-management', '/a%2f..%2fuser-management', 'core-app'],
      ['Tab', 2, 'https://constr\tuct.example.test/user-management', 'https://construct.example.test/user-management', 'read-users'],
      ['Backslash', 2, String.raw`https:\\outside.test\page`, 'https://outside.test/page', 'use-custom-content'],
      ['Query space', 2, 'https://outside.test/?q=hello world#grid', 'https://outside.test/?q=hello%20world#grid', 'use-custom-content'],
      ['Credentials', 2, 'https://user:pass@outside.test/page', 'https://user:pass@outside.test/page', 'use-custom-content'],
      ['External type3', 3, 'https://outside.test/page', 'https://outside.test/page', 'use-custom-content'],
      ['FTP href', 2, 'ftp://outside.test/page', '/ftp://outside.test/page', 'core-app'],
      ['Mail href', 2, 'mailto:person@example.test', '/mailto:person@example.test', 'core-app'],
      ['Tel href', 2, 'tel:+3900000', '/tel:+3900000', 'core-app'],
      ['Custom scheme', 2, 'http+unix://socket/path', 'http+unix://socket/path', 'use-custom-content'],
    ] as const
    try {
      await upgradeTrial(f, async tx => {
        await tx.execute(sql`alter table public.menu_entry disable trigger menu_feature_binding_guard`)
        for (const [name, type, raw] of cases) await tx.execute(sql`insert into public.menu_entry
          (name, id_functionality_type, functionality_link) values (${name}, ${type}, ${raw})`)
        await tx.execute(sql`set constraints all immediate`)
        await tx.execute(sql`alter table public.menu_entry enable trigger menu_feature_binding_guard`)
      }, async tx => {
        await tx.execute(sql.raw(backfill))
        const rows = await tx.execute<{ name: string; functionality_link: string; canonical_link: string; feature_key: string }>(sql`
          select name, functionality_link, canonical_link, feature_key from public.menu_entry`)
        for (const [name, , raw, canonical, feature] of cases) {
          expect(rows.find(row => row.name === name)).toMatchObject({ functionality_link: raw, canonical_link: canonical, feature_key: feature })
        }
      })
    } finally { await f.close() }
  })

  it.each(['missing', 'stale-raw', 'stale-type', 'noncanonical-target'] as const)('rolls back a %s snapshot rather than committing a partial backfill', async mode => {
    const f = await createPolicyFixture('bad-map')
    try {
      let failure: unknown
      try {
        await upgradeTrial(f, async () => {}, async tx => {
          if (mode === 'missing') await tx.execute(sql`delete from pg_temp.menu_target_backfill where id_menu_entry = ${f.menuEntryId}`)
          if (mode === 'stale-raw') await tx.execute(sql`update pg_temp.menu_target_backfill set raw_link = '/changed' where id_menu_entry = ${f.menuEntryId}`)
          if (mode === 'stale-type') await tx.execute(sql`update pg_temp.menu_target_backfill set functionality_type = 2 where id_menu_entry = ${f.menuEntryId}`)
          if (mode === 'noncanonical-target') await tx.execute(sql`update pg_temp.menu_target_backfill set canonical_link = '///construct.example.test/user-management' where id_menu_entry = ${f.menuEntryId}`)
          await tx.execute(sql.raw(backfill))
        })
      } catch (error) { failure = error }
      expect(failureText(failure)).toContain(mode === 'noncanonical-target' ? 'noncanonical_menu_target' : 'menu_target_backfill_mismatch')
      const [row] = await withOwner(tx => tx.execute<{ canonical_link: string; feature_key: string }>(sql`
        select canonical_link, feature_key from public.menu_entry where id_menu_entry = ${f.menuEntryId}`), f.tenantId)
      expect(row).toEqual({ canonical_link: '/user-management', feature_key: 'read-users' })
    } finally { await f.close() }
  })
})
