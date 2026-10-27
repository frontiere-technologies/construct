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
  parseApplyArguments,
  parsePlatformAdminArguments,
  parseTenantCreateArguments,
  parseTenantDeleteArguments,
  parseTenantHostArguments,
  parseTenantMemberArguments,
  recordCommandAudit,
  renderSchemaSnapshot,
  selectMigrationsUpTo,
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

async function runMigrations(connectionUrl, { to } = {}) {
  // Prima di aprire la connessione: una versione inesistente non deve toccare il database.
  const migrations = discoverMigrations(migrationsDir)
  selectMigrationsUpTo(migrations, to)
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
    const applied = await applyPendingMigrations(migrationAdapter(connection), migrations, { to })
    if (applied.length) console.log(`applied migration(s): ${applied.join(', ')}`)
    else if (to) console.log(`nothing to apply up to ${to}`)
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

/**
 * Un login di servizio per l'app, creato o riallineato da zero ogni volta (idempotente). Il ruolo
 * runtime e quello di piattaforma hanno la stessa forma e differiscono in due cose: il ruolo di cui
 * il login è l'unico membro (`construct_runtime` o `construct_owner`) e se lo eredita (il login
 * runtime sì, quello di piattaforma NO: senza `set local role` non ha alcun privilegio, §2.2).
 * Un login già esistente con altre appartenenze, oggetti, privilegi diretti o ACL predefinite viene
 * rifiutato, mai ripulito in silenzio.
 */
async function provisionServiceLogin({ label, userVariable, passwordVariable, groupRole, inheritsGroup }) {
  const username = process.env[userVariable]
  const password = process.env[passwordVariable]
  if (!username || !/^[a-z_][a-z0-9_]{0,62}$/.test(username)) {
    throw new Error(`${userVariable} must be a valid PostgreSQL role name`)
  }
  if (!password || password.length < 24) {
    throw new Error(`${passwordVariable} must contain at least 24 characters`)
  }
  if (username === 'construct_runtime' || username === 'construct_owner') {
    throw new Error(`${userVariable} must be a login role, not ${username}`)
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
        where member.rolname = ${username} and granted.rolname <> ${groupRole}
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
        throw new Error(`existing ${label} login has unexpected memberships, ownership, direct grants, or default ACLs`)
      }
    }
    const passwordLiteral = password.replaceAll("'", "''")
    const inheritance = inheritsGroup ? 'inherit' : 'noinherit'
    const verb = exists.length ? 'alter' : 'create'
    await sql.unsafe(`${verb} role "${username}" login ${inheritance} nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${passwordLiteral}'`)
    // Da PostgreSQL 16 l'ereditarietà è anche un'opzione della singola appartenenza, e un `grant` su
    // un'appartenenza che esiste già non la cambia: la si dice esplicitamente.
    const [{ version }] = await sql`select current_setting('server_version_num')::int as version`
    await sql.unsafe(version >= 160000
      ? `grant ${groupRole} to "${username}" with inherit ${inheritsGroup ? 'true' : 'false'}${inheritsGroup ? '' : ', set true'}`
      : `grant ${groupRole} to "${username}"`)
    // Verifica dopo la concessione, solo per il login che non eredita (quello di piattaforma, MT5-RISK-1):
    // l'appartenenza esiste con le opzioni volute (da PostgreSQL 16 sono per appartenenza, e un
    // `grant` già presente poteva averle diverse), e nessun ruolo può diventare il login (sotto, la
    // sola appartenenza in quel verso che si ammette).
    if (!inheritsGroup) {
      if (version >= 160000) {
        const wrongOption = await sql`
          select 1
          from pg_auth_members membership
          join pg_roles member on member.oid = membership.member
          join pg_roles granted on granted.oid = membership.roleid
          where member.rolname = ${username} and granted.rolname = ${groupRole}
            and (membership.inherit_option is not false or membership.set_option is not true)
        `
        if (wrongOption.length) {
          throw new Error(`the ${label} login ${username} is a member of ${groupRole} with the wrong options (expected inherit false, set true)`)
        }
      }
      // Ogni riga con il login come ruolo concesso. Da PostgreSQL 16 solo una è ammessa: quella che
      // PostgreSQL stesso registra per chi ha creato il ruolo (verificato: member = chi crea, grantor =
      // il superutente di bootstrap, oid 10, con la sola opzione admin, senza inherit né set). Qualunque
      // altra, anche con inherit e set falsi, è una strada: chi ha ADMIN sul login può concedersi
      // `with set true` e da lì passare a construct_owner. Prima della 16 nessuna riga è ammessa.
      // to_jsonb: le colonne delle opzioni non esistono prima della 16, e la sonda non deve nominarle.
      const reverse = await sql`
        select member.rolname as member, membership.admin_option as admin,
          to_jsonb(membership) ->> 'inherit_option' as inherit_option,
          to_jsonb(membership) ->> 'set_option' as set_option,
          membership.grantor::int8 as grantor,
          (${version >= 160000}
            and member.rolname = current_user
            and membership.admin_option
            and to_jsonb(membership) ->> 'inherit_option' = 'false'
            and to_jsonb(membership) ->> 'set_option' = 'false'
            and membership.grantor = 10) as creator_grant
        from pg_auth_members membership
        join pg_roles login on login.oid = membership.roleid
        join pg_roles member on member.oid = membership.member
        where login.rolname = ${username}
      `
      const foreign = reverse.filter(row => !row.creator_grant)
      if (foreign.length) {
        const described = foreign.map(row => `${row.member} (admin ${row.admin}, inherit ${row.inherit_option ?? 'n/a'}, set ${row.set_option ?? 'n/a'}, grantor ${row.grantor})`)
        throw new Error(`the ${label} login ${username} has members: ${described.join('; ')}: only the automatic grant to its creator (admin only) is allowed`)
      }
    }
    console.log(`provisioned limited ${label} login ${username}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function provisionRuntimeRole() {
  await provisionServiceLogin({
    label: 'runtime',
    userVariable: 'CONSTRUCT_RUNTIME_DB_USER',
    passwordVariable: 'CONSTRUCT_RUNTIME_DB_PASSWORD',
    groupRole: 'construct_runtime',
    inheritsGroup: true,
  })
}

/**
 * L'identità di piattaforma (specifica 2026-10-26, §2.2, MT5-RISK-1): il login con cui la console
 * scrive `tenant`, `tenant_host` e crea tenant dal modello. Membro di construct_owner con NOINHERIT:
 * da solo non ha alcun privilegio, e solo `withPlatform` (lib/platform/db.ts) passa a construct_owner
 * con `set local role`. Senza BYPASSRLS, senza superutente, senza createrole né createdb. Come il
 * login runtime si crea dopo le migrazioni (construct_owner lo crea la 0002) e si può rilanciare.
 */
async function provisionPlatformRole() {
  await provisionServiceLogin({
    label: 'platform',
    userVariable: 'CONSTRUCT_PLATFORM_DB_USER',
    passwordVariable: 'CONSTRUCT_PLATFORM_DB_PASSWORD',
    groupRole: 'construct_owner',
    inheritsGroup: false,
  })
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
 * policy and grants of its class). Where the platform identity (construct_platform) exists,
 * it is held to its own shape too: a NOINHERIT member of construct_owner and nothing else, no
 * privileged attribute, no direct grant, owns nothing; and the connection is never a member of it. The tenant and global probes are the same queries as
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
    // L'identità di piattaforma (specifica 2026-10-26, §2.2, MT5-RISK-1) esiste solo dove è stata
    // configurata: dove non lo è e il ruolo non c'è, la sonda lo dice e passa; dove c'è (o dove
    // CONSTRUCT_PLATFORM_DB_USER la dà per configurata) si pretende tutto, e il login dell'app non
    // ne è mai membro. Per nome attraverso pg_roles, come sopra: nessun cast a regrole.
    const platformConfigured = Boolean(process.env.CONSTRUCT_PLATFORM_DB_USER)
    const platformName = process.env.CONSTRUCT_PLATFORM_DB_USER || 'construct_platform'
    const [platformRole] = await sql`
      select oid::int8 as oid, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      from pg_roles where rolname = ${platformName}
    `
    if (!platformRole) {
      if (platformConfigured) report(`the platform identity ${platformName} exists`, false, 'configured but absent: run provision-platform-role')
      else console.log('  skip  the platform identity: not configured and absent (no console on this database)')
    } else {
      const platformAttributes = ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls']
        .filter(attribute => platformRole[attribute])
      report(
        'the platform identity is a login without privileged role attributes',
        platformRole.rolcanlogin && !platformAttributes.length,
        platformRole.rolcanlogin ? platformAttributes.join(', ') : 'it cannot log in',
      )
      // Da PostgreSQL 16 l'ereditarietà è un'opzione dell'appartenenza (inherit_option); prima è
      // l'attributo del ruolo. to_jsonb lascia la sonda valida su entrambe.
      const platformMemberships = await sql`
        select distinct granted.rolname as granted,
          coalesce((to_jsonb(membership) ->> 'inherit_option')::boolean, member.rolinherit) as inherits
        from pg_auth_members membership
        join pg_roles member on member.oid = membership.member
        join pg_roles granted on granted.oid = membership.roleid
        where member.rolname = ${platformName}
        order by granted.rolname
      `
      const platformGranted = [...new Set(platformMemberships.map(row => row.granted))]
      report(
        'the platform identity is a member of construct_owner and nothing else',
        platformGranted.length === 1 && platformGranted[0] === 'construct_owner',
        platformGranted.join(', ') || '(no memberships)',
      )
      report(
        'the platform identity does not inherit construct_owner (NOINHERIT: no privileges before set local role)',
        platformMemberships.length > 0 && platformMemberships.every(row => row.inherits === false),
        platformMemberships.filter(row => row.inherits !== false).map(row => row.granted).join(', '),
      )
      // Dal catalogo e non da information_schema: quest'ultimo mostra solo i privilegi che chi si
      // collega può vedere, e il login dell'app non vede quelli di un altro ruolo.
      const platformDirect = await sql`
        select 'table' as source from pg_class c cross join lateral aclexplode(c.relacl) acl
          where acl.grantee = ${platformRole.oid}::oid
        union all select 'column' from pg_attribute a cross join lateral aclexplode(a.attacl) acl
          where acl.grantee = ${platformRole.oid}::oid
        union all select 'routine' from pg_proc p cross join lateral aclexplode(p.proacl) acl
          where acl.grantee = ${platformRole.oid}::oid
        union all select 'schema' from pg_namespace n cross join lateral aclexplode(n.nspacl) acl
          where acl.grantee = ${platformRole.oid}::oid
        union all select 'database' from pg_database d cross join lateral aclexplode(d.datacl) acl
          where acl.grantee = ${platformRole.oid}::oid
        union all select 'default' from pg_default_acl x cross join lateral aclexplode(x.defaclacl) acl
          where acl.grantee = ${platformRole.oid}::oid
        union all select 'owns table' from pg_class c where c.relowner = ${platformRole.oid}::oid
        union all select 'owns function' from pg_proc p where p.proowner = ${platformRole.oid}::oid
        union all select 'owns schema' from pg_namespace n where n.nspowner = ${platformRole.oid}::oid
      `
      const platformDirectCounts = [...platformDirect.reduce((counts, row) => {
        counts.set(row.source, (counts.get(row.source) ?? 0) + 1)
        return counts
      }, new Map())].map(([source, count]) => `${source}×${count}`)
      report('the platform identity holds no direct grants and owns nothing', !platformDirect.length, platformDirectCounts.join(', '))
    }
    // Il login dell'app non diventa mai construct_owner né l'identità di piattaforma, nemmeno per via
    // indiretta (pg_has_role segue le catene di appartenenza).
    const reachable = await sql`
      select r.rolname as name
      from pg_roles r
      where r.rolname = any(${['construct_owner', platformName]}::name[]) and r.rolname <> current_user
        and pg_has_role(current_user, r.oid, 'MEMBER')
      order by 1
    `
    report(
      'the connection is a member of neither construct_owner nor the platform identity',
      !reachable.length,
      reachable.map(row => row.name).join(', '),
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
            and p.policyname = case tc.class
              when 'global_write' then 'global_access'
              when 'global_insert_only' then 'global_insert'
              else 'global_read' end)
        union all
        select tc.table_name, 'write grant on a read-only table'
        from app_private.table_class tc
        where tc.class = 'global_read'
          and has_table_privilege('construct_runtime', format('public.%I', tc.table_name), 'insert,update,delete')
        union all
        select tc.table_name, 'insert-only table the runtime cannot insert into'
        from app_private.table_class tc
        where tc.class = 'global_insert_only'
          and not has_table_privilege('construct_runtime', format('public.%I', tc.table_name), 'insert')
        union all
        select tc.table_name, 'insert-only table the runtime can read, update, delete or truncate'
        from app_private.table_class tc
        where tc.class = 'global_insert_only'
          and (has_table_privilege('construct_runtime', format('public.%I', tc.table_name), 'delete,truncate,trigger')
            or has_any_column_privilege('construct_runtime', format('public.%I', tc.table_name), 'select,update,references'))
        union all
        select tc.table_name, 'insert-only table with a policy beyond global_owner and global_insert'
        from app_private.table_class tc
        join pg_policies p on p.schemaname = 'public' and p.tablename = tc.table_name
        where tc.class = 'global_insert_only' and p.policyname not in ('global_owner', 'global_insert')
        union all
        select tc.table_name, 'insert-only table whose global_insert is not an insert policy of construct_runtime alone'
        from app_private.table_class tc
        where tc.class = 'global_insert_only' and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = tc.table_name and p.policyname = 'global_insert'
            and p.cmd = 'INSERT' and p.roles = array['construct_runtime']::name[])
        union all
        select tc.table_name, 'insert-only table whose identity sequence is reachable by the runtime'
        from app_private.table_class tc
        where tc.class = 'global_insert_only'
          and pg_get_serial_sequence(format('public.%I', tc.table_name), 'id') is not null
          and has_sequence_privilege('construct_runtime', pg_get_serial_sequence(format('public.%I', tc.table_name), 'id'), 'usage,select,update')
        order by 1, 2
      `
      for (const [label, problem] of [
        ['every global table has the policy of its class', 'policy'],
        ['no read-only global table is writable by construct_runtime', 'write grant on a read-only table'],
        ['every insert-only global table lets construct_runtime insert', 'insert-only table the runtime cannot insert into'],
        ['no insert-only global table lets construct_runtime read, update, delete or truncate', 'insert-only table the runtime can read, update, delete or truncate'],
        ['insert-only global tables carry no policy beyond global_owner and global_insert', 'insert-only table with a policy beyond global_owner and global_insert'],
        ['insert-only global tables have a global_insert policy for construct_runtime alone', 'insert-only table whose global_insert is not an insert policy of construct_runtime alone'],
        ['insert-only global tables leave their identity sequence out of reach of construct_runtime', 'insert-only table whose identity sequence is reachable by the runtime'],
      ]) {
        const rows = globalViolations.filter(row => row.problem === problem)
        report(label, !rows.length, rows.map(row => row.name).join(', '))
      }
      // Specchio di 'keeps the tenant audit tables append-only for the runtime role': i registri di
      // tenant sono tabelle di tenant con un privilegio in meno, e l'elenco è esplicito.
      const appendOnly = await sql`
        select t.name, 'not a classified tenant table' as problem
        from unnest(array['tenant_audit_event']) as t(name)
        where not exists (select 1 from app_private.table_class tc where tc.table_name = t.name and tc.class = 'tenant')
        union all
        select t.name, 'the runtime cannot select and insert'
        from unnest(array['tenant_audit_event']) as t(name)
        where not has_table_privilege('construct_runtime', format('public.%I', t.name), 'select')
           or not has_table_privilege('construct_runtime', format('public.%I', t.name), 'insert')
        union all
        select t.name, 'the runtime can update, delete, truncate, reference or trigger'
        from unnest(array['tenant_audit_event']) as t(name)
        where has_table_privilege('construct_runtime', format('public.%I', t.name), 'delete,truncate,trigger')
           or has_any_column_privilege('construct_runtime', format('public.%I', t.name), 'update,references')
        union all
        select t.name, 'the identity sequence is reachable by the runtime'
        from unnest(array['tenant_audit_event']) as t(name)
        where pg_get_serial_sequence(format('public.%I', t.name), 'id') is null
           or has_sequence_privilege('construct_runtime', pg_get_serial_sequence(format('public.%I', t.name), 'id'), 'usage,select,update')
        order by 1, 2
      `
      report('tenant audit tables are append-only for construct_runtime', !appendOnly.length,
        appendOnly.map(row => `${row.name} (${row.problem})`).join(', '))
      // Specchio di 'keeps the platform admin guard trigger on users enabled'.
      const guard = await sql`
        select 'public.users' as name, 'the platform admin guard trigger is missing, disabled or not before insert or update on each row' as problem
        where not exists (
          select 1 from pg_trigger g
          where g.tgrelid = 'public.users'::regclass and g.tgname = 'users_platform_admin_guard' and g.tgenabled in ('O', 'A')
            and g.tgfoid in (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app_private' and p.proname = 'guard_platform_admin_flag')
            and g.tgtype & (1 | 2 | 4 | 16) = (1 | 2 | 4 | 16))
      `
      report('the platform admin guard trigger on users is present and enabled', !guard.length)
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

/**
 * Crea un tenant dal modello e ne registra il primo amministratore (specifica 2026-10-20, §3.3,
 * MT2-DEC-9, MT2-DEC-10). Usa l'identità delle migrazioni e lavora come construct_owner, l'unico
 * che può scrivere `tenant`, in una transazione sola: un errore qualsiasi annulla tutto, tenant,
 * account, appartenenza e invito. Il tenant nuovo vale solo per la transazione (MTF-DEC-7).
 *
 * Con `host` (specifica 2026-10-21, MT4-DEC-13) registra nella stessa transazione l'indirizzo
 * dedicato del tenant, come principale: un indirizzo già preso annulla anche il tenant.
 *
 * Nota (Task 8, pezzo 5a): la console crea i tenant con `app_private.create_platform_tenant`
 * (0060), che ripete questa stessa sequenza in SQL ma senza consegnare l'invito. Le regole oggi
 * esistono quindi in due versioni, questa in JavaScript e quella della 0060 (il commento in testa a
 * quella migrazione non può dirlo: una migrazione applicata non si modifica nemmeno nei commenti, il
 * checksum lo impedisce). Farle usare al comando la funzione SQL di `register_tenant_admin` e
 * `create_platform_tenant` è un lavoro per una migrazione successiva, non di questo task.
 *
 * Il link stampato contiene un token valido: è il modo previsto di consegnarlo finché l'invio per
 * email non arriva con la console (pezzo 5), e non si scrive da nessun'altra parte. Con `host` il
 * link usa l'indirizzo del tenant, come i link dell'app (`tenantBaseUrl`): `AUTH_URL` con il solo
 * nome dell'host sostituito, schema e porta restano quelli di `AUTH_URL`.
 */
async function runTenantCreate(connectionUrl, { slug, name, admin, host }) {
  const sql = postgres(connectionUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 30,
    idle_timeout: 5,
    onnotice: notice => console.log(`NOTICE: ${notice.message}`),
  })
  try {
    const result = await sql.begin(async tx => {
      await tx`set local role construct_owner`
      if (host) await assertHostFree(tx, host)
      const [{ tenantId }] = await tx`
        select app_private.create_tenant_from_template(${slug}, ${name})::text as "tenantId"
      `
      if (host) {
        await tx`insert into public.tenant_host (host, id_tenant, is_primary) values (${host}, ${tenantId}, true)`
      }
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`
      const [{ existed }] = await tx`select exists (select 1 from public.users where email = ${admin}) as existed`
      const [registered] = await tx`
        select invitation_token as "invitationToken" from app_private.register_tenant_admin(${admin})
      `
      // Un tenant non nasce senza un amministratore attivo: register_tenant_admin accetta anche un
      // account disattivato a livello globale, che non conta. L'errore annulla tutta la
      // transazione (tenant, account, appartenenza, link) e il comando esce con 1.
      const [{ activeAdmins }] = await tx`select app_private.count_active_admins() as "activeAdmins"`
      if (Number(activeAdmins) === 0) {
        throw new Error('Il primo amministratore non è attivo: account disattivato a livello globale. Nessun tenant creato.')
      }
      // Il registro della piattaforma (MT5-DEC-22), nella stessa transazione: se un controllo
      // sopra annulla la creazione, la voce non c'è. Né il token né il link ci entrano (MT5-RISK-4).
      await recordCommandAudit(tx, {
        tenantId,
        operation: 'tenant.create',
        objectType: 'tenant',
        objectId: tenantId,
        details: { slug, name, firstAdmin: admin, ...(host ? { host } : {}) },
      })
      return { tenantId, existed, invitationToken: registered.invitationToken }
    })

    console.log(`Tenant creato: id=${result.tenantId} slug=${slug} nome=${name}`)
    if (host) console.log(`Indirizzo principale: ${host}`)
    console.log(`Primo amministratore: ${admin} (${result.existed ? 'account esistente' : 'account nuovo'})`)
    if (result.invitationToken) {
      const baseUrl = tenantLinkBase(process.env.AUTH_URL ?? '', host)
      console.log(`Link per impostare la password (valido 48 ore): ${baseUrl}/set-password?token=${result.invitationToken}`)
      if (!baseUrl) console.log("AUTH_URL non impostata: anteponi l'indirizzo del sito.")
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/**
 * L'indirizzo base dei link per un tenant: `AUTH_URL` senza barra finale, e con `host` il solo nome
 * dell'host sostituito (schema, porta e percorso restano quelli di `AUTH_URL`), come `tenantBaseUrl`
 * in lib/tenancy/tenant-base-url.ts. Senza `AUTH_URL` resta vuoto: il chiamante stampa il percorso.
 */
function tenantLinkBase(configured, host) {
  if (!configured) return ''
  if (!host) return configured.replace(/\/$/, '')
  const url = new URL(configured)
  url.hostname = host
  return url.href.replace(/\/$/, '')
}

/** Un indirizzo è uno solo in tutto il registro: se è già di qualcuno il comando si ferma. */
async function assertHostFree(tx, host) {
  const [taken] = await tx`
    select t.slug from public.tenant_host h join public.tenant t on t.id = h.id_tenant where h.host = ${host}
  `
  if (taken) throw new Error(`L'indirizzo ${host} è già assegnato al tenant ${taken.slug}`)
}

/**
 * Assegna un indirizzo dedicato a un tenant che esiste già (specifica 2026-10-21, MT4-DEC-13,
 * MT4-DEC-17). Una transazione sola come construct_owner, l'unico che scrive `tenant_host`. Si
 * rifiutano, prima ancora del controllo della tabella (trigger `tenant_host_guard`), il tenant
 * predefinito e il modello; un indirizzo già preso; e `--primary` su un tenant che ha già un
 * indirizzo principale: l'indirizzo principale finisce nei link delle email, e cambiarlo in
 * silenzio cambierebbe i link di tutti, quindi non si sposta da qui.
 */
async function runTenantHostAdd(connectionUrl, { slug, host, primary }) {
  const sql = postgres(connectionUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 30,
    idle_timeout: 5,
    onnotice: notice => console.log(`NOTICE: ${notice.message}`),
  })
  try {
    await sql.begin(async tx => {
      await tx`set local role construct_owner`
      const [found] = await tx`select id::text as id, slug, is_template as "isTemplate" from public.tenant where slug = ${slug}`
      if (!found) throw new Error(`Il tenant ${slug} non esiste`)
      if (found.slug === 'default' || found.isTemplate) {
        throw new Error(`Il tenant ${slug} non può avere un indirizzo dedicato: il predefinito risponde sull'indirizzo principale e il modello non risponde su nessun indirizzo`)
      }
      await assertHostFree(tx, host)
      if (primary) {
        const [current] = await tx`select host from public.tenant_host where id_tenant = ${found.id} and is_primary`
        if (current) {
          throw new Error(`Il tenant ${slug} ha già un indirizzo principale (${current.host}): aggiungi l'indirizzo senza --primary, oppure cambia il principale a mano`)
        }
      }
      await tx`insert into public.tenant_host (host, id_tenant, is_primary) values (${host}, ${found.id}, ${primary})`
      // Il registro della piattaforma (MT5-DEC-22), nella stessa transazione: una voce per
      // l'indirizzo aggiunto, e una in più se lo si rende principale.
      await recordCommandAudit(tx, {
        tenantId: found.id,
        operation: 'tenant.host.add',
        objectType: 'tenant_host',
        objectId: host,
        details: { slug, host, primary },
      })
      if (primary) {
        await recordCommandAudit(tx, {
          tenantId: found.id,
          operation: 'tenant.host.primary',
          objectType: 'tenant_host',
          objectId: host,
          details: { slug, host },
        })
      }
    })
    console.log(`Indirizzo assegnato: ${host} al tenant ${slug} (${primary ? 'principale' : 'non principale'})`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/**
 * Nomina un amministratore di piattaforma (specifica 2026-10-26, MT5-DEC-2, MT5-DEC-23): imposta
 * `users.is_platform_admin`, creando l'account se manca. Il comando gira come construct_owner, il
 * solo che può cambiare quell'attributo (il trigger `users_platform_admin_guard`, 0057), in una
 * transazione sola con la voce del registro. Un account nuovo non ha password: riceve, come il
 * primo amministratore di tenant-create (`register_tenant_admin`, 0051), un invito di 48 ore già
 * consegnato (gli inviti precedenti non usati si sostituiscono), il cui link si stampa verso
 * `AUTH_URL`, l'indirizzo principale: la piattaforma non è in nessun tenant. Il link si stampa e
 * non si scrive da nessun'altra parte, registro compreso. Un account già amministratore non cambia
 * e non lascia voci. Un account disattivato a livello globale si rifiuta, come in tenant-create.
 */
async function runPlatformAdminAdd(connectionUrl, { email }) {
  const sql = postgres(connectionUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 30,
    idle_timeout: 5,
    onnotice: notice => console.log(`NOTICE: ${notice.message}`),
  })
  try {
    const result = await sql.begin(async tx => {
      await tx`set local role construct_owner`
      const [{ existed }] = await tx`select exists (select 1 from public.users where email = ${email}) as existed`
      await tx`insert into public.users (email, auth_provider) values (${email}, 'credentials') on conflict (email) do nothing`
      const [account] = await tx`
        select id::text as id, password_hash is not null as "hasPassword", is_platform_admin as "isAdmin", id_user_status as status
        from public.users where email = ${email} for update
      `
      if (Number(account.status) !== 2) {
        throw new Error(`L'account ${email} è disattivato a livello globale: riattivalo prima di nominarlo. Nessuna modifica.`)
      }
      if (account.isAdmin) return { changed: false }
      await tx`update public.users set is_platform_admin = true where id = ${account.id}`
      let invitationToken = null
      if (!account.hasPassword) {
        invitationToken = (await tx`select gen_random_uuid()::text as token`)[0].token
        // L'orologio è quello del database, come in register_tenant_admin (0051): non quello di chi lancia il comando.
        await tx`
          update public.password_set_tokens set superseded_at = now()
          where user_id = ${account.id} and purpose = 'invitation' and used_at is null and superseded_at is null
        `
        await tx`
          insert into public.password_set_tokens (user_id, token, expires_at, purpose, delivery_status, delivery_attempted_at, delivered_at)
          values (${account.id}, ${invitationToken}, now() + interval '48 hours', 'invitation', 'sent', now(), now())
        `
      }
      await recordCommandAudit(tx, {
        operation: 'platform.admin.add',
        objectType: 'user',
        objectId: account.id,
        details: { email, accountCreated: !existed },
      })
      return { changed: true, existed, invitationToken }
    })

    if (!result.changed) {
      console.log(`${email} è già amministratore di piattaforma: nessuna modifica`)
      return
    }
    console.log(`Amministratore di piattaforma: ${email} (${result.existed ? 'account esistente' : 'account nuovo'})`)
    if (result.invitationToken) {
      const baseUrl = tenantLinkBase(process.env.AUTH_URL ?? '')
      console.log(`Link per impostare la password (valido 48 ore): ${baseUrl}/set-password?token=${result.invitationToken}`)
      if (!baseUrl) console.log("AUTH_URL non impostata: anteponi l'indirizzo del sito.")
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/**
 * Toglie l'attributo di amministratore di piattaforma (MT5-DEC-2). Rifiuta di togliere l'ultimo
 * amministratore attivo: la piattaforma non resterebbe senza nessuno. Il conteggio e la modifica
 * stanno nella stessa transazione, e il conteggio blocca le righe degli amministratori (`for
 * update`, sempre nello stesso ordine): due rimozioni insieme si mettono in fila, e la seconda,
 * dopo l'attesa, rilegge chi è ancora amministratore e vede che è l'ultimo. Togliere l'attributo a
 * chi non lo ha non cambia nulla e non lascia voci.
 */
async function runPlatformAdminRemove(connectionUrl, { email }) {
  const sql = postgres(connectionUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 30,
    idle_timeout: 5,
    onnotice: notice => console.log(`NOTICE: ${notice.message}`),
  })
  try {
    const changed = await sql.begin(async tx => {
      await tx`set local role construct_owner`
      const admins = await tx`
        select id::text as id, email, id_user_status as status
        from public.users where is_platform_admin order by id for update
      `
      const target = admins.find(row => row.email === email)
      if (!target) {
        const [account] = await tx`select id from public.users where email = ${email}`
        if (!account) throw new Error(`Nessun account con l'email ${email}`)
        return false
      }
      const othersActive = admins.filter(row => row.id !== target.id && Number(row.status) === 2).length
      if (othersActive === 0) {
        throw new Error(`Non si toglie l'ultimo amministratore di piattaforma (${email}): nomina prima un altro amministratore. Nessuna modifica.`)
      }
      await tx`update public.users set is_platform_admin = false where id = ${target.id}`
      await recordCommandAudit(tx, {
        operation: 'platform.admin.remove',
        objectType: 'user',
        objectId: target.id,
        details: { email },
      })
      return true
    })
    console.log(changed
      ? `Amministratore di piattaforma tolto: ${email}`
      : `${email} non è amministratore di piattaforma: nessuna modifica`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/**
 * Solo per il database di prova (E2E dei tenant, specifica 2026-10-21, Task 11): dà a una persona
 * l'appartenenza attiva a un tenant, creando l'account se manca. Con `admin` passa da
 * `register_tenant_admin`, come il primo amministratore di tenant-create (l'invito che ne nasce per
 * un account senza password non si stampa: qui non serve); senza, la persona riceve il solo ruolo
 * base REGISTERED, come "Aggiungi persona". Una transazione sola come construct_owner. Il modello
 * non ha persone.
 */
async function runTestTenantMemberAdd(connectionUrl, { slug, email, admin }) {
  const sql = postgres(connectionUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 30,
    idle_timeout: 5,
    onnotice: notice => console.log(`NOTICE: ${notice.message}`),
  })
  try {
    const existed = await sql.begin(async tx => {
      await tx`set local role construct_owner`
      const [found] = await tx`select id::text as id, is_template as "isTemplate" from public.tenant where slug = ${slug}`
      if (!found) throw new Error(`Il tenant ${slug} non esiste`)
      if (found.isTemplate) throw new Error(`Il tenant ${slug} è il modello: non ha persone`)
      await tx`select set_config('app.tenant_id', ${found.id}, true)`
      const [{ existed }] = await tx`select exists (select 1 from public.users where email = ${email}) as existed`
      if (admin) {
        await tx`select 1 from app_private.register_tenant_admin(${email})`
        return existed
      }
      await tx`insert into public.users (email, auth_provider) values (${email}, 'credentials') on conflict (email) do nothing`
      const [{ userId }] = await tx`select id::text as "userId" from public.users where email = ${email}`
      await tx`
        insert into public.tenant_membership (id_tenant, user_id, status) values (${found.id}, ${userId}, 'active')
        on conflict on constraint tenant_membership_pkey do update set status = 'active'
      `
      await tx`
        insert into public.user_role (id_tenant, user_id, id_role)
        select ${found.id}, ${userId}, r.id_role from public.role r
        where r.id_tenant = ${found.id} and r.system_key = 'REGISTERED'
        on conflict do nothing
      `
      return existed
    })
    console.log(`Persona aggiunta al tenant ${slug}: ${email} (${existed ? 'account esistente' : 'account nuovo'}, ${admin ? 'amministratore' : 'utente'})`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/**
 * Solo per il database di prova (E2E dei tenant, Task 11): cancella un tenant di prova con tutte le
 * sue righe, come `deleteTenantForTest` di lib/db/testing.ts: ogni tabella di tenant del registro
 * `app_private.table_class` (così una tabella nuova non resta indietro), poi gli indirizzi e la riga
 * di `tenant`. Rifiuta il predefinito e il modello. Un tenant che non c'è non è un errore: la pulizia
 * dell'E2E gira anche quando la creazione si è fermata a metà, e di nuovo all'esecuzione dopo.
 */
async function runTestTenantDelete(connectionUrl, { slugs }) {
  const sql = postgres(connectionUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 30,
    idle_timeout: 5,
    onnotice: notice => console.log(`NOTICE: ${notice.message}`),
  })
  try {
    // Tutti gli slug in una transazione: un rifiuto (il modello) non lascia a metà gli altri.
    const outcomes = await sql.begin(async tx => {
      await tx`set local role construct_owner`
      const tables = await tx`select table_name as name from app_private.table_class where class = 'tenant' order by table_name`
      const deleted = []
      for (const slug of slugs) {
        const [found] = await tx`select id::text as id, slug, is_template as "isTemplate" from public.tenant where slug = ${slug}`
        if (!found) {
          deleted.push([slug, false])
          continue
        }
        if (found.slug === 'default' || found.isTemplate) {
          throw new Error(`Il tenant ${slug} non si cancella: il predefinito e il modello vivono in ogni database`)
        }
        // La RLS forzata vale anche per il proprietario (MTF-DEC-4): il tenant va impostato.
        await tx`select set_config('app.tenant_id', ${found.id}, true)`
        // Le chiavi esterne fra tabelle di tenant sono tutte in cascata: l'ordine non conta.
        for (const { name } of tables) {
          await tx`delete from ${tx('public.' + name)} where id_tenant = ${found.id}`
        }
        await tx`delete from public.tenant_host where id_tenant = ${found.id}`
        // Le voci del registro della piattaforma che nominano il tenant (0057, MT5-DEC-22): chiave
        // esterna senza ON DELETE, e i comandi di creazione le scrivono. Il comando esiste solo per
        // il database di prova; il proprietario ha pieno accesso alla tabella.
        await tx`delete from public.platform_audit_event where id_tenant = ${found.id}`
        await tx`delete from public.tenant where id = ${found.id}`
        deleted.push([slug, true])
      }
      return deleted
    })
    for (const [slug, deleted] of outcomes) {
      console.log(deleted ? `Tenant cancellato: ${slug}` : `Nessun tenant ${slug}: niente da cancellare`)
    }
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
    // l'errore nomini mai la causa (vedi conftest.py, clean_language_preferences). Lo stesso vale
    // per l'ultimo tenant usato (pezzo 4, MT4-DEC-6): deciderebbe da solo dove entra l'accesso dopo.
    const result = await sql`
      update users set id_language = null, theme_mode = 'system', text_scale = 100, last_tenant_id = null
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

const [command, argument, ...extraArguments] = process.argv.slice(2)
const supported = new Set([
  'apply',
  'boundary-check',
  'platform-admin-add',
  'platform-admin-remove',
  'provision-platform-role',
  'provision-runtime-role',
  'query',
  'schema-check',
  'schema-write',
  'tenant-create',
  'tenant-host-add',
  'test-apply',
  'test-query',
  'test-reset-e2e',
  'test-delete-user',
  'test-platform-admin-add',
  'test-platform-admin-remove',
  'test-tenant-create',
  'test-tenant-host-add',
  'test-tenant-member-add',
  'test-tenant-delete',
])

if (!supported.has(command)) {
  console.error('usage: db.mjs apply [--to <version>] | boundary-check | provision-runtime-role | provision-platform-role | query "<sql>" | schema-check | schema-write | tenant-create --slug <slug> --name <name> --admin <email> [--host <host>] | tenant-host-add --slug <slug> --host <host> [--primary] | platform-admin-add --email <email> | platform-admin-remove --email <email> | test-apply [--to <version>] | test-query "<sql>" | test-reset-e2e | test-delete-user | test-platform-admin-add --email <email> | test-platform-admin-remove --email <email> | test-tenant-create --slug <slug> --name <name> --admin <email> [--host <host>] | test-tenant-host-add --slug <slug> --host <host> [--primary] | test-tenant-member-add --slug <slug> --email <email> [--admin] | test-tenant-delete --slug <slug> [--slug <slug> ...]')
  process.exit(2)
}

const commandArguments = [argument, ...extraArguments].filter(value => value !== undefined)

try {
  if (command === 'schema-write') writeSchemaSnapshot()
  else if (command === 'schema-check') checkSchemaSnapshot()
  else if (command === 'apply') await runMigrations(migrationDatabaseUrl(), parseApplyArguments(commandArguments))
  else if (command === 'boundary-check') await boundaryCheck()
  else if (command === 'provision-runtime-role') await provisionRuntimeRole()
  else if (command === 'provision-platform-role') await provisionPlatformRole()
  else if (command === 'test-apply') await runMigrations(testMigrationDatabaseUrl(), parseApplyArguments(commandArguments))
  else if (command === 'tenant-create') await runTenantCreate(migrationDatabaseUrl(), parseTenantCreateArguments(commandArguments))
  else if (command === 'test-tenant-create') await runTenantCreate(testMigrationDatabaseUrl(), parseTenantCreateArguments(commandArguments))
  else if (command === 'tenant-host-add') await runTenantHostAdd(migrationDatabaseUrl(), parseTenantHostArguments(commandArguments))
  else if (command === 'test-tenant-host-add') await runTenantHostAdd(testMigrationDatabaseUrl(), parseTenantHostArguments(commandArguments))
  else if (command === 'platform-admin-add') await runPlatformAdminAdd(migrationDatabaseUrl(), parsePlatformAdminArguments(commandArguments))
  else if (command === 'test-platform-admin-add') await runPlatformAdminAdd(testMigrationDatabaseUrl(), parsePlatformAdminArguments(commandArguments))
  else if (command === 'platform-admin-remove') await runPlatformAdminRemove(migrationDatabaseUrl(), parsePlatformAdminArguments(commandArguments))
  else if (command === 'test-platform-admin-remove') await runPlatformAdminRemove(testMigrationDatabaseUrl(), parsePlatformAdminArguments(commandArguments))
  else if (command === 'test-tenant-member-add') await runTestTenantMemberAdd(testMigrationDatabaseUrl(), parseTenantMemberArguments(commandArguments))
  else if (command === 'test-tenant-delete') await runTestTenantDelete(testMigrationDatabaseUrl(), parseTenantDeleteArguments(commandArguments))
  else await runDatabaseCommand(command, argument)
} catch (err) {
  console.error(`ERROR: ${err.message}`)
  if (err.position) console.error(`  at character ${err.position}`)
  if (err.where) console.error(`  in ${err.where}`)
  process.exitCode = 1
}
