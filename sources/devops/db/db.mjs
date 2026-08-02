#!/usr/bin/env node
/**
 * Apply ordered SQL migrations, verify/regenerate the schema snapshot, or run
 * an ad-hoc query without requiring psql.
 *
 * Runtime commands use DATABASE_URL. Schema migrations require the separate
 * MIGRATION_DATABASE_URL. Mutating test commands retain the disposable-database
 * safety gate documented in README.md.
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

function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is required for mutating test commands')
  if (process.env.TEST_DATABASE_DISPOSABLE !== '1') {
    throw new Error('TEST_DATABASE_DISPOSABLE=1 is required for mutating test commands')
  }
  if (url === applicationDatabaseUrl()) {
    throw new Error('TEST_DATABASE_URL must be different from the application DATABASE_URL')
  }
  return url
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
  console.error('usage: db.mjs apply | provision-runtime-role | query "<sql>" | schema-check | schema-write | test-apply | test-query "<sql>" | test-reset-e2e | test-delete-user')
  process.exit(2)
}

try {
  if (command === 'schema-write') writeSchemaSnapshot()
  else if (command === 'schema-check') checkSchemaSnapshot()
  else if (command === 'apply') await runMigrations(migrationDatabaseUrl())
  else if (command === 'provision-runtime-role') await provisionRuntimeRole()
  else if (command === 'test-apply') await runMigrations(testDatabaseUrl())
  else await runDatabaseCommand(command, argument)
} catch (err) {
  console.error(`ERROR: ${err.message}`)
  if (err.position) console.error(`  at character ${err.position}`)
  if (err.where) console.error(`  in ${err.where}`)
  process.exitCode = 1
}
