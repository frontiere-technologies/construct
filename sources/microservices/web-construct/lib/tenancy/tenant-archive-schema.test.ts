import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getTableColumns, getTableName } from 'drizzle-orm'
import * as dbSchema from '@/lib/db/schema'
import { parseTenantArchive } from './tenant-archive-schema'
import contract from './tenant-archive-contract.json'

const at = '2026-11-03T10:00:00.000Z'
const person = '00000000-0000-4000-8000-000000000001'

/** Hand-written public format: this fixture does not derive fields or expectations from the contract. */
export function validArchive() {
  return {
    formatVersion: 1, schemaVersion: '0070', catalogVersion: 1, exportedAt: at,
    sourceTenant: { id: '42', slug: 'sample-a', name: 'Sample A', status: 'active', created_at: at, updated_at: at },
    identities: [{ id: person, email: 'person@example.test', first_name: 'Sample', last_name: 'Person' }],
    tables: {
      role: [{ id_tenant: '42', id_role: '9007199254740993', id_role_type: '2', description: 'Sample role', system_key: null, date_ins: at, date_mod: null }],
      user_role: [{ id_tenant: '42', user_id: person, id_role: '9007199254740993', date_ins: at }],
      role_permission: [{ id_tenant: '42', id_role: '9007199254740993', id_permission: '1' }],
      menu_entry: [{ id_tenant: '42', id_menu_entry: '9007199254740995', id_parent: null, name: 'Sample menu', order_position: 0, navbar_position: 'TOP', icon_path: null, id_functionality_type: '3', functionality_link: '/user-management?original=1', canonical_link: '/user-management', area_key: 'people', feature_key: 'read-users', open_in_new_tab: 1, item_translation: { EN: { name: 'People' } }, is_immutable: 0, created_at: at, updated_at: at }],
      menu_entry_tag: [{ id_tenant: '42', id_menu_entry: '9007199254740995', tag_lan: 'en', tag: 'sample', date_ins: at }],
      role_functionality: [{ id_tenant: '42', id_role: '9007199254740993', id_menu_entry: '9007199254740995' }],
      app_theme: [{ id_tenant: '42', primary_color: '#123456', primary_dark: null, background_light: null, card_light: null, accent_light: null, sidebar_light: null, background_dark: null, card_dark: null, accent_dark: null, sidebar_dark: null, date_mod: at }],
      tenant_membership: [{ id_tenant: '42', user_id: person, status: 'deactivated', created_at: at, updated_at: at }],
      tenant_settings: [{ id_tenant: '42', self_registration: false, updated_at: at, support_until: null, support_granted_by: null, support_granted_at: null, support_export_allowed: false }],
      tenant_audit_event: [{ id_tenant: '42', id: '9007199254740997', occurred_at: at, actor_user_id: person, actor_email: 'person@example.test', actor_kind: 'person', operation: 'role.create', object_type: 'role', object_id: '9007199254740993', details: { name: 'Sample role' }, origin: 'live', source_tenant_id: null, source_event_id: null }],
      tenant_platform_policy: [{ id_tenant: '42', revision: '3', query_timeout_ms: 500, max_members: 0, max_roles: null, max_menu_entries: 100 }],
      tenant_area_entitlement: [{ id_tenant: '42', area_code: 'people', enabled: false }],
      tenant_entitlement: [{ id_tenant: '42', feature_code: 'read-users', allowed: false }],
    },
    counts: { role: 1, user_role: 1, role_permission: 1, menu_entry: 1, menu_entry_tag: 1, role_functionality: 1, app_theme: 1, tenant_membership: 1, tenant_settings: 1, tenant_audit_event: 1, tenant_platform_policy: 1, tenant_area_entitlement: 1, tenant_entitlement: 1 },
    globalReferences: {
      permission: [{ id_permission: '1', code: 'read-users' }], role_type: [{ id_role_type: '2' }],
      functionality_type: [{ id_functionality_type: '3' }], app_language: [{ code: 'EN' }, { code: 'en' }],
    },
    hosts: [{ host: 'a.example.test', is_primary: true, created_at: at }],
  }
}

