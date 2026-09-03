#!/usr/bin/env node
/**
 * Apply ordered SQL migrations, verify/regenerate the schema snapshot, or run
 * an ad-hoc query without requiring psql.
 *
 * Runtime commands use DATABASE_URL. Schema migrations require the separate
 * MIGRATION_DATABASE_URL. The test database splits the same way —
 * TEST_DATABASE_URL for the suite, TEST_MIGRATION_DATABASE_URL for test-apply —
 * and mutating test commands retain the disposable-database safety gate
 * documented in README.md.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyPendingMigrations,
  discoverMigrations,
  renderSchemaSnapshot,
} from './migration-lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../../microservices/web-construct')
const migrationsDir = resolve(here, 'migrations')
const schemaPath = resolve(here, 'schema.sql')

// Resolved from the app's node_modules rather than this file's ancestors: the
// driver is the app's dependency, and devops/ has no package.json of its own.
const require = createRequire(resolve(appDir, 'package.json'))
const postgres = require('postgres')

function applicationDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = resolve(appDir, '.env.local')
  const line = readFileSync(envFile, 'utf8')
    .split('\n')
    .find(value => value.startsWith('DATABASE_URL='))
  if (!line) throw new Error(`DATABASE_URL not set and not found in ${envFile}`)
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
}

function migrationDatabaseUrl() {
  if (!process.env.MIGRATION_DATABASE_URL) {
    throw new Error('MIGRATION_DATABASE_URL is required for schema migrations')
  }
  return process.env.MIGRATION_DATABASE_URL
}

/**
 * The disposable-database gate, applied to whichever test identity is asked for.
 * Both identities reach the same disposable project, so both need the same
 * protection: the gate is about which database may be destroyed, not about the
 * privileges of the login used to get there.
 *
 * The caller passes the value alongside its name rather than letting this
 * function index process.env: a dynamic lookup is invisible to the textual scan
 * in sources/devops/env-contract.test.mjs, which is the only thing that notices
 * when a variable the code reads is missing from every template.
 */
function disposableTestUrl(variable, url, purpose) {
  if (!url) throw new Error(`${variable} is required for ${purpose}`)
  if (process.env.TEST_DATABASE_DISPOSABLE !== '1') {
    throw new Error(`TEST_DATABASE_DISPOSABLE=1 is required for ${purpose}`)
  }
  if (url === applicationDatabaseUrl()) {
    throw new Error(`${variable} must be different from the application DATABASE_URL`)
  }
  return url
}

function testDatabaseUrl() {
  return disposableTestUrl('TEST_DATABASE_URL', process.env.TEST_DATABASE_URL, 'mutating test commands')
}

/**
 * Migrations own the schema, so they need an identity that TEST_DATABASE_URL
 * deliberately no longer carries. Splitting the two is what makes the runtime
 * boundary observable on the test database: while one variable served both, the
 * suite had to connect as the migration owner, and every privilege assertion in
 * lib/schema-contract.integration.test.ts passed for the wrong reason — it named
 * `construct_runtime` literally, so it never noticed that the connection sat
 * outside that role. Kept in sources/devops/db/operator.env, not in
 * .env.test.local: the web-construct-e2e configuration in .claude/launch.json
 * bulk-sources that file into a Next process.
 */
function testMigrationDatabaseUrl() {
  return disposableTestUrl(
    'TEST_MIGRATION_DATABASE_URL', process.env.TEST_MIGRATION_DATABASE_URL, 'test-database schema migrations',
  )
}

