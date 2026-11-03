import contract from './tenant-archive-contract.json'

export const EXPORT_MAX_BYTES = 52_428_800
export const EXPORT_DEADLINE_MS = 60_000

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type TenantArchiveTable = keyof typeof contract.properties.tables.properties
export type ArchiveRow = Record<string, JsonValue>

/** Public JSON contract, also consumable by the future Node CLI through the adjacent JSON Schema. */
export interface TenantArchive {
  formatVersion: 1
  schemaVersion: string
  catalogVersion: 1
  exportedAt: string
  sourceTenant: ArchiveRow & { id: string }
  identities: (ArchiveRow & { id: string })[]
  tables: Record<TenantArchiveTable, ArchiveRow[]>
  counts: Record<TenantArchiveTable, number>
  globalReferences: Record<keyof typeof contract.properties.globalReferences.properties, ArchiveRow[]>
  hosts: ArchiveRow[]
}