describe('tenant archive format v1', () => {
  it('preserves the closed complete archive including exact bigint strings and suspended assignments', () => {
    const parsed = parseTenantArchive(validArchive())
    expect(parsed.tables.role[0].id_role).toBe('9007199254740993')
    expect(parsed.tables.tenant_membership[0].status).toBe('deactivated')
    expect(parsed.tables.menu_entry[0]).toMatchObject({ functionality_link: '/user-management?original=1', canonical_link: '/user-management', feature_key: 'read-users' })
    expect(parsed.counts.tenant_audit_event).toBe(1)
  })

  it('rejects privilege fields even in an otherwise valid archive', () => {
    const archive = validArchive()
    expect(() => parseTenantArchive({ ...archive, isPlatformAdmin: true })).toThrow()
  })

  it.each(['password_hash', 'token', 'auth_provider', 'is_platform_admin', 'last_tenant_id', 'name', 'username'])('rejects identity field %s', field => {
    const archive = validArchive()
    expect(() => parseTenantArchive({ ...archive, identities: [{ ...archive.identities[0], [field]: 'forbidden' }] })).toThrow()
  })

  it.each([
    ['missing', [{ code: 'en' }]],
    ['extra', [{ code: 'EN' }, { code: 'en' }, { code: 'it' }]],
    ['duplicate', [{ code: 'EN' }, { code: 'en' }, { code: 'EN' }]],
  ])('rejects %s language references with historical uppercase and lowercase present', (_reason, appLanguage) => {
    const archive = validArchive()
    expect(() => parseTenantArchive({ ...archive, globalReferences: { ...archive.globalReferences, app_language: appLanguage } })).toThrow(/language reference/)
  })

  it('rejects fields, unknown tables, codes, numbers for bigint and non-JSON values', () => {
    for (const mutate of [
      (a: ReturnType<typeof validArchive>) => ({ ...a, tables: { ...a.tables, users: [] } }),
      (a: ReturnType<typeof validArchive>) => ({ ...a, tables: { ...a.tables, role: [{ ...a.tables.role[0], id_role: 9007199254740992 }] } }),
      (a: ReturnType<typeof validArchive>) => ({ ...a, tables: { ...a.tables, tenant_entitlement: [{ ...a.tables.tenant_entitlement[0], feature_code: 'unknown-feature' }] } }),
      (a: ReturnType<typeof validArchive>) => ({ ...a, tables: { ...a.tables, role: [{ ...a.tables.role[0], description: undefined }] } }),
      (a: ReturnType<typeof validArchive>) => ({ ...a, formatVersion: 2 }),
    ]) expect(() => parseTenantArchive(mutate(validArchive()))).toThrow()
  })

  it('rejects undefined and non-JSON values inside otherwise optional audit fields', () => {
    const archive = validArchive()
    const event = archive.tables.tenant_audit_event[0]
    for (const details of [{ name: undefined }, new Date(), { name: Number.NaN }, { name: BigInt(3) }]) {
      expect(() => parseTenantArchive({ ...archive, tables: { ...archive.tables, tenant_audit_event: [{ ...event, details }] } })).toThrow()
    }
  })

  it('rejects tenant mixing, inconsistent counts and missing identity references', () => {
    const archive = validArchive()
    expect(() => parseTenantArchive({ ...archive, counts: { ...archive.counts, role: 2 } })).toThrow()
    expect(() => parseTenantArchive({ ...archive, tables: { ...archive.tables, role: [{ ...archive.tables.role[0], id_tenant: '43' }] } })).toThrow()
    expect(() => parseTenantArchive({ ...archive, identities: [] })).toThrow()
  })

  it('rejects arbitrary audit details and operation mismatches, preserves historical provenance', () => {
    const archive = validArchive()
    const event = archive.tables.tenant_audit_event[0]
    for (const details of [{ name: 'role', surprise: 'secret' }, { before: { password: 'secret' } }, { name: { nested: 'secret' } }]) {
      expect(() => parseTenantArchive({ ...archive, tables: { ...archive.tables, tenant_audit_event: [{ ...event, details }] } })).toThrow()
    }
    expect(() => parseTenantArchive({ ...archive, tables: { ...archive.tables, tenant_audit_event: [{ ...event, operation: 'unknown.operation' }] } })).toThrow()
    const restored = { ...event, origin: 'restored', source_tenant_id: '9', source_event_id: '9007199254740999' }
    expect(parseTenantArchive({ ...archive, tables: { ...archive.tables, tenant_audit_event: [restored] } }).tables.tenant_audit_event[0]).toMatchObject(restored)
  })

  it('covers every tenant table field in Drizzle and the SQL coverage lists', () => {
    const names = ['role', 'user_role', 'role_permission', 'menu_entry', 'menu_entry_tag', 'role_functionality', 'app_theme', 'tenant_membership', 'tenant_settings', 'tenant_audit_event', 'tenant_platform_policy', 'tenant_area_entitlement', 'tenant_entitlement']
    const tables = contract.properties.tables.properties
    expect(Object.keys(tables).sort()).toEqual(names.sort())
    const defined = Object.values(dbSchema).filter(value => {
      try { return names.includes(getTableName(value as Parameters<typeof getTableName>[0])) } catch { return false }
    })
    for (const table of defined) {
      const name = getTableName(table as Parameters<typeof getTableName>[0]) as keyof typeof tables
      const columns = Object.values(getTableColumns(table as Parameters<typeof getTableColumns>[0])).map(column => column.name).sort()
      expect(Object.keys(tables[name].items.properties).sort(), name).toEqual(columns)
    }
    const migration = readFileSync(resolve(__dirname, '../../../../devops/db/migrations/0070_tenant_data_contract.sql'), 'utf8')
    for (const operation of ['export', 'restore', 'delete']) {
      const list = new RegExp(`v_${operation} constant text\\[\\] := array\\[([^\\]]+)\\]`).exec(migration)?.[1]
      expect(list, operation).toBeDefined()
      expect([...list!.matchAll(/'([^']+)'/g)].map(match => match[1]).sort()).toEqual(names.sort())
    }
  })
})