function migrationAdapter(sql) {
  return {
    async loadHistory() {
      await sql.unsafe(`
        create table if not exists public.construct_schema_migration (
          version text primary key,
          name text not null,
          checksum char(64) not null,
          started_at timestamptz not null default clock_timestamp(),
          completed_at timestamptz
        )
      `).simple()
      return sql`
        select version, checksum, completed_at as "completedAt"
        from public.construct_schema_migration
        order by version
      `
    },
    async markStarted(migration) {
      await sql`
        insert into public.construct_schema_migration
          (version, name, checksum, started_at, completed_at)
        values
          (${migration.version}, ${migration.name}, ${migration.checksum}, clock_timestamp(), null)
        on conflict (version) do update
          set name = excluded.name,
              checksum = excluded.checksum,
              started_at = excluded.started_at,
              completed_at = null
      `
    },
    async runInTransaction(migration) {
      await sql`begin`
      try {
        await sql.unsafe(migration.sql).simple()
        await sql`
          update public.construct_schema_migration
          set completed_at = clock_timestamp()
          where version = ${migration.version}
        `
        await sql`commit`
      } catch (error) {
        await sql`rollback`
        throw error
      }
    },
  }
}

async function runMigrations(connectionUrl) {
  const sql = postgres(connectionUrl, {
    prepare: false,
    connect_timeout: 30,
    idle_timeout: 5,
    onnotice: notice => console.log(`NOTICE: ${notice.message}`),
  })
  let connection
  try {
    connection = await sql.reserve()
    await connection`select pg_advisory_lock(49374200)`
    const migrations = discoverMigrations(migrationsDir)
    const applied = await applyPendingMigrations(migrationAdapter(connection), migrations)
    if (applied.length) console.log(`applied migration(s): ${applied.join(', ')}`)
    else console.log('database schema is up to date')
  } finally {
    if (connection) {
      try {
        await connection`select pg_advisory_unlock(49374200)`
      } finally {
        connection.release()
      }
    }
    await sql.end({ timeout: 5 })
  }
}

