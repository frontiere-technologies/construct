import { constants, readFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { menuOrigin } from './migration-lib.mjs'
import { normalizeMenuTargetUrl } from './menu-target-url.generated.mjs'

const appDirectory = new URL('../../microservices/web-construct/', import.meta.url)
const require = createRequire(new URL('package.json', appDirectory))
const contract = JSON.parse(readFileSync(new URL('lib/tenancy/tenant-archive-contract.json', appDirectory), 'utf8'))
const { z } = require('zod')
const schema = z.fromJSONSchema(contract)
const tableDefinitions = contract.properties.tables.properties
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const maxFileBytes = 50 * 1024 * 1024

/**
 * @typedef {object} RestoreOptions
 * @property {string} file Path to a v1 archive JSON file.
 * @property {string} slug Slug of the new tenant.
 * @property {string} name Name of the new tenant.
 * @property {string} userMap Path to a JSON object mapping archived member UUIDs to existing accounts.
 * @property {string | undefined} actor UUID of the explicitly designated operator.
 * @property {boolean} apply Commit the restore.
 * @property {boolean} acceptPolicy Accept the archived quotas and entitlements for the new tenant.
 */

/**
 * @typedef {object} RestoreReport
 * @property {'preflight' | 'applied'} mode
 * @property {string} slug
 * @property {string | null} tenantId
 * @property {'suspended'} status
 * @property {Record<string, number>} counts
 * @property {object} policy The quotas, area/feature entitlements and effective feature codes.
 * @property {number} ignoredHosts Number of source hosts that are not restored.
 */

/** @param {string[]} args @returns {RestoreOptions} */
export function parseTenantRestoreArguments(args) {
  const valueFlags = new Set(['--file', '--slug', '--name', '--user-map', '--actor'])
  const values = new Map()
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i]
    if (values.has(flag)) throw new Error(`${flag} may only be specified once`)
    if (flag === '--apply' || flag === '--accept-policy') {
      values.set(flag, true)
      continue
    }
    if (!valueFlags.has(flag)) throw new Error('unknown tenant-restore option')
    const value = args[i + 1]
    if (!value?.trim() || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    values.set(flag, value.trim())
    i += 1
  }
  const options = {
    file: values.get('--file'),
    slug: values.get('--slug'),
    name: values.get('--name'),
    userMap: values.get('--user-map'),
    actor: values.get('--actor')?.toLowerCase(),
    apply: values.has('--apply'),
    acceptPolicy: values.has('--accept-policy'),
  }
  assertRestoreOptions(options)
  return options
}

function assertRestoreOptions({ file, slug, name, userMap, actor, apply, acceptPolicy }) {
  if (!file || !slug || !name?.trim() || !userMap) throw new Error('--file, --slug, --name and --user-map are required')
  if (!/^[a-z0-9-]{3,40}$/.test(slug) || ['default', 'template'].includes(slug)) throw new Error('invalid destination --slug')
  if (actor !== undefined && !uuidPattern.test(actor)) throw new Error('--actor requires a UUID')
  if (apply && !acceptPolicy) throw new Error('--apply requires --accept-policy')
  if (apply && !actor) throw new Error('--apply requires --actor')
}

function indexUnique(rows, keys, label) {
  const ids = new Set()
  for (const row of rows) {
    const key = JSON.stringify(keys.map(column => row[column]))
    if (ids.has(key)) throw new Error(`duplicate archive ${label} key`)
    ids.add(key)
  }
  return new Set(rows.map(row => row[keys[0]]))
}

function assertSameSet(expected, actual, label) {
  if (expected.size !== actual.size || [...expected].some(id => !actual.has(id))) {
    throw new Error(`invalid archive ${label} reference set`)
  }
}

function assertMenuTree(rows) {
  const remaining = new Map(rows.map(row => [row.id_menu_entry, row.id_parent]))
  while (remaining.size) {
    const path = new Set()
    let id = remaining.keys().next().value
    while (remaining.has(id)) {
      if (path.has(id)) throw new Error('cyclic archive menu')
      path.add(id)
      id = remaining.get(id)
    }
    for (const entry of path) remaining.delete(entry)
  }
}

