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
        // Tutte le migrazioni di un apply condividono la stessa connessione: una migrazione che
        // imposta il tenant a livello di sessione (set_config(..., false)) non deve lasciarlo alle
        // migrazioni successive, che scriverebbero nel suo tenant invece di fallire con 42501
        // (Review Focus 2).
        await sql`select set_config('app.tenant_id', '', false)`
        // Dalla 0045 in poi ogni migrazione lavora come construct_owner, che possiede gli oggetti e
        // non ha BYPASSRLS: la RLS forzata vale anche qui (specifica 2026-10-13, §2.1). La 0045
        // stessa gira ancora come utente delle migrazioni, perché il ruolo non esiste ancora.
        const [{ ownerExists }] = await sql`
          select exists (select 1 from pg_roles where rolname = 'construct_owner') as "ownerExists"
        `
        if (ownerExists) await sql`set local role construct_owner`
        await sql.unsafe(migration.sql).simple()
        // La cronologia resta dell'utente delle migrazioni, non del proprietario.
        await sql`reset role`
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
 * Read-only, so it is safe to point at production. The probes are the ones the spec
 * makes, in three groups: who the connection is (privileged attributes, memberships,
 * direct grants, migration history), who owns the application objects (relations and
 * functions in public and app_private, and the app_private schema; no security definer
 * function), and how the tenant boundary is closed (every table classified, row level
 * security forced; on every tenant table id_tenant, its foreign key and default, both
 * tenant policies, the leading index and the composite keys; on every global table the
 * policy and grants of its class). The tenant and global probes are the same queries as
 * the contract test, copied: the two are deliberate duplicates in two runtimes and will
 * drift if edited apart. Change one, change the other: the contract test is
 * lib/schema-contract.integration.test.ts.
 *
 * Every probe reports: on a database that has not yet received the migrations that
 * create what a probe looks at (construct_owner, app_private), the probe prints FAIL
 * instead of aborting the whole command with a raw error.
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

    const [ownerRole] = await sql`
      select rolbypassrls, rolcanlogin, rolsuper from pg_roles where rolname = 'construct_owner'
    `
    report(
      'construct_owner exists without BYPASSRLS, login and superuser',
      Boolean(ownerRole) && !ownerRole.rolbypassrls && !ownerRole.rolcanlogin && !ownerRole.rolsuper,
    )
    // Il proprietario si cerca per nome attraverso pg_roles e non con un cast a regrole: il cast
    // fa abortire l'intero comando dove construct_owner non esiste ancora, e la sonda deve
    // invece dire FAIL.
    const strays = await sql`
      select n.nspname || '.' || c.relname as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_roles r on r.oid = c.relowner
      where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p', 'v', 'S')
        and c.relname <> 'construct_schema_migration'
        and r.rolname <> 'construct_owner'
        and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      order by 1
    `
    report('construct_owner owns every application relation', !strays.length, strays.map(row => row.name).join(', '))
    const strayFunctions = await sql`
      select n.nspname || '.' || p.proname as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
      where n.nspname in ('public', 'app_private')
        and r.rolname <> 'construct_owner'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by 1
    `
    report(
      'construct_owner owns every application function',
      !strayFunctions.length,
      strayFunctions.map(row => row.name).join(', '),
    )
    const strayNamespaces = await sql`
      select n.nspname as name
      from pg_namespace n join pg_roles r on r.oid = n.nspowner
      where n.nspname = 'app_private' and r.rolname <> 'construct_owner'
    `
    report('construct_owner owns the app_private schema', !strayNamespaces.length, strayNamespaces.map(row => row.name).join(', '))
    const definers = await sql`
      select n.nspname || '.' || p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private') and p.prosecdef
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by 1
    `
    report('no function runs with its owner rights', !definers.length, definers.map(row => row.name).join(', '))

    const [{ hasRegistry }] = await sql`select to_regclass('app_private.table_class') is not null as "hasRegistry"`
    if (!hasRegistry) {
      report('the table classification registry exists', false, 'app_private.table_class is absent')
    } else {
      const unclassified = await sql`
        select c.relname as name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'construct_schema_migration'
          and not exists (select 1 from app_private.table_class tc where tc.table_name = c.relname)
        order by 1
      `
      report('every application table is classified', !unclassified.length, unclassified.map(row => row.name).join(', '))
      const loose = await sql`
        select tc.table_name as name
        from app_private.table_class tc
        join pg_class c on c.relname = tc.table_name and c.relnamespace = 'public'::regnamespace
        where not (c.relrowsecurity and c.relforcerowsecurity)
        order by 1
      `
      report('row level security is forced on every classified table', !loose.length, loose.map(row => row.name).join(', '))
      // Specchio di 'guards every tenant table with the tenant policies, a leading index and
      // composite keys' del test di contratto: stessa interrogazione, una riga per violazione.
      const tenantViolations = await sql`
        with tenant_tables as (
          select c.oid, c.relname
          from app_private.table_class tc
          join pg_class c on c.relname = tc.table_name and c.relnamespace = 'public'::regnamespace
          where tc.class = 'tenant'
        )
        select t.relname as name, 'id_tenant' as problem from tenant_tables t
        where not exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = 'id_tenant'
                          and a.attnotnull and a.atttypid = 'int8'::regtype)
        union all
        select t.relname, 'tenant foreign key' from tenant_tables t
        where not exists (
          select 1 from pg_constraint k
          where k.conrelid = t.oid and k.contype = 'f' and k.confrelid = 'public.tenant'::regclass
            and k.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = t.oid and a.attname = 'id_tenant')])
        union all
        select t.relname, 'tenant default' from tenant_tables t
        where not exists (
          select 1 from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
          where d.adrelid = t.oid and a.attname = 'id_tenant'
            and pg_get_expr(d.adbin, d.adrelid) like '%current_tenant_id%')
        union all
        select t.relname, 'tenant_boundary' from tenant_tables t
        where not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = t.relname and p.policyname = 'tenant_boundary'
            and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL'
            and p.roles @> array['construct_runtime', 'construct_owner']::name[]
            and p.qual like '%current_tenant_id%' and p.with_check like '%current_tenant_id%')
        union all
        select t.relname, 'tenant_access' from tenant_tables t
        where not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = t.relname and p.policyname = 'tenant_access'
            and p.permissive = 'PERMISSIVE' and p.cmd = 'ALL')
        union all
        select t.relname, 'leading index' from tenant_tables t
        where not exists (
          select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
          where i.indrelid = t.oid and a.attname = 'id_tenant')
        union all
        select t.relname, 'foreign key ' || k.conname from tenant_tables t
        join pg_constraint k on k.conrelid = t.oid and k.contype = 'f'
        join tenant_tables target on target.oid = k.confrelid
        where not exists (
          select 1 from unnest(k.conkey) key_column(attnum)
          join pg_attribute a on a.attrelid = t.oid and a.attnum = key_column.attnum
          where a.attname = 'id_tenant')
        order by 1, 2
      `
      const tenantProbes = [
        ['every tenant table has id_tenant bigint not null', problem => problem === 'id_tenant'],
        ['every tenant table has a foreign key from id_tenant to tenant', problem => problem === 'tenant foreign key'],
        ['every tenant table defaults id_tenant to the tenant of the transaction', problem => problem === 'tenant default'],
        ['every tenant table has its restrictive tenant_boundary policy on the tenant of the transaction', problem => problem === 'tenant_boundary'],
        ['every tenant table has its permissive tenant_access policy', problem => problem === 'tenant_access'],
        ['every tenant table has an index led by id_tenant', problem => problem === 'leading index'],
        ['foreign keys between tenant tables carry id_tenant', problem => problem.startsWith('foreign key ')],
      ]
      for (const [label, matches] of tenantProbes) {
        const rows = tenantViolations.filter(row => matches(row.problem))
        report(label, !rows.length, rows.map(row => row.problem.startsWith('foreign key ') ? `${row.name} (${row.problem})` : row.name).join(', '))
      }
      // Specchio di 'gives global tables the policies and grants of their class'.
      const globalViolations = await sql`
        select tc.table_name as name, 'policy' as problem
        from app_private.table_class tc
        where tc.class <> 'tenant' and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = tc.table_name
            and p.policyname = case tc.class when 'global_write' then 'global_access' else 'global_read' end)
        union all
        select tc.table_name, 'write grant on a read-only table'
        from app_private.table_class tc
        where tc.class = 'global_read'
          and has_table_privilege('construct_runtime', format('public.%I', tc.table_name), 'insert,update,delete')
        order by 1, 2
      `
      for (const [label, problem] of [
        ['every global table has the policy of its class', 'policy'],
        ['no read-only global table is writable by construct_runtime', 'write grant on a read-only table'],
      ]) {
        const rows = globalViolations.filter(row => row.problem === problem)
        report(label, !rows.length, rows.map(row => row.name).join(', '))
      }
    }
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
    // Dalla 0046 le tabelle di tenant ricevono id_tenant dal contesto, e dalla 0047 lo pretendono.
    // Questi comandi lavorano sempre sul tenant predefinito: è l'unico in questo pezzo (specifica
    // 2026-10-13, MTF-DEC-2). Nessuno stato di sessione (MTF-DEC-7): dietro il pooler in modalità
    // transazione ogni istruzione fuori da una transazione può finire su un altro processo del
    // server, e un set_config di sessione resterebbe lì per chiunque arrivi dopo. Il comando gira
    // quindi in una transazione sola, con il tenant impostato a livello di transazione.
    const [{ hasTenantTable }] = await sql`select to_regclass('public.tenant') is not null as "hasTenantTable"`
    await sql.begin(async tx => {
      if (hasTenantTable) {
        await tx`select set_config('app.tenant_id', (select id::text from public.tenant where slug = 'default'), true)`
      }
      await runCommandBody(tx, command, argument)
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function runCommandBody(sql, command, argument) {
  if (command === 'test-reset-e2e') {
    const emails = [process.env.TEST_EMAIL, process.env.TEST_EMAIL_USER].filter(Boolean)
    if (!emails.length) throw new Error('TEST_EMAIL or TEST_EMAIL_USER is required')
    // Lingua, tema e dimensione del testo stanno sul profilo, e il colore dell'app e' globale:
    // un test che li cambia e non li rimette a posto altera tutti quelli dopo, senza che
    // l'errore nomini mai la causa (vedi conftest.py, clean_language_preferences).
    const result = await sql`
      update users set id_language = null, theme_mode = 'system', text_scale = 100
      where email = any(${emails})
    `
    // Anche il colore del modo scuro (0038) e le quattro superfici per modo (0033): null vuol dire
    // «ricavato dal chiaro» e «il valore fisso».
    await sql`
      update app_theme set primary_color = '#4f46e5', primary_dark = null,
        background_light = null, card_light = null, accent_light = null, sidebar_light = null,
        background_dark = null, card_dark = null, accent_dark = null, sidebar_dark = null,
        date_mod = now()
    `
    console.log(`reset language and appearance for ${result.count} E2E fixture user(s) and the app theme`)
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
