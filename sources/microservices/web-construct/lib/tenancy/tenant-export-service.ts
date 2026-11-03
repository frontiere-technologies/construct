import { sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { auditActorOf } from '@/lib/audit/audit-types'
import { recordTenantAudit } from '@/lib/audit/tenant-audit'
import { platformAuditEvent } from '@/lib/db/schema'
import { auditRow } from '@/lib/audit/audit-row'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { assertTenantExportActive, withTenantExportScope } from '@/lib/db/tenant-export-scope'
import type { Actor } from '@/lib/rbac/actor'
import contract from './tenant-archive-contract.json'
import { EXPORT_MAX_BYTES, EXPORT_DEADLINE_MS, type TenantArchiveTable } from './tenant-archive-types'

export { EXPORT_MAX_BYTES, EXPORT_DEADLINE_MS }

interface FieldSchema {
  const?: string | number | boolean | null
  type?: string
  format?: string
  properties?: Record<string, FieldSchema>
  items?: FieldSchema
  anyOf?: FieldSchema[]
  'x-bigint'?: boolean
}

/** Stores only bounded UTF-8 chunks. No temporary files, response stream or persistent URL. */
export class TenantArchiveWriter {
  private chunks: Buffer[] = []
  private size = 0

  assertCapacity(additional: number): void {
    assertTenantExportActive()
    if (additional > EXPORT_MAX_BYTES - this.size) throw new Error('tenant_export_size_limit')
  }

  append(text: string): void {
    const bytes = Buffer.byteLength(text, 'utf8')
    this.assertCapacity(bytes)
    this.chunks.push(Buffer.from(text, 'utf8'))
    this.size += bytes
  }

  finish(): Uint8Array {
    assertTenantExportActive()
    const bytes = Buffer.concat(this.chunks, this.size)
    this.chunks = []
    assertTenantExportActive()
    return bytes
  }
}

const PAGE_ROWS = 64
const tableDefinitions = contract.properties.tables.properties
const tableNames = Object.keys(tableDefinitions) as TenantArchiveTable[]
const validator = (value: object) => z.fromJSONSchema(value as Parameters<typeof z.fromJSONSchema>[0])
const tableValidators = Object.fromEntries(tableNames.map(name => [name, validator(tableDefinitions[name].items)]))

function inner(schema: FieldSchema): FieldSchema { return schema.anyOf?.find(value => value.type !== 'null') ?? schema }

/** Project details according to the operation schema on the DB side, before fetching any payload.
 * In particular jsonb numeric IDs become text in SQL, before JavaScript could round them. Invalid
 * types stay invalid and the closed row validator rejects them; they are never coerced into text.
 */
function auditValue(value: SQL, schema: FieldSchema, depth = 0): SQL {
  const field = inner(schema)
  if (field['x-bigint']) return sql`case when jsonb_typeof(${value}) in ('string', 'number') then to_jsonb(${value} #>> '{}') else ${value} end`
  if (field.type === 'object' && field.properties) {
    const parts = Object.entries(field.properties).map(([key, child]) => sql`case when ${value} ? ${key}
      then jsonb_build_object(${key}::text, ${auditValue(sql`(${value} -> ${key})`, child, depth + 1)}) else '{}'::jsonb end`)
    return sql`case when jsonb_typeof(${value}) = 'object' then ${parts.length ? sql.join(parts, sql` || `) : sql`'{}'::jsonb`} else ${value} end`
  }
  if (field.type === 'array' && field.items) {
    const alias = sql.identifier(`a${depth}`)
    return sql`case when jsonb_typeof(${value}) = 'array' then
      (select coalesce(jsonb_agg(${auditValue(sql`${alias}.v`, field.items, depth + 1)} order by ${alias}.ord), '[]'::jsonb)
       from jsonb_array_elements(${value}) with ordinality as ${alias}(v, ord)) else ${value} end`
  }
  return value
}

function auditDetails(): SQL {
  const branches = Object.entries(contract['x-audit-details']).map(([operation, definition]) =>
    sql`when ${operation} then ${auditValue(sql`t.details`, definition)}`)
  return sql`case t.operation ${sql.join(branches, sql` `)} else '{}'::jsonb end`
}

function projection(fields: Record<string, FieldSchema>, isAudit = false): SQL {
  const values = Object.entries(fields).flatMap(([name, schema]) => {
    const column = sql`${sql.identifier('t')}.${sql.identifier(name)}`
    const field = inner(schema)
    const value = isAudit && name === 'details' ? auditDetails()
      : field['x-bigint'] ? sql`${column}::text`
        : field.format === 'date-time' ? sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
          : column
    return [sql`${name}::text`, value]
  })
  return sql`jsonb_build_object(${sql.join(values, sql`, `)})`
}

/** Two bounded reads per page: lengths first, then the same stable snapshot's payloads. A single
 * huge text/JSON value is rejected before it can cross the driver into process memory. */
async function rows(
  tx: TenantTx, writer: TenantArchiveWriter, source: SQL, fields: Record<string, FieldSchema>,
  order: string[], rowSchema: z.ZodType, isAudit = false,
): Promise<number> {
  let count = 0
  const payload = projection(fields, isAudit)
  const ordering = sql.join(order.map(key => sql`${sql.identifier('t')}.${sql.identifier(key)}`), sql`, `)
  for (;;) {
    assertTenantExportActive()
    const page = sql`from (${source}) t order by ${ordering} limit ${PAGE_ROWS} offset ${count}`
    const sizes = await tx.execute<{ size: number }>(sql`select octet_length((${payload})::text)::int as size ${page}`)
    if (!sizes.length) break
    writer.assertCapacity(sizes.reduce((sum, row) => sum + row.size + 1, 0))
    const result = await tx.execute<{ payload: string }>(sql`select (${payload})::text as payload ${page}`)
    for (const row of result) {
      assertTenantExportActive()
      rowSchema.parse(JSON.parse(row.payload))
      if (count) writer.append(',')
      writer.append(row.payload)
      count++
    }
    if (sizes.length < PAGE_ROWS) break
  }
  return count
}

const identitySource = sql`
  select ref.id,
    case when m.user_id is not null then u.email else
      (select e.actor_email from public.tenant_audit_event e where e.actor_user_id = ref.id order by e.id desc limit 1) end as email,
    u.name, u.first_name, u.last_name, u.username
  from (
    select user_id as id from public.tenant_membership
    union select support_granted_by from public.tenant_settings where support_granted_by is not null
    union select actor_user_id from public.tenant_audit_event where actor_user_id is not null
  ) ref
  left join public.tenant_membership m on m.user_id = ref.id
  -- Historical/support non-members are technical references only. Never enrich from other profiles.
  left join public.users u on u.id = ref.id and m.user_id is not null`

const referenceSources = {
  permission: sql`select distinct p.id_permission, p.code from public.permission p join public.role_permission r using (id_permission)`,
  role_type: sql`select distinct r.id_role_type from public.role r where r.id_role_type is not null`,
  functionality_type: sql`select distinct m.id_functionality_type from public.menu_entry m where m.id_functionality_type is not null`,
  app_language: sql`select tag_lan as code from public.menu_entry_tag union
    select jsonb_object_keys(item_translation) as code from public.menu_entry where jsonb_typeof(item_translation) = 'object'`,
}

/** Coherent repeatable-read snapshot; only the preparation audit is written, after all reads.
 * Its own event is consequently absent from the archive. Limits and assignments are exported as
 * data, never as an authorization source for restore. The HTTP caller must run both T09 guards.
 */
export async function prepareTenantExport(actor: Actor, signal: AbortSignal): Promise<Uint8Array> {
  return withTenantExportScope(signal, () => withTenant(actor.tenantId, async tx => {
    await tx.execute(sql`select app_private.assert_tenant_data_coverage('export')`)
    const writer = new TenantArchiveWriter()
    writer.append('{"formatVersion":1,"schemaVersion":"0070","catalogVersion":1,"exportedAt":')
    writer.append(JSON.stringify(new Date().toISOString()))
    writer.append(',"sourceTenant":')
    const tenantCount = await rows(tx, writer, sql`select * from public.tenant where id = app_private.current_tenant_id()`,
      contract.properties.sourceTenant.properties, ['id'], validator(contract.properties.sourceTenant))
    if (tenantCount !== 1) throw new Error('tenant export source missing')
    writer.append(',"identities":[')
    await rows(tx, writer, identitySource, contract.properties.identities.items.properties, ['id'], validator(contract.properties.identities.items))
    writer.append('],"tables":{')
    const counts: Partial<Record<TenantArchiveTable, number>> = {}
    for (const [index, name] of tableNames.entries()) {
      writer.append(`${index ? ',' : ''}${JSON.stringify(name)}:[`)
      const definition = tableDefinitions[name]
      counts[name] = await rows(tx, writer, sql`select * from public.${sql.identifier(name)}`,
        definition.items.properties, definition['x-order-by'], tableValidators[name], name === 'tenant_audit_event')
      writer.append(']')
    }
    writer.append('},"counts":')
    writer.append(JSON.stringify(counts))
    writer.append(',"globalReferences":{')
    for (const [index, name] of (Object.keys(referenceSources) as (keyof typeof referenceSources)[]).entries()) {
      writer.append(`${index ? ',' : ''}${JSON.stringify(name)}:[`)
      const definition = contract.properties.globalReferences.properties[name].items
      await rows(tx, writer, referenceSources[name], definition.properties, [Object.keys(definition.properties)[0]], validator(definition))
      writer.append(']')
    }
    writer.append('},"hosts":[')
    await rows(tx, writer, sql`select host, is_primary, created_at from public.tenant_host where id_tenant = app_private.current_tenant_id()`,
      contract.properties.hosts.items.properties, ['host'], validator(contract.properties.hosts.items))
    writer.append(']}')
    const bytes = writer.finish()
    const event = { operation: 'tenant.export.prepare' as const, objectType: 'tenant', objectId: String(actor.tenantId), details: { formatVersion: 1, bytes: bytes.byteLength } }
    const auditActor = auditActorOf(actor)
    await recordTenantAudit(tx, auditActor, event)
    if (actor.support === true) {
      // The runtime already has INSERT-only access here. Same transaction, no platform connection.
      await tx.insert(platformAuditEvent).values({ ...auditRow(auditActor, event), idTenant: actor.tenantId })
    }
    assertTenantExportActive()
    return bytes
  }, { isolationLevel: 'repeatable read' }))
}