// x-bigint marks decimal strings at their original locations, including operation-specific
// audit details. Check the Postgres range without converting through Number.
function assertBigintRanges(value, definition) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return
  if (definition['x-bigint']) {
    if (value.length > 20 || value === '-0') throw new Error('archive bigint out of range or noncanonical')
    const bigint = BigInt(value)
    if (bigint < -9223372036854775808n || bigint > 9223372036854775807n) {
      throw new Error('archive bigint out of range or noncanonical')
    }
  }
  if (definition.anyOf) {
    for (const branch of definition.anyOf) {
      if (branch.properties?.operation?.const !== undefined && branch.properties.operation.const !== value.operation) continue
      assertBigintRanges(value, branch)
    }
  }
  if (Array.isArray(value) && definition.items) {
    for (const item of value) assertBigintRanges(item, definition.items)
  } else if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const child = definition.properties?.[key]
      if (child) assertBigintRanges(item, child)
    }
  }
}

export function validateTenantArchive(value) {
  if (!schema.safeParse(value).success) throw new Error('archive does not match the closed v1 contract')
  // Validate but keep the original JSON values, including microsecond timestamps.
  assertBigintRanges(value, contract)
  const { tables, globalReferences, counts, sourceTenant, hosts } = value
  const identities = indexUnique(value.identities, ['id'], 'identity')
  const references = {
    id_role_type: indexUnique(globalReferences.role_type, ['id_role_type'], 'role type'),
    id_permission: indexUnique(globalReferences.permission, ['id_permission'], 'permission'),
    id_functionality_type: indexUnique(globalReferences.functionality_type, ['id_functionality_type'], 'functionality type'),
  }
  indexUnique(globalReferences.permission.filter(ref => ref.code !== null), ['code'], 'permission code')
  indexUnique(hosts, ['host'], 'host')
  const indexes = new Map()
  for (const [name, definition] of Object.entries(tableDefinitions)) {
    const rows = tables[name]
    if (counts[name] !== rows.length) throw new Error(`archive count mismatch for ${name}`)
    indexes.set(name, indexUnique(rows, definition['x-order-by'], name))
  }
  const usedIdentities = new Set()
  for (const [name, rows] of Object.entries(tables)) {
    for (const row of rows) {
      if (row.id_tenant !== sourceTenant.id) throw new Error('archive mixes tenants')
      for (const key of ['user_id', 'actor_user_id', 'support_granted_by']) {
        if (row[key] != null) usedIdentities.add(row[key])
      }
      if (name === 'user_role' && !indexes.get('tenant_membership').has(row.user_id)) throw new Error('archive role without membership')
      if (row.id_role !== undefined && !indexes.get('role').has(row.id_role)) throw new Error('archive role reference is missing')
      if (row.id_menu_entry !== undefined && !indexes.get('menu_entry').has(row.id_menu_entry)) throw new Error('archive menu reference is missing')
      if (row.id_parent != null && !indexes.get('menu_entry').has(row.id_parent)) throw new Error('archive menu parent is missing')
    }
  }
  assertSameSet(usedIdentities, identities, 'identity')
  const referenceRows = {
    id_role_type: tables.role, id_permission: tables.role_permission, id_functionality_type: tables.menu_entry,
  }
  for (const [key, rows] of Object.entries(referenceRows)) {
    const used = new Set(rows.map(row => row[key]).filter(id => id !== null))
    assertSameSet(used, references[key], key)
  }
  const languages = new Set(tables.menu_entry_tag.map(row => row.tag_lan))
  for (const row of tables.menu_entry) {
    for (const code of Object.keys(row.item_translation ?? {})) languages.add(code)
  }
  assertSameSet(languages, indexUnique(globalReferences.app_language, ['code'], 'language'), 'language')
  assertMenuTree(tables.menu_entry)
  const keys = tables.role.map(row => row.system_key).filter(key => key !== null)
  if (keys.length !== 2 || !keys.includes('REGISTERED') || !keys.includes('TENANT_ADMIN')) {
    throw new Error('archive must have both system roles exactly once')
  }
  const policy = tables.tenant_platform_policy[0]
  if (policy && (BigInt(policy.revision) <= 0n || policy.query_timeout_ms === 0)) throw new Error('invalid archive policy')
  for (const [limit, table] of Object.entries({ max_members: 'tenant_membership', max_roles: 'role', max_menu_entries: 'menu_entry' })) {
    if (policy?.[limit] != null && policy[limit] < counts[table]) throw new Error(`archive exceeds quota ${limit}`)
  }
  return value
}

