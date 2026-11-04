import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTenantRestoreArguments, validateTenantArchive, parseTenantRestoreUserMap } from './tenant-archive.mjs'

const actor = '00000000-0000-4000-8000-000000000001'
const member = '00000000-0000-4000-8000-000000000002'
const base = ['--file', 'archive.json', '--slug', 'tenant-a2', '--name', 'Tenant A2', '--user-map', 'map.json']
const at = '2026-11-03T10:00:00.123456Z'

function archiveFixture() {
  const tables = {
    role: [
      { id_tenant: '42', id_role: '0', id_role_type: '1', description: 'Registered', system_key: 'REGISTERED', date_ins: at, date_mod: null },
      { id_tenant: '42', id_role: '9007199254740993', id_role_type: '1', description: 'Administrator', system_key: 'TENANT_ADMIN', date_ins: at, date_mod: null },
    ],
    user_role: [{ id_tenant: '42', user_id: member, id_role: '9007199254740993', date_ins: at }],
    role_permission: [{ id_tenant: '42', id_role: '9007199254740993', id_permission: '5' }],
    menu_entry: [{ id_tenant: '42', id_menu_entry: '7', id_parent: null, name: 'Users', order_position: 0,
      navbar_position: 'TOP', icon_path: null, id_functionality_type: '3', functionality_link: '/former-authoring-value',
      canonical_link: '/user-management', area_key: 'people', feature_key: 'read-users', open_in_new_tab: 0,
      item_translation: { EN: { name: 'Users' } }, is_immutable: 0, created_at: at, updated_at: at }],
    menu_entry_tag: [{ id_tenant: '42', id_menu_entry: '7', tag_lan: 'en', tag: 'users', date_ins: at }],
    role_functionality: [],
    app_theme: [],
    tenant_membership: [{ id_tenant: '42', user_id: member, status: 'active', created_at: at, updated_at: at }],
    tenant_settings: [{ id_tenant: '42', self_registration: false, updated_at: at, support_until: null,
      support_granted_by: null, support_granted_at: null, support_export_allowed: false }],
    tenant_audit_event: [{ id_tenant: '42', id: '8', occurred_at: at, actor_user_id: actor, actor_email: null,
      actor_kind: 'platform', operation: 'support.enter', object_type: 'tenant', object_id: '42', details: {},
      origin: 'live', source_tenant_id: null, source_event_id: null }],
    tenant_platform_policy: [{ id_tenant: '42', revision: '2', query_timeout_ms: 500, max_members: 1, max_roles: 2, max_menu_entries: 1 }],
    tenant_area_entitlement: [],
    tenant_entitlement: [],
  }
  return {
    formatVersion: 1, schemaVersion: '0070', catalogVersion: 1, exportedAt: at,
    sourceTenant: { id: '42', slug: 'tenant-a', name: 'Tenant A', status: 'active', created_at: at, updated_at: at },
    identities: [member, actor].map(id => ({ id, first_name: null, last_name: null, email: null })),
    tables, counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
    globalReferences: {
      permission: [{ id_permission: '5', code: 'read-users' }],
      role_type: [{ id_role_type: '1' }], functionality_type: [{ id_functionality_type: '3' }],
      app_language: [{ code: 'EN' }, { code: 'en' }],
    },
    hosts: [],
  }
}

test('tenant-restore validates explicit flags and defaults to read-only preflight', () => {
  assert.deepEqual(parseTenantRestoreArguments(base), {
    file: 'archive.json', slug: 'tenant-a2', name: 'Tenant A2', userMap: 'map.json',
    actor: undefined, apply: false, acceptPolicy: false,
  })
  assert.equal(parseTenantRestoreArguments([...base, '--apply', '--accept-policy', '--actor', actor]).actor, actor)
  assert.throws(() => parseTenantRestoreArguments([...base, '--apply', '--actor', actor]), /--accept-policy/)
  assert.throws(() => parseTenantRestoreArguments([...base, '--apply', '--accept-policy']), /--actor/)
  for (const args of [
    [...base, '--unknown'], [...base, '--file', 'twice'], [...base, '--actor', 'email@example.test'],
    [...base.slice(0, -1), '--apply'], base.slice(2), [...base, '--apply=true'],
  ]) assert.throws(() => parseTenantRestoreArguments(args))
})

test('validates the closed v1 archive without losing bigint strings, microseconds, or raw menu links', () => {
  const archive = archiveFixture()
  assert.deepEqual(validateTenantArchive(archive), archive)
  for (const mutate of [
    a => { a.formatVersion = 2 },
    a => { a.identities[0].password_hash = 'secret' },
    a => { a.counts.user_role = 2 },
    a => { a.tables.role_permission[0].id_tenant = '43' },
    a => { a.tables.role[1].id_role = '9223372036854775808' },
    a => { a.tables.user_role[0].user_id = actor },
    a => { a.tables.menu_entry[0].id_parent = '7' },
    a => { a.tables.menu_entry[0].feature_key = 'unknown-feature' },
    a => { a.tables.tenant_audit_event[0].operation = 'unknown.operation' },
    a => { a.tables.tenant_audit_event[0].details.token = 'secret' },
    a => { a.globalReferences.app_language = [{ code: 'en' }] },
    a => { a.globalReferences.permission[0].code = 'unknown-permission' },
    a => { a.globalReferences.role_type.push({ id_role_type: '999' }) },
    a => { a.tables.tenant_platform_policy[0].max_roles = 1 },
  ]) {
    const invalid = archiveFixture()
    mutate(invalid)
    assert.throws(() => validateTenantArchive(invalid), /archive|quota/)
  }
})

test('requires a one-to-one explicit map of operational members and no historical identity mapping', () => {
  assert.deepEqual(parseTenantRestoreUserMap(JSON.stringify({ [member]: actor }), [member]), { [member]: actor })
  for (const [raw, members] of [
    ['{}', [member]],
    [JSON.stringify({ [member]: 'person@example.test' }), [member]],
    [JSON.stringify({ [member]: actor, [actor]: member }), [member]],
    [JSON.stringify({ [member]: actor, [actor]: actor }), [member, actor]],
    [`{"${member}":"${actor}","${member}":"${member}"}`, [member]],
  ]) assert.throws(() => parseTenantRestoreUserMap(raw, members), /user.map/)
})
