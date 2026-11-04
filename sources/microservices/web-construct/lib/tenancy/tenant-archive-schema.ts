import { z } from 'zod'
import contract from './tenant-archive-contract.json'
import type { ArchiveRow, TenantArchive, TenantArchiveTable } from './tenant-archive-types'

// JSON imports widen schema literals and merge heterogeneous properties with optional undefined
// types. The JSON document itself has neither; fromJSONSchema validates the actual closed schema.
const schema = z.fromJSONSchema(contract as unknown as Parameters<typeof z.fromJSONSchema>[0])

function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('archive must contain JSON values')
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('archive must contain plain JSON objects')
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, ancestors)
  } else {
    for (const key of Reflect.ownKeys(value)) {
      const property = Object.getOwnPropertyDescriptor(value, key)!
      if (typeof key !== 'string' || !('value' in property)) throw new Error('archive must contain JSON properties')
      assertJson(property.value, ancestors)
    }
  }
  ancestors.delete(value)
}

function unique(rows: ArchiveRow[], keys: string[]): Set<string> {
  const ids = rows.map(row => JSON.stringify(keys.map(key => row[key])))
  if (new Set(ids).size !== ids.length) throw new Error('duplicate archive reference')
  return new Set(rows.map(row => String(row[keys[0]])))
}

/** Closed fields and operation-specific details, then cross-row consistency. Never grants authority. */
export function parseTenantArchive(value: unknown): TenantArchive {
  assertJson(value)
  const archive = schema.parse(value) as TenantArchive
  const identities = unique(archive.identities, ['id'])
  const roles = unique(archive.tables.role, ['id_role'])
  const menus = unique(archive.tables.menu_entry, ['id_menu_entry'])
  const members = unique(archive.tables.tenant_membership, ['user_id'])
  const references = {
    id_role_type: unique(archive.globalReferences.role_type, ['id_role_type']),
    id_permission: unique(archive.globalReferences.permission, ['id_permission']),
    id_functionality_type: unique(archive.globalReferences.functionality_type, ['id_functionality_type']),
  }
  // The same case-sensitive union as the exporter. Legacy EN and current en are retained
  // as written. Catalog resolution belongs to restore, including customizable languages.
  const expectedLanguages = new Set(archive.tables.menu_entry_tag.map(row => String(row.tag_lan)))
  for (const row of archive.tables.menu_entry) {
    if (row.item_translation !== null && typeof row.item_translation === 'object') {
      for (const code of Object.keys(row.item_translation)) expectedLanguages.add(code)
    }
  }
  const languages = archive.globalReferences.app_language.map(row => String(row.code))
  if (new Set(languages).size !== languages.length || languages.length !== expectedLanguages.size
    || languages.some(code => !expectedLanguages.has(code))) throw new Error('invalid archive language reference set')
  for (const name of Object.keys(contract.properties.tables.properties) as TenantArchiveTable[]) {
    const rows = archive.tables[name]
    if (rows.length !== archive.counts[name]) throw new Error(`archive count mismatch: ${name}`)
    unique(rows, [...contract.properties.tables.properties[name]['x-order-by']])
    for (const row of rows) {
      if (row.id_tenant !== archive.sourceTenant.id) throw new Error('archive mixes tenants')
      for (const key of ['user_id', 'support_granted_by', 'actor_user_id']) {
        if (row[key] !== undefined && row[key] !== null && !identities.has(String(row[key]))) throw new Error(`missing identity: ${key}`)
      }
      if (name === 'user_role' && !members.has(String(row.user_id))) throw new Error('role without membership')
      if (name !== 'role' && row.id_role !== undefined && !roles.has(String(row.id_role))) throw new Error('missing role')
      if (name !== 'menu_entry' && row.id_menu_entry !== undefined && !menus.has(String(row.id_menu_entry))) throw new Error('missing menu')
      if (name === 'menu_entry' && row.id_parent !== null && !menus.has(String(row.id_parent))) throw new Error('missing menu parent')
      for (const key of Object.keys(references) as (keyof typeof references)[]) {
        if (row[key] !== undefined && row[key] !== null && !references[key].has(String(row[key]))) throw new Error(`missing global reference: ${key}`)
      }
    }
  }
  return archive
}