function parseUniqueJson(text, label) {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`invalid ${label} JSON`)
  }
  // JSON.parse owns syntax and value decoding. Walk the original text as well because
  // the decoded object can no longer distinguish overwritten keys. Keep the walk
  // iterative, including when skipping long or heavily escaped string values.
  const scopes = []
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '{') scopes.push(new Set())
    else if (char === '[') scopes.push(null)
    else if (char === '}' || char === ']') scopes.pop()
    else if (char === '"') {
      const start = i
      i += 1
      while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1
      const end = i + 1
      let next = end
      while (next < text.length && ' \t\r\n'.includes(text[next])) next += 1
      if (text[next] === ':') {
        const keys = scopes.at(-1)
        const key = JSON.parse(text.slice(start, end))
        if (keys.has(key)) throw new Error(`duplicate ${label} JSON key`)
        keys.add(key)
      }
    }
  }
  return value
}

export function parseTenantArchiveText(text) {
  return validateTenantArchive(parseUniqueJson(text, 'archive'))
}

/** Only operational members may be mapped, and destination accounts must be distinct. */
export function parseTenantRestoreUserMap(text, memberIds) {
  const value = parseUniqueJson(text, 'user map')
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('user map must be a JSON object')
  const entries = Object.entries(value)
  const seen = new Set()
  const map = new Map()
  for (const [source, target] of entries) {
    if (typeof target !== 'string' || !uuidPattern.test(source) || !uuidPattern.test(target)) {
      throw new Error('user map must map UUIDs to UUIDs')
    }
    const from = source.toLowerCase()
    const to = target.toLowerCase()
    if (seen.has(to) || map.has(from)) throw new Error('user map must be one-to-one')
    seen.add(to)
    map.set(from, to)
  }
  const members = new Set(memberIds.map(id => id.toLowerCase()))
  if (members.size !== memberIds.length || map.size !== members.size || [...map.keys()].some(id => !members.has(id))) {
    throw new Error('user map must cover exactly the archived members')
  }
  return Object.fromEntries(map)
}

async function readBoundedText(path, label) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
    const file = await handle.stat()
    if (!file.isFile() || file.size > maxFileBytes) throw new Error('file limit')
    const buffer = Buffer.alloc(file.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== file.size) throw new Error('file changed')
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset))
  } catch {
    throw new Error(`cannot read ${label} as a UTF-8 file (maximum 50 MiB)`)
  } finally {
    await handle?.close()
  }
}

async function checkDestinationRows(tx, tables) {
  // Use the same destination composite types as 0071 to exercise typmods and input
  // conversions without writes. The SQL preflight already decodes the other rows or
  // checks their keys and references. The v1 schema allows all strings for the colours.
  const [result] = await tx`
    select
      exists (
        select 1 from pg_catalog.jsonb_populate_recordset(null::public.app_theme, ${tx.json(tables.app_theme)}::jsonb) t
        cross join lateral pg_catalog.unnest(array[t.primary_color, t.primary_dark, t.background_light,
          t.card_light, t.accent_light, t.sidebar_light, t.background_dark, t.card_dark, t.accent_dark, t.sidebar_dark]) colour(value)
        where colour.value !~ '^#[0-9a-f]{6}$'
      ) as invalid_theme,
      exists (
        select 1 from pg_catalog.jsonb_populate_recordset(null::public.menu_entry_tag, ${tx.json(tables.menu_entry_tag)}::jsonb) t
        group by t.id_menu_entry, t.tag_lan, t.tag having count(*) > 1
      ) as duplicate_tags,
      (select count(*) from pg_catalog.jsonb_populate_recordset(null::public.tenant_settings, ${tx.json(tables.tenant_settings)}::jsonb)) as settings,
      (select count(*) from pg_catalog.jsonb_populate_recordset(null::public.tenant_audit_event, ${tx.json(tables.tenant_audit_event)}::jsonb)) as events
  `
  if (result.invalid_theme) throw new Error('tenant_restore_invalid_theme')
  if (result.duplicate_tags) throw new Error('tenant_restore_duplicate_tags')
}