async function provisionRuntimeRole() {
  const username = process.env.CONSTRUCT_RUNTIME_DB_USER
  const password = process.env.CONSTRUCT_RUNTIME_DB_PASSWORD
  if (!username || !/^[a-z_][a-z0-9_]{0,62}$/.test(username)) {
    throw new Error('CONSTRUCT_RUNTIME_DB_USER must be a valid PostgreSQL role name')
  }
  if (!password || password.length < 24) {
    throw new Error('CONSTRUCT_RUNTIME_DB_PASSWORD must contain at least 24 characters')
  }
  if (username === 'construct_runtime') {
    throw new Error('CONSTRUCT_RUNTIME_DB_USER must be a login role, not construct_runtime')
  }

  const sql = postgres(migrationDatabaseUrl(), { prepare: false, connect_timeout: 30, idle_timeout: 5 })
  try {
    const exists = await sql`select 1 from pg_roles where rolname = ${username}`
    if (exists.length) {
      const unexpectedMemberships = await sql`
        select granted.rolname
        from pg_auth_members membership
        join pg_roles member on member.oid = membership.member
        join pg_roles granted on granted.oid = membership.roleid
        where member.rolname = ${username} and granted.rolname <> 'construct_runtime'
      `
      const ownedObjects = await sql`
        select 'database' as kind from pg_database d join pg_roles r on r.oid = d.datdba where r.rolname = ${username}
        union all
        select 'schema' from pg_namespace n join pg_roles r on r.oid = n.nspowner where r.rolname = ${username}
        union all
        select 'relation' from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = ${username}
        union all
        select 'function' from pg_proc p join pg_roles r on r.oid = p.proowner where r.rolname = ${username}
        limit 1
      `
      const directGrants = await sql`
        select 1 from information_schema.role_table_grants where grantee = ${username}
        union all select 1 from information_schema.role_routine_grants where grantee = ${username}
        union all select 1 from information_schema.role_usage_grants where grantee = ${username}
        limit 1
      `
      const directAclGrants = await sql`
        select 1
        from pg_database database_row
        cross join lateral aclexplode(coalesce(database_row.datacl, acldefault('d', database_row.datdba))) acl
        join pg_roles grantee on grantee.oid = acl.grantee
        where grantee.rolname = ${username}
        union all
        select 1
        from pg_namespace schema_row
        cross join lateral aclexplode(coalesce(schema_row.nspacl, acldefault('n', schema_row.nspowner))) acl
        join pg_roles grantee on grantee.oid = acl.grantee
        where grantee.rolname = ${username}
        union all
        select 1
        from pg_default_acl defaults
        cross join lateral aclexplode(coalesce(defaults.defaclacl, acldefault(defaults.defaclobjtype, defaults.defaclrole))) acl
        join pg_roles grantee on grantee.oid = acl.grantee
        where grantee.rolname = ${username}
        limit 1
      `
      if (unexpectedMemberships.length || ownedObjects.length || directGrants.length || directAclGrants.length) {
        throw new Error('existing runtime login has unexpected memberships, ownership, direct grants, or default ACLs')
      }
    }
    const passwordLiteral = password.replaceAll("'", "''")
    if (exists.length) {
      await sql.unsafe(`alter role "${username}" login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${passwordLiteral}'`)
    } else {
      await sql.unsafe(`create role "${username}" login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${passwordLiteral}'`)
    }
    await sql.unsafe(`grant construct_runtime to "${username}"`)
    console.log(`provisioned limited runtime login ${username}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/**
 * The runtime boundary, asked of whatever DATABASE_URL currently points at.
 *
 * The equivalent spec — `connects through the runtime role and nothing wider` in
 * the app's lib/schema-contract.integration.test.ts — can only ever run against
 * the disposable test database, because resolveDatabaseUrl refuses to hand the
 * suite a URL equal to DATABASE_URL. That refusal is worth keeping: it is what
 * stops a mutating suite from reaching development. But it also leaves
 * development, staging and production with no way to ask the question, and that
 * is exactly how an owner-level connection string can sit in .env.local for
 * months without anyone noticing — in development nothing fails, because the
 * application is its own superuser.
 *
 * Read-only, so it is safe to point at production. The four probes are the same
 * four the spec makes; the two are deliberate duplicates in two runtimes and will
 * drift if edited apart. Change one, change the other.
 */
async function boundaryCheck() {
  const sql = postgres(applicationDatabaseUrl(), { prepare: false, connect_timeout: 30, idle_timeout: 5 })
  const failures = []
  try {
    const [identity] = await sql`
      select current_user as role, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      from pg_roles where rolname = current_user
    `
    if (!identity) throw new Error('the connected role is absent from pg_roles')
    const attributes = ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls']
      .filter(attribute => identity[attribute])
    console.log(`connected as ${identity.role}`)

    const report = (label, ok, detail) => {
      console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`)
      if (!ok) failures.push(label)
    }
    report('holds no privileged role attribute', !attributes.length, attributes.join(', '))

    // `distinct`: one role granted by two grantors is two rows in pg_auth_members,
    // and a duplicate must not read as a second membership.
    const memberships = await sql`
      select distinct granted.rolname as granted
      from pg_auth_members membership
      join pg_roles member on member.oid = membership.member
      join pg_roles granted on granted.oid = membership.roleid
      where member.rolname = current_user
      order by granted.rolname
    `
    const granted = memberships.map(row => row.granted)
    report(
      'inherits construct_runtime and nothing else',
      granted.length === 1 && granted[0] === 'construct_runtime',
      granted.join(', ') || '(no memberships)',
    )

    // Membership is not the whole story: privileges granted straight to the login
    // inherit from nothing, so they survive the membership check above.
    const direct = await sql`
      select 'table' as source from information_schema.role_table_grants where grantee = current_user
      union all select 'routine' from information_schema.role_routine_grants where grantee = current_user
      union all select 'usage' from information_schema.role_usage_grants where grantee = current_user
    `
    // Counted per kind, not listed: an owner-level login answers this with
    // hundreds of rows, and a wall of the word "table" says less than "table×360".
    const grantCounts = [...direct.reduce((counts, row) => {
      counts.set(row.source, (counts.get(row.source) ?? 0) + 1)
      return counts
    }, new Map())].map(([source, count]) => `${source}×${count}`)
    report('holds no direct grants', !direct.length, grantCounts.join(', '))

    const [history] = await sql`
      select has_table_privilege(current_user, 'public.construct_schema_migration', 'select') as allowed
    `
    report('cannot read migration history', history.allowed === false)
  } finally {
    await sql.end({ timeout: 5 })
  }
  if (failures.length) {
    throw new Error(`the connection is outside the runtime boundary: ${failures.join('; ')}`)
  }
  console.log('the connection sits inside the runtime boundary')
}

