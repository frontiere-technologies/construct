import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual, promisify } from 'node:util'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeTenantExportExecutor } from '@/lib/db/tenant-export-scope'
import { withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { resolveActor } from '@/lib/rbac/actor'
import { createPolicyFixture, type PolicyFixture } from './policy-test-fixture'
import { readSupportInProgress } from './support-consent'
import contract from './tenant-archive-contract.json'
import { parseTenantArchive } from './tenant-archive-schema'
import type { TenantArchive } from './tenant-archive-types'
import { prepareTenantExport } from './tenant-export-service'
import type { TenantId } from './tenant-id'
import { tenantIdForTest } from './testing'

const run = promisify(execFile)
const appDir = resolve(__dirname, '../..')
const historicalActor = randomUUID()
const at = '2026-11-03T10:00:00.123456Z'
const tableNames = Object.keys(contract.properties.tables.properties)

async function snapshotB(id: TenantId) {
  return withOwner(async tx => ({
    tenant: await tx.execute(sql`select to_jsonb(t)::text as row from public.tenant t where id = ${id}`),
    host: await tx.execute(sql`select to_jsonb(t)::text as row from public.tenant_host t where id_tenant = ${id} order by host`),
    audit: await tx.execute(sql`select to_jsonb(t)::text as row from public.platform_audit_event t where id_tenant = ${id} order by id`),
    tables: await Promise.all(tableNames.map(name => tx.execute(sql`
      select to_jsonb(t)::text as row from public.${sql.identifier(name)} t order by to_jsonb(t)::text`))),
  }), id)
}

async function snapshotUsers() {
  return withOwner(tx => tx.execute(sql`select to_jsonb(u)::text as row from public.users u order by u.id`))
}

async function snapshotRestoreSequences() {
  return withOwner(tx => tx.execute(sql`
    select t.last_value::text as tenant, t.is_called as tenant_called,
      r.last_value::text as role, r.is_called as role_called, m.last_value::text as menu, m.is_called as menu_called
    from public.s_id_tenant t cross join public.s_id_role r cross join public.s_id_menu_entry m`))
}

describeIntegration('tenant restore command', () => {
  let a: PolicyFixture
  let b: PolicyFixture
  let archive: TenantArchive
  let dir: string
  let mapPath: string
  let archivePath: string
  const targets = new Set<string>()

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'construct-restore-'))
    mapPath = join(dir, 'map.json')
    archivePath = join(dir, 'archive.json')
    a = await createPolicyFixture('restore-a')
    b = await createPolicyFixture('restore-b')
    await withOwner(tx => tx.execute(sql`
      insert into public.tenant_membership (user_id) values (${a.memberId})`), b.tenantId)
    await withOwner(async tx => {
      await tx.execute(sql`update public.tenant_membership set status = 'deactivated' where user_id = ${a.memberId}`)
      await tx.execute(sql`update public.tenant_settings set support_until = now() + interval '1 hour',
        support_granted_at = now(), support_granted_by = ${a.adminId}, support_export_allowed = true, self_registration = true`)
      await tx.execute(sql`insert into public.tenant_audit_event (actor_user_id, actor_kind, operation, occurred_at)
        values (${historicalActor}, 'platform', 'support.enter', ${at}), (${a.platformAdminId}, 'platform', 'support.enter', now())`)
      await tx.execute(sql`insert into public.tenant_host (id_tenant, host, is_primary)
        values (${a.tenantId}, ${a.slug + '.example.test'}, true)`)
      const [parent] = await tx.execute<{ id: string }>(sql`insert into public.menu_entry (name, order_position)
        values ('Restore category', 0) returning id_menu_entry::text as id`)
      await tx.execute(sql`update public.menu_entry set id_parent = ${parent.id},
        functionality_link = '/authoring-only', item_translation = '{"EN":{"name":"Archive label"}}'
        where id_menu_entry = ${a.menuEntryId}`)
      await tx.execute(sql`insert into public.menu_entry_tag (id_menu_entry, tag_lan, tag)
        values (${a.menuEntryId}, 'en', 'restore label')`)
      await tx.execute(sql`insert into public.role_permission (id_role, id_permission)
        select ${a.roleId}, id_permission from public.permission where code = 'read-users'`)
      await tx.execute(sql`insert into public.role_functionality (id_role, id_menu_entry) values (${a.roleId}, ${a.menuEntryId})`)
      await tx.execute(sql`insert into public.user_role (user_id, id_role) values (${a.memberId}, ${a.roleId})`)
      await tx.execute(sql`insert into public.tenant_entitlement (feature_code, allowed) values ('read-users', false)`)
      await tx.execute(sql`update public.tenant_platform_policy set max_members = 2,
        max_roles = (select count(*) from public.role), max_menu_entries = (select count(*) from public.menu_entry),
        query_timeout_ms = 1000, revision = 5`)
    }, a.tenantId)
    expect(await withTenant(a.tenantId, readSupportInProgress)).toBe(true)
    const actor = await resolveActor(a.tenantId, a.adminId)
    if (!actor) throw new Error('source actor missing')
    const bytes = await prepareTenantExport(actor, new AbortController().signal)
    archive = parseTenantArchive(JSON.parse(new TextDecoder().decode(bytes)))
    await writeFile(archivePath, bytes)
    await writeFile(mapPath, JSON.stringify({ [a.adminId]: b.adminId, [a.memberId]: a.memberId }))
  }, 20_000)

  async function findTenant(slug: string) {
    const [target] = await withOwner(tx => tx.execute<{ id: string; status: string; is_template: boolean }>(sql`
      select id::text as id, status, is_template from public.tenant where slug = ${slug}`))
    return target
  }

  afterAll(async () => {
    try {
      for (const slug of targets) {
        const tenant = await findTenant(slug)
        if (tenant) await deleteTenantForTest(tenantIdForTest(Number(tenant.id)))
      }
      await b?.close()
      await a?.close()
      if (dir) await rm(dir, { recursive: true, force: true })
    } finally {
      await closeTenantExportExecutor()
      await closeOwner()
    }
  }, 20_000)

  async function command(slug: string, apply = false, file = archivePath, map = mapPath) {
    targets.add(slug)
    const args = ['../../devops/db/db.mjs', 'test-tenant-restore', '--slug', slug, '--name', 'Restored tenant',
      '--file', file, '--user-map', map, '--actor', b.platformAdminId]
    if (apply) args.push('--apply', '--accept-policy')
    try {
      const { stdout, stderr } = await run(process.execPath, args, {
        cwd: appDir, env: { ...process.env, AUTH_URL: 'https://restore.example.test' },
      })
      return { code: 0, stdout, stderr }
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string }
      return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
    }
  }

  it('restores A into A2 without touching B or shared accounts', async () => {
    const slug = `zzz-restore-${unique()}`
    const beforeB = await snapshotB(b.tenantId)
    const beforeUsers = await snapshotUsers()
    const checked = await command(slug)
    expect(checked.stderr).toBe('')
    expect(checked.code).toBe(0)
    const preflight = JSON.parse(checked.stdout)
    expect(preflight).toMatchObject({ mode: 'preflight', tenantId: null, counts: archive.counts, ignoredHosts: 1,
      policy: {
        limits: { maxMembers: 2, maxRoles: archive.counts.role, maxMenuEntries: archive.counts.menu_entry, queryTimeoutMs: 1000 },
        featureEntitlements: [{ feature_code: 'read-users', allowed: false }],
      },
    })
    expect(checked.stdout).not.toMatch(/@example\.test|Archive label|authoring-only/)
    expect(await findTenant(slug)).toBeUndefined()

    const applied = await command(slug, true)
    expect(applied.stderr).toBe('')
    expect(applied.code).toBe(0)
    const restoredTenant = await findTenant(slug)
    expect(restoredTenant).toMatchObject({ status: 'suspended', is_template: false })
    const id = tenantIdForTest(Number(restoredTenant.id))
    const afterB = await snapshotB(b.tenantId)
    const afterUsers = await snapshotUsers()
    // Compare full rows, but never include their values in failure diagnostics.
    expect(isDeepStrictEqual(afterB, beforeB)).toBe(true)
    expect(isDeepStrictEqual(afterUsers, beforeUsers)).toBe(true)

    const restored = await withOwner(async tx => ({
      roles: await tx.execute<{ id: string }>(sql`select id_role::text as id from public.role order by id_role`),
      admin: await tx.execute(sql`select m.user_id::text as id from public.tenant_membership m
        join public.user_role ur using (id_tenant, user_id) join public.role r using (id_tenant, id_role)
        where m.status = 'active' and r.system_key = 'TENANT_ADMIN'`),
      dormant: await tx.execute(sql`select m.status, r.description, p.code, n.id_menu_entry::text as menu_id,
        n.functionality_link, n.canonical_link, parent.name as parent_name, t.tag, t.tag_lan, n.item_translation
        from public.tenant_membership m join public.user_role ur using (id_tenant, user_id)
        join public.role r using (id_tenant, id_role) join public.role_permission rp using (id_tenant, id_role)
        join public.permission p using (id_permission) join public.role_functionality rf using (id_tenant, id_role)
        join public.menu_entry n using (id_tenant, id_menu_entry) join public.menu_entry parent on
        parent.id_tenant = n.id_tenant and parent.id_menu_entry = n.id_parent
        join public.menu_entry_tag t on t.id_tenant = n.id_tenant and t.id_menu_entry = n.id_menu_entry
        where m.user_id = ${a.memberId}`),
      settings: await tx.execute(sql`select self_registration, support_until, support_granted_by,
        support_granted_at, support_export_allowed from public.tenant_settings`),
      effective: await tx.execute<{ code: string }>(sql`select code from app_private.effective_tenant_feature_codes()`),
      policy: await tx.execute(sql`select revision::text, query_timeout_ms, max_members, max_roles, max_menu_entries
        from public.tenant_platform_policy`),
      hosts: await tx.execute(sql`select host from public.tenant_host where id_tenant = ${id}`),
      audit: await tx.execute(sql`select operation, origin, actor_user_id::text, source_tenant_id, source_event_id,
        to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at from public.tenant_audit_event order by id`),
      platform: await tx.execute(sql`select operation, source_tenant_id, details from public.platform_audit_event where id_tenant = ${id}`),
    }), id)
    const sourceRoleIds = archive.tables.role.map(role => role.id_role)
    const restoredRoleIds = restored.roles.map(role => role.id)
    expect(restoredRoleIds).not.toEqual(sourceRoleIds)
    expect(restoredRoleIds.some(role => sourceRoleIds.includes(role))).toBe(false)
    expect(restored.admin).toEqual([{ id: b.adminId }])
    expect(restored.dormant).toMatchObject([{ status: 'deactivated', description: a.slug, code: 'read-users',
      functionality_link: '/authoring-only', canonical_link: '/user-management', parent_name: 'Restore category',
      tag: 'restore label', tag_lan: 'en', item_translation: { EN: { name: 'Archive label' } } }])
    expect(restored.dormant[0]).not.toMatchObject({ menu_id: String(a.menuEntryId) })
    expect(restored.settings).toEqual([{ self_registration: true, support_until: null, support_granted_by: null,
      support_granted_at: null, support_export_allowed: false }])
    expect(restored.policy).toEqual([{ revision: '1', query_timeout_ms: 1000, max_members: 2,
      max_roles: archive.counts.role, max_menu_entries: archive.counts.menu_entry }])
    expect(restored.effective.map(row => row.code)).toEqual(preflight.policy.effectiveFeatures)
    expect(await withTenant(id, readSupportInProgress)).toBe(false)
    expect(restored.hosts).toEqual([])
    expect(restored.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'support.enter', origin: 'restored', actor_user_id: historicalActor, at,
        source_tenant_id: String(a.tenantId), source_event_id: archive.tables.tenant_audit_event.find(event => event.operation === 'support.enter')?.id }),
      expect.objectContaining({ operation: 'support.enter', origin: 'restored', actor_user_id: a.platformAdminId,
        source_tenant_id: String(a.tenantId) }),
      expect.objectContaining({ operation: 'tenant.create', origin: 'live', actor_user_id: b.platformAdminId,
        source_tenant_id: String(a.tenantId), source_event_id: null }),
    ]))
    expect(restored.platform).toEqual([{ operation: 'tenant.restore', source_tenant_id: String(a.tenantId), details: {} }])
  }, 25_000)

  it('rejects unknown destination references, an incomplete map and insufficient quotas without writing', async () => {
    const slug = `zzz-restore-${unique()}`
    const badPath = join(dir, 'bad.json')
    expect((await command(slug)).code).toBe(0)
    const bad = structuredClone(archive)
    bad.tables.tenant_platform_policy[0].max_members = 1
    await writeFile(badPath, JSON.stringify(bad))
    expect(await command(slug, false, badPath)).toMatchObject({ code: 1, stdout: '', stderr: expect.stringMatching(/quota/) })

    const badMap = join(dir, 'bad-map.json')
    await writeFile(badMap, '{}')
    expect(await command(slug, true, archivePath, badMap)).toMatchObject({ code: 1, stdout: '', stderr: expect.stringMatching(/user.map/) })
    await writeFile(badMap, JSON.stringify({ [a.adminId]: randomUUID(), [a.memberId]: a.memberId }))
    expect(await command(slug, true, archivePath, badMap)).toMatchObject({ code: 1, stdout: '', stderr: expect.stringMatching(/account/) })
    await writeFile(badMap, JSON.stringify({ [a.adminId]: a.memberId, [a.memberId]: b.adminId }))
    await withOwner(tx => tx.execute(sql`update public.users set id_user_status = 1 where id = ${a.memberId}`))
    try {
      expect(await command(slug, true, archivePath, badMap)).toMatchObject({
        code: 1, stdout: '', stderr: expect.stringMatching(/no active destination administrator/),
      })
    } finally {
      await withOwner(tx => tx.execute(sql`update public.users set id_user_status = 2 where id = ${a.memberId}`))
    }

    const language = structuredClone(archive)
    language.tables.menu_entry_tag[0].tag_lan = 'qzz'
    language.globalReferences.app_language = language.globalReferences.app_language.filter(ref => ref.code !== 'en')
    language.globalReferences.app_language.push({ code: 'qzz' })
    await writeFile(badPath, JSON.stringify(language))
    expect(await command(slug, true, badPath)).toMatchObject({ code: 1, stdout: '', stderr: expect.stringMatching(/language/) })
    const translationLanguage = structuredClone(archive)
    const menu = translationLanguage.tables.menu_entry.find(row => row.id_menu_entry === String(a.menuEntryId))!
    menu.item_translation = { EN: { name: 'Archive label' }, QZZ: { name: 'Unknown catalog language' } }
    translationLanguage.globalReferences.app_language.push({ code: 'QZZ' })
    await writeFile(badPath, JSON.stringify(translationLanguage))
    expect(await command(slug, true, badPath)).toMatchObject({ code: 1, stdout: '', stderr: expect.stringMatching(/language/) })

    const badTarget = structuredClone(archive)
    const boundMenu = badTarget.tables.menu_entry.find(row => row.id_menu_entry === String(a.menuEntryId))!
    boundMenu.canonical_link = 'https://restore.example.test/api/private'
    await writeFile(badPath, JSON.stringify(badTarget))
    expect(await command(slug, true, badPath)).toMatchObject({ code: 1, stdout: '', stderr: expect.stringMatching(/forbidden menu destination/) })
    expect(await findTenant(slug)).toBeUndefined()
  }, 20_000)

  it.each(['role_functionality', 'platform_audit_event'])('rolls back completely when %s fails', async table => {
    const slug = `zzz-restore-${unique()}`
    const beforeB = await snapshotB(b.tenantId)
    const beforeUsers = await snapshotUsers()
    const fixture = sql.identifier('test_t11_restore_failure')
    const failureCode = table === 'role_functionality' ? 'P1111' : 'P1112'
    // A committed, slug-scoped test trigger can fail the real child process at either stage.
    await withOwner(async tx => {
      await tx.execute(sql`create function app_private.${fixture}() returns trigger language plpgsql
        set search_path = '' as 'begin
          if exists (select 1 from public.tenant where id = new.id_tenant and slug = TG_ARGV[0])
          then raise exception ''t11_injected_restore_failure'' using errcode = ''${sql.raw(failureCode)}''; end if;
          return new;
        end'`)
      await tx.execute(sql.raw(`create trigger test_t11_restore_failure before insert on public.${table}
        for each row execute function app_private.test_t11_restore_failure('${slug}')`))
    })
    try {
      expect(await command(slug, true)).toMatchObject({ code: 1, stdout: '', stderr: expect.stringContaining(failureCode) })
      expect(await findTenant(slug)).toBeUndefined()
      expect(isDeepStrictEqual(await snapshotB(b.tenantId), beforeB)).toBe(true)
      expect(isDeepStrictEqual(await snapshotUsers(), beforeUsers)).toBe(true)
    } finally {
      await withOwner(async tx => {
        await tx.execute(sql`drop trigger ${fixture} on public.${sql.identifier(table)}`)
        await tx.execute(sql`drop function app_private.${fixture}()`)
      })
    }
  }, 20_000)

  it.each([
    ['primary theme colour', (file: TenantArchive) => { file.tables.app_theme[0].primary_color = 'invalid' }, /invalid theme colour/],
    ['secondary theme colour', (file: TenantArchive) => { file.tables.app_theme[0].sidebar_dark = '#ABCDEF' }, /invalid theme colour/],
    ['tag width', (file: TenantArchive) => { file.tables.menu_entry_tag[0].tag = 'a'.repeat(51) }, /incompatible destination column/],
    ['tag timestamp', (file: TenantArchive) => { file.tables.menu_entry_tag[0].date_ins = '0000-01-01T00:00:00Z' }, /incompatible destination column/],
    ['tag collision after conversion', (file: TenantArchive) => {
      const tag = file.tables.menu_entry_tag[0]
      tag.tag = '🎛'.repeat(50)
      file.tables.menu_entry_tag.push({ ...tag, tag: tag.tag + ' ' })
      file.counts.menu_entry_tag += 1
    }, /tags conflict after destination column conversion/],
  ] as const)('refuses invalid %s during preflight and apply before allocating IDs', async (_label, mutate, error) => {
    const slug = `zzz-restore-${unique()}`
    const path = join(dir, 'invalid-destination-row.json')
    const invalid = structuredClone(archive)
    mutate(invalid)
    await writeFile(path, JSON.stringify(invalid))
    const beforeSequences = await snapshotRestoreSequences()
    const preflight = await command(slug, false, path)
    const apply = await command(slug, true, path)
    for (const result of [preflight, apply]) {
      expect(result).toMatchObject({ code: 1, stdout: '', stderr: expect.stringMatching(error) })
    }
    expect(await findTenant(slug)).toBeUndefined()
    expect(await snapshotRestoreSequences()).toEqual(beforeSequences)
  }, 20_000)

  it('rejects a duplicate entitlement key in the original archive in both modes', async () => {
    const slug = `zzz-restore-${unique()}`
    const path = join(dir, 'duplicate-archive-key.json')
    const text = JSON.stringify(archive).replace('"allowed":false', '"allowed":true,"\\u0061llowed":false')
    await writeFile(path, text)
    const beforeSequences = await snapshotRestoreSequences()
    const preflight = await command(slug, false, path)
    // Exercise apply only after preflight proves the parser rejects the ambiguity.
    expect(preflight).toEqual({ code: 1, stdout: '', stderr: 'ERROR: duplicate archive JSON key\n' })
    expect(await command(slug, true, path)).toEqual(preflight)
    expect(await findTenant(slug)).toBeUndefined()
    expect(await snapshotRestoreSequences()).toEqual(beforeSequences)
  }, 20_000)

  it('commits only one restore when two commands target the same slug', async () => {
    const slug = `zzz-restore-${unique()}`
    const results = await Promise.all([command(slug, true), command(slug, true)])
    expect(results.map(result => result.code).sort()).toEqual([0, 1])
    expect(results.find(result => result.code === 1)?.stderr).toMatch(/slug/)
    expect(await findTenant(slug)).toMatchObject({ status: 'suspended' })
  }, 20_000)
})