const restoreDiagnostics = {
  tenant_restore_slug_taken: 'destination slug already exists',
  tenant_restore_invalid_slug: 'invalid destination slug or name',
  tenant_restore_invalid_archive: 'invalid restore archive',
  tenant_restore_invalid_map: 'invalid user map',
  tenant_restore_unknown_account: 'destination account does not exist',
  tenant_restore_inactive_admin: 'no active destination administrator',
  tenant_restore_unknown_actor: 'technical actor account does not exist',
  tenant_restore_unknown_language: 'destination language is unknown',
  tenant_restore_unknown_permission: 'destination permission is unknown',
  tenant_restore_unknown_type: 'destination role or functionality type is unknown',
  tenant_restore_unknown_feature: 'destination feature or area is unknown',
  tenant_restore_inconsistent_binding: 'archive menu binding is incompatible with the destination',
  tenant_restore_invalid_policy: 'invalid archive policy',
  tenant_restore_invalid_theme: 'archive contains an invalid theme colour',
  tenant_restore_duplicate_tags: 'archive tags conflict after destination column conversion',
  tenant_member_quota: 'archive exceeds the member quota',
  tenant_role_quota: 'archive exceeds the role quota',
  tenant_menu_quota: 'archive exceeds the menu quota',
  inconsistent_menu_feature: 'archive menu binding is incompatible with the destination',
  incompatible_menu_area: 'archive menu area is incompatible with the destination',
  not_a_tenant_menu_target: 'archive contains a forbidden menu destination',
  menu_origin_required: 'configure AUTH_URL or NEXTAUTH_URL for absolute menu destinations',
  unsafe_menu_target: 'archive contains an unsafe menu destination',
}

/**
 * Uses a postgres.js pool connected as the migration login. Preflight opens a read-only
 * transaction. Apply verifies the same data under the write transaction's locks and commits
 * only after both audits have been recorded.
 * @param {import('postgres').Sql} sql
 * @param {RestoreOptions} options
 * @returns {Promise<RestoreReport>}
 */
export async function runTenantRestore(sql, options) {
  assertRestoreOptions(options)
  const archive = parseTenantArchiveText(await readBoundedText(options.file, 'archive'))
  const userMap = parseTenantRestoreUserMap(await readBoundedText(options.userMap, 'user map'),
    archive.tables.tenant_membership.map(row => row.user_id))
  try {
    const origin = menuOrigin()
    for (const row of archive.tables.menu_entry) {
      const type = row.id_functionality_type === null ? null : Number(row.id_functionality_type)
      if (normalizeMenuTargetUrl(row.canonical_link, type, origin) !== row.canonical_link) {
        throw new Error('tenant_restore_inconsistent_binding')
      }
    }
    return await sql.begin(options.apply ? 'isolation level read committed' : 'read only isolation level repeatable read', async tx => {
      await tx`set local role construct_owner`
      await tx`set local statement_timeout = '120s'`
      await tx`set local lock_timeout = '5s'`
      await tx`set local idle_in_transaction_session_timeout = '10s'`
      await tx`select set_config('app.menu_origin', ${origin}, true)`
      await checkDestinationRows(tx, archive.tables)
      const args = tx`${tx.json(archive)}::jsonb, ${options.slug}::text, ${options.name}::text,
        ${tx.json(userMap)}::jsonb, ${options.actor ?? null}::uuid`
      const [{ policy }] = await tx`select app_private.check_tenant_archive_restore(${args}) as policy`
      const [restored] = options.apply
        ? await tx`select app_private.restore_tenant_archive(${args})::text as id`
        : []
      return {
        mode: options.apply ? 'applied' : 'preflight',
        slug: options.slug,
        tenantId: restored?.id ?? null,
        status: 'suspended',
        counts: archive.counts,
        policy,
        ignoredHosts: archive.hosts.length,
      }
    })
  } catch (error) {
    // SQL messages/details and URL errors can embed user, link or file values. Print only
    // stable diagnostics, never driver context or the error's cause.
    const marker = error.message?.split(':', 1)[0]
    const diagnostic = Object.hasOwn(restoreDiagnostics, marker) ? restoreDiagnostics[marker] : undefined
    if (diagnostic) throw new Error(diagnostic)
    if (['22001', '22003', '22007', '22008', '22021', '22P02', '22P05'].includes(error.code)) {
      throw new Error('archive row has an incompatible destination column value')
    }
    if (error.code === '57014' || error.code === '55P03') throw new Error('tenant restore exceeded the database time limit')
    const code = /^[0-9A-Z]{5}$/.test(error.code) ? ` (SQLSTATE ${error.code})` : ''
    throw new Error(`tenant restore failed${code}`)
  }
}