function expectedSchemaSnapshot() {
  return renderSchemaSnapshot(discoverMigrations(migrationsDir))
}

function writeSchemaSnapshot() {
  writeFileSync(schemaPath, expectedSchemaSnapshot(), 'utf8')
  console.log(`wrote ${schemaPath}`)
}

function checkSchemaSnapshot() {
  const expected = expectedSchemaSnapshot()
  const actual = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : ''
  if (actual !== expected) {
    throw new Error('schema.sql is out of date; run db.mjs schema-write')
  }
  console.log('schema.sql matches ordered migrations')
}

async function runDatabaseCommand(command, argument) {
  const testCommands = new Set(['test-query', 'test-reset-e2e', 'test-delete-user'])
  const sql = postgres(testCommands.has(command) ? testDatabaseUrl() : applicationDatabaseUrl(), {
    prepare: false,
    connect_timeout: 30,
    idle_timeout: 5,
    onnotice: notice => console.log(`NOTICE: ${notice.message}`),
  })
  try {
    if (command === 'test-reset-e2e') {
      const emails = [process.env.TEST_EMAIL, process.env.TEST_EMAIL_USER].filter(Boolean)
      if (!emails.length) throw new Error('TEST_EMAIL or TEST_EMAIL_USER is required')
      const result = await sql`update users set id_language = null where email = any(${emails})`
      console.log(`reset language preference for ${result.count} E2E fixture user(s)`)
    } else if (command === 'test-delete-user') {
      const email = process.env.E2E_REGISTER_EMAIL
      if (!email) throw new Error('E2E_REGISTER_EMAIL is required')
      const result = await sql`delete from users where email = ${email}`
      console.log(`deleted ${result.count} E2E registration fixture user(s)`)
    } else {
      if (!argument) throw new Error('query requires a SQL argument')
      const result = await sql.unsafe(argument).simple()
      const resultSets = Array.isArray(result[0]) ? result : [result]
      for (const rows of resultSets) {
        if (rows.length) console.table([...rows])
        else console.log('(0 rows)')
      }
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

const [command, argument] = process.argv.slice(2)
const supported = new Set([
  'apply',
  'boundary-check',
  'provision-runtime-role',
  'query',
  'schema-check',
  'schema-write',
  'test-apply',
  'test-query',
  'test-reset-e2e',
  'test-delete-user',
])

if (!supported.has(command)) {
  console.error('usage: db.mjs apply | boundary-check | provision-runtime-role | query "<sql>" | schema-check | schema-write | test-apply | test-query "<sql>" | test-reset-e2e | test-delete-user')
  process.exit(2)
}

try {
  if (command === 'schema-write') writeSchemaSnapshot()
  else if (command === 'schema-check') checkSchemaSnapshot()
  else if (command === 'apply') await runMigrations(migrationDatabaseUrl())
  else if (command === 'boundary-check') await boundaryCheck()
  else if (command === 'provision-runtime-role') await provisionRuntimeRole()
  else if (command === 'test-apply') await runMigrations(testMigrationDatabaseUrl())
  else await runDatabaseCommand(command, argument)
} catch (err) {
  console.error(`ERROR: ${err.message}`)
  if (err.position) console.error(`  at character ${err.position}`)
  if (err.where) console.error(`  in ${err.where}`)
  process.exitCode = 1
}
