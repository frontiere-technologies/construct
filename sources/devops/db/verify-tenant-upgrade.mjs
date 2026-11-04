#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { menuOrigin } from './migration-lib.mjs'

const TARGET = 'construct_upgrade_test'
const LEGACY = '0063'
const LATEST = '0074'
const CLI = fileURLToPath(new URL('./db.mjs', import.meta.url))
const require = createRequire(new URL('../../microservices/web-construct/package.json', import.meta.url))

function upgradeUrl() {
  if (process.env.TEST_DATABASE_DISPOSABLE !== '1') throw new Error('TEST_DATABASE_DISPOSABLE=1 is required')
  if (!process.env.TEST_MIGRATION_DATABASE_URL) throw new Error('TEST_MIGRATION_DATABASE_URL is required')
  let url
  try {
    url = new URL(process.env.TEST_MIGRATION_DATABASE_URL)
  } catch {
    throw new Error('valid PostgreSQL URL is required')
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('valid PostgreSQL URL is required')
  if (url.hostname !== '127.0.0.1') throw new Error('numeric loopback address is required (127.0.0.1)')
  if (url.pathname !== `/${TARGET}`) throw new Error(`dedicated ${TARGET} database is required`)
  // The maintenance connection and migration subprocess must use the same listener.
  if (!url.port) throw new Error('explicit PostgreSQL port is required')
  // The driver also parses connection parameters. Allow only the validated URL fields.
  if (url.href.includes('?') || url.href.includes('#')) throw new Error('connection options and fragments are forbidden')
  if (!url.username) throw new Error('a migration login is required')
  try {
    decodeURIComponent(url.username)
    decodeURIComponent(url.password)
  } catch {
    throw new Error('invalid migration login encoding')
  }
  return url
}

function apply(url, origin, version) {
  const result = spawnSync(process.execPath, [CLI, 'test-apply', '--to', version], {
    env: {
      TEST_DATABASE_DISPOSABLE: '1',
      TEST_MIGRATION_DATABASE_URL: url.href,
      DATABASE_URL: 'postgresql://sentinel.invalid/never_connect',
      AUTH_URL: origin,
    },
    encoding: 'utf8',
    timeout: 120_000,
  })
  // Keep child diagnostics private. Classify this failure without forwarding the driver's output.
  if (result.status !== 0) throw new Error('migration apply failed')
  console.log(`Applied through ${version}`)
}

async function inTenant(tx, id) {
  await tx`select set_config('app.tenant_id', ${id}, true)`
}

async function seed(db, origin) {
  return db.begin(async tx => {
    await tx`set local role construct_owner`
    const [{ id: template }] = await tx`select id::text as id from public.tenant where is_template`
    const fixtures = []
    for (const suffix of ['a', 'b']) {
      const [{ id }] = await tx`select app_private.copy_tenant(${template}, ${`upgrade-${suffix}`}, ${`Upgrade ${suffix}`}, false)::text as id`
      await inTenant(tx, id)
      const [{ id: person }] = await tx`insert into public.users (email, id_user_status)
        values (${`upgrade-${suffix}@example.test`}, 2) returning id`
      await tx`insert into public.tenant_membership (user_id, status) values (${person}, 'active')`
      const [{ id: role }] = await tx`insert into public.role (id_role_type, description)
        values (2, ${`upgrade-role-${suffix}`}) returning id_role::text as id`
      await tx`insert into public.user_role (user_id, id_role) values (${person}, ${role})`
      const permissions = suffix === 'a' ? ['read-users', 'manage-tenant-settings'] : ['read-users']
      await tx`insert into public.role_permission (id_role, id_permission)
        select ${role}, id_permission from public.permission where code = any(${permissions})`
      const [{ id: parent }] = await tx`insert into public.menu_entry (name, order_position)
        values (${`upgrade-parent-${suffix}`}, 90) returning id_menu_entry::text as id`
      const raw = `${origin}/retired/../user-management?upgrade=${suffix}`
      const [{ id: menu }] = await tx`insert into public.menu_entry
        (id_parent, name, order_position, id_functionality_type, functionality_link)
        values (${parent}, ${`upgrade-entry-${suffix}`}, 7, 3, ${raw}) returning id_menu_entry::text as id`
      await tx`insert into public.role_functionality (id_role, id_menu_entry) values (${role}, ${menu})`
      const until = suffix === 'a' ? '2090-01-02T03:04:05Z' : '2000-01-02T03:04:05Z'
      await tx`update public.tenant_settings
        set support_until = ${until}, support_granted_at = '2000-01-01T03:04:05Z', support_granted_by = ${person}`
      fixtures.push({ id, person, menu, raw, permissions, canonical: `${origin}/user-management?upgrade=${suffix}` })
    }
    return fixtures
  })
}

async function readLegacyState(db, fixtures, upgraded) {
  return db.begin(async tx => {
    await tx`set local role construct_runtime`
    const snapshots = []
    for (const fixture of fixtures) {
      await inTenant(tx, fixture.id)
      const [membership] = await tx`select status from public.tenant_membership where user_id = ${fixture.person}`
      assert.equal(membership.status, 'active')
      const grants = await tx`select r.id_role::text as role, p.code
        from public.user_role ur join public.role r using (id_tenant, id_role)
        join public.role_permission rp using (id_tenant, id_role)
        join public.permission p using (id_permission)
        where ur.user_id = ${fixture.person} order by p.code`
      assert.deepEqual(grants.filter(row => row.code !== 'manage-support-consent').map(row => row.code), [...fixture.permissions].sort())
      const [menu] = await tx`select m.id_menu_entry::text, m.id_parent::text, m.name, m.order_position, m.functionality_link
        from public.menu_entry m join public.role_functionality rf using (id_tenant, id_menu_entry)
        join public.user_role ur using (id_tenant, id_role)
        where ur.user_id = ${fixture.person} and m.id_menu_entry = ${fixture.menu}`
      assert.equal(menu.functionality_link, fixture.raw)
      const [consent] = await tx`select support_until, support_granted_at, support_granted_by,
        support_until > now() as active from public.tenant_settings`
      assert.equal(consent.support_granted_by, fixture.person)
      assert.equal(consent.active, fixture.permissions.includes('manage-tenant-settings'))
      if (upgraded) {
        assert.equal(grants.some(row => row.code === 'manage-support-consent'), fixture.permissions.includes('manage-tenant-settings'))
        const [target] = await tx`select canonical_link, feature_key from public.menu_entry where id_menu_entry = ${fixture.menu}`
        assert.deepEqual(target, { canonical_link: fixture.canonical, feature_key: 'read-users' })
        assert.notEqual(menu.functionality_link, target.canonical_link)
        const [{ effective }] = await tx`select exists(select 1 from app_private.effective_tenant_feature_codes()
          where code = 'read-users') as effective`
        assert.equal(effective, true)
        const [scope] = await tx`select support_export_allowed from public.tenant_settings`
        assert.equal(scope.support_export_allowed, false)
        const [limits] = await tx`select query_timeout_ms, max_members, max_roles, max_menu_entries from public.tenant_platform_policy`
        assert.deepEqual(limits, { query_timeout_ms: null, max_members: null, max_roles: null, max_menu_entries: null })
      }
      snapshots.push({ membership, grants: grants.filter(row => row.code !== 'manage-support-consent'), menu, consent })
    }
    return snapshots
  })
}

async function verifyUpgrade(url, origin) {
  const maintenance = new URL(url)
  maintenance.pathname = '/postgres'
  const options = { max: 1, prepare: false, connect_timeout: 5, onnotice() {} }
  let admin
  let created = false
  let db
  let phase = 'creating the dedicated database (it must not already exist)'
  try {
    const postgres = require('postgres')
    admin = postgres(maintenance.href, options)
    // CREATE fails if the name exists. Only a database created in this process is cleaned up.
    await admin`create database ${admin(TARGET)} template template0`
    created = true
    db = postgres(url.href, options)
    phase = `applying the baseline through ${LEGACY}`
    apply(url, origin, LEGACY)
    phase = 'preparing and reading the historical fixture'
    const fixtures = await seed(db, origin)
    const before = await readLegacyState(db, fixtures, false)
    phase = `applying the upgrade through ${LATEST}`
    apply(url, origin, LATEST)
    phase = 'comparing historical access, menu, consent and quotas'
    assert.deepEqual(await readLegacyState(db, fixtures, true), before)
    phase = 'verifying legacy writes require an origin'
    await assert.rejects(db.begin(async tx => {
      await tx`set local role construct_runtime`
      await inTenant(tx, fixtures[0].id)
      await tx`insert into public.menu_entry (name, id_functionality_type, functionality_link)
        values ('legacy absolute write', 3, ${fixtures[0].raw})`
    }), error => error.code === '23514' && error.message.startsWith('menu_origin_required'))
    console.log('Verified preserved access and menu placement, canonical targets, unchanged consent without export and null quotas')
    console.log('Verified legacy absolute write is rejected without the public origin')
  } catch (error) {
    // SQL and connection errors can include fixture or login values. Report only the phase and SQLSTATE.
    const code = /^[0-9A-Z]{5}$/.test(error.code ?? '') ? ` (SQLSTATE ${error.code})` : ''
    throw new Error(`${phase}${code}`)
  } finally {
    try {
      await db?.end({ timeout: 5 })
      if (created) {
        await admin`drop database ${admin(TARGET)}`
        console.log('Removed the dedicated test database')
      }
    } catch {
      throw new Error('cleanup of the dedicated database failed')
    } finally {
      await admin?.end({ timeout: 5 })
    }
  }
}

let url
let origin
try {
  url = upgradeUrl()
  // Never include the supplied AUTH_URL value in validation output.
  try { origin = menuOrigin() } catch { throw new Error('a valid public AUTH_URL or NEXTAUTH_URL is required') }
  if (!origin) throw new Error('a public AUTH_URL or NEXTAUTH_URL is required')
} catch (error) {
  console.error(`Upgrade refused. ${error.message}`)
  process.exitCode = 1
}
if (process.exitCode === undefined) {
  try {
    await verifyUpgrade(url, origin)
  } catch (error) {
    console.error(`Upgrade verification failed while ${error.message}`)
    process.exitCode = 1
  }
}
