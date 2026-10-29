import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import {
  applyPendingMigrations,
  assertAppliedMigrationChecksums,
  COMMAND_AUDIT_OPERATIONS,
  commandActorEmail,
  discoverMigrations,
  migrationChecksum,
  normalizeHostArgument,
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

const tempDirectories = []

function migrationDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'construct-migrations-'))
  tempDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('discovers migrations in numeric version order with stable checksums', () => {
  const directory = migrationDirectory()
  writeFileSync(join(directory, '0010_add_index.sql'), 'create index example_idx on example(id);\n')
  writeFileSync(join(directory, '0002_create_example.sql'), 'create table example(id bigint);\n')
  writeFileSync(join(directory, 'README.md'), 'ignored')

  const migrations = discoverMigrations(directory)

  assert.deepEqual(migrations.map(({ version, name, filename }) => ({ version, name, filename })), [
    { version: '0002', name: 'create_example', filename: '0002_create_example.sql' },
    { version: '0010', name: 'add_index', filename: '0010_add_index.sql' },
  ])
  assert.equal(migrations[0].checksum, migrationChecksum('create table example(id bigint);\n'))
  assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/)
})

test('rejects two migration files with the same numeric version', () => {
  const directory = migrationDirectory()
  writeFileSync(join(directory, '0001_first.sql'), 'select 1;\n')
  writeFileSync(join(directory, '0001_second.sql'), 'select 2;\n')

  assert.throws(() => discoverMigrations(directory), /duplicate migration version 0001/i)
})

test('renders the schema snapshot deterministically from ordered migrations', () => {
  const migrations = [
    {
      version: '0001',
      name: 'baseline',
      filename: '0001_baseline.sql',
      sql: 'create table example(id bigint);\n',
      checksum: 'unused',
    },
    {
      version: '0002',
      name: 'index',
      filename: '0002_index.sql',
      sql: 'create index example_idx on example(id);\n',
      checksum: 'unused',
    },
  ]

  assert.equal(renderSchemaSnapshot(migrations), [
    '-- GENERATED FILE. Edit sources/devops/db/migrations/*.sql instead.',
    '-- Migration: 0001_baseline.sql',
    'create table example(id bigint);',
    '',
    '-- Migration: 0002_index.sql',
    'create index example_idx on example(id);',
    '',
  ].join('\n'))
})

test('rejects an applied migration whose bytes changed', () => {
  const migrations = [{
    version: '0001',
    name: 'baseline',
    filename: '0001_baseline.sql',
    sql: 'select 2;\n',
    checksum: migrationChecksum('select 2;\n'),
  }]

  assert.throws(
    () => assertAppliedMigrationChecksums(migrations, [{ version: '0001', checksum: migrationChecksum('select 1;\n'), completedAt: new Date() }]),
    /checksum mismatch for applied migration 0001_baseline/i,
  )
})

test('allows retrying an incomplete migration only when its checksum is unchanged', () => {
  const sql = 'select 1;\n'
  const migrations = [{
    version: '0001',
    name: 'baseline',
    filename: '0001_baseline.sql',
    sql,
    checksum: migrationChecksum(sql),
  }]

  assert.doesNotThrow(() => assertAppliedMigrationChecksums(migrations, [
    { version: '0001', checksum: migrationChecksum(sql), completedAt: null },
  ]))
})

// completed_at nullo significa "tentata e fallita", non "applicata": la transazione è stata
// annullata, nessuno schema porta il segno di quel tentativo. markStarted (db.mjs) fa apposta un
// upsert che sovrascrive checksum e azzera completed_at ad ogni nuovo tentativo — l'unica ragione
// per farlo è permettere di correggere il file e riprovare. Un controllo che blocca proprio quella
// correzione, sull'unica riga per cui l'upsert esiste, non protegge niente: non c'è schema da
// proteggere. Il caso simmetrico sotto (bytes changed, completedAt impostato) resta la protezione
// vera e non deve indebolirsi.
test('allows correcting an incomplete migration whose checksum changed, but still rejects a completed one', () => {
  const oldSql = 'select 1;\n'
  const fixedSql = 'select 2;\n'
  const migrations = [{
    version: '0001',
    name: 'baseline',
    filename: '0001_baseline.sql',
    sql: fixedSql,
    checksum: migrationChecksum(fixedSql),
  }]

  assert.doesNotThrow(() => assertAppliedMigrationChecksums(migrations, [
    { version: '0001', checksum: migrationChecksum(oldSql), completedAt: null },
  ]))

  assert.throws(
    () => assertAppliedMigrationChecksums(migrations, [
      { version: '0001', checksum: migrationChecksum(oldSql), completedAt: new Date() },
    ]),
    /checksum mismatch for applied migration 0001_baseline/i,
  )
})

// Il salto per completed_at nullo deve scartare solo il confronto del checksum, non l'intero
// corpo del ciclo: applyPendingMigrations itera sui file letti da disco, non sulla cronologia, e
// se una riga di cronologia (completata o no) non trova piu' un file corrispondente su disco,
// quella migrazione non verrebbe mai piu' ne' ritentata ne' segnalata — sparirebbe in silenzio.
// L'esistenza del file va verificata per ogni riga, prima di guardare se e' completata.
test('still reports a missing migration file for an incomplete history row', () => {
  assert.throws(
    () => assertAppliedMigrationChecksums([], [
      { version: '0001', checksum: 'a'.repeat(64), completedAt: null },
    ]),
    /applied migration 0001 is missing from the repository/i,
  )
})

test('applies only pending or incomplete migrations in order', async () => {
  const migrations = [
    { version: '0001', name: 'first', filename: '0001_first.sql', sql: 'select 1;', checksum: 'a'.repeat(64) },
    { version: '0002', name: 'second', filename: '0002_second.sql', sql: 'select 2;', checksum: 'b'.repeat(64) },
    { version: '0003', name: 'third', filename: '0003_third.sql', sql: 'select 3;', checksum: 'c'.repeat(64) },
  ]
  const calls = []
  const adapter = {
    loadHistory: async () => [
      { version: '0001', checksum: 'a'.repeat(64), completedAt: new Date() },
      { version: '0002', checksum: 'b'.repeat(64), completedAt: null },
    ],
    markStarted: async migration => calls.push(`start:${migration.version}`),
    runInTransaction: async migration => calls.push(`run:${migration.version}`),
  }

  const applied = await applyPendingMigrations(adapter, migrations)

  assert.deepEqual(calls, ['start:0002', 'run:0002', 'start:0003', 'run:0003'])
  assert.deepEqual(applied, ['0002', '0003'])
})

// --to <versione>: rilascio a tappe (specifica 2026-10-13, §5.1). La selezione e' pura: db.mjs si
// limita a passarla all'esecutore.
const stagedMigrations = ['0001', '0002', '0003', '0004'].map(version => ({
  version,
  name: `m${version}`,
  filename: `${version}_m${version}.sql`,
  sql: 'select 1;',
  checksum: version.repeat(16),
}))

test('selectMigrationsUpTo keeps every migration up to and including the target version', () => {
  assert.deepEqual(
    selectMigrationsUpTo(stagedMigrations, '0003').map(migration => migration.version),
    ['0001', '0002', '0003'],
  )
  assert.deepEqual(
    selectMigrationsUpTo(stagedMigrations, '0004').map(migration => migration.version),
    ['0001', '0002', '0003', '0004'],
  )
})

test('selectMigrationsUpTo without a target returns everything', () => {
  assert.equal(selectMigrationsUpTo(stagedMigrations, undefined), stagedMigrations)
})

test('selectMigrationsUpTo rejects a version that is not among the migrations', () => {
  assert.throws(() => selectMigrationsUpTo(stagedMigrations, '9999'), /migration 9999 does not exist/i)
  assert.throws(() => selectMigrationsUpTo(stagedMigrations, '3'), /four digits/i)
  assert.throws(() => selectMigrationsUpTo(stagedMigrations, ''), /four digits/i)
})

test('applyPendingMigrations with a target stops after it and leaves later migrations pending', async () => {
  const calls = []
  const adapter = {
    loadHistory: async () => [{ version: '0001', checksum: '0001'.repeat(16), completedAt: new Date() }],
    markStarted: async migration => calls.push(`start:${migration.version}`),
    runInTransaction: async migration => calls.push(`run:${migration.version}`),
  }

  const applied = await applyPendingMigrations(adapter, stagedMigrations, { to: '0003' })

  assert.deepEqual(calls, ['start:0002', 'run:0002', 'start:0003', 'run:0003'])
  assert.deepEqual(applied, ['0002', '0003'])
})

test('applyPendingMigrations with a target already applied applies nothing', async () => {
  const calls = []
  const done = new Date()
  const adapter = {
    loadHistory: async () => [
      { version: '0001', checksum: '0001'.repeat(16), completedAt: done },
      { version: '0002', checksum: '0002'.repeat(16), completedAt: done },
      { version: '0003', checksum: '0003'.repeat(16), completedAt: done },
    ],
    markStarted: async migration => calls.push(`start:${migration.version}`),
    runInTransaction: async migration => calls.push(`run:${migration.version}`),
  }

  assert.deepEqual(await applyPendingMigrations(adapter, stagedMigrations, { to: '0002' }), [])
  assert.deepEqual(calls, [])
})

// I checksum delle migrazioni gia' applicate oltre la versione scelta si controllano comunque:
// tagliare l'elenco prima del controllo farebbe dire "migrazione assente dal repository".
test('applyPendingMigrations with a target still verifies history rows beyond it', async () => {
  const adapter = {
    loadHistory: async () => [
      { version: '0004', checksum: 'f'.repeat(64), completedAt: new Date() },
    ],
    markStarted: async () => {},
    runInTransaction: async () => {},
  }

  await assert.rejects(
    applyPendingMigrations(adapter, stagedMigrations, { to: '0002' }),
    /checksum mismatch for applied migration 0004/i,
  )
})

test('parseApplyArguments reads an optional --to <version>', () => {
  assert.deepEqual(parseApplyArguments([]), { to: undefined })
  assert.deepEqual(parseApplyArguments(['--to', '0045']), { to: '0045' })
  assert.throws(() => parseApplyArguments(['--to']), /--to requires a version/i)
  assert.throws(() => parseApplyArguments(['--to', '0045', 'extra']), /unexpected argument/i)
  assert.throws(() => parseApplyArguments(['0045']), /unexpected argument/i)
  assert.throws(() => parseApplyArguments(['--to=0045']), /use --to 0045/)
})

// Una migrazione in sospeso sotto la versione scelta, con una più recente già applicata, si applica
// comunque: --to taglia in alto, non decide da dove ripartire.
test('applyPendingMigrations with a target applies an older pending migration below it', async () => {
  const calls = []
  const adapter = {
    loadHistory: async () => [{ version: '0002', checksum: '0002'.repeat(16), completedAt: new Date() }],
    markStarted: async migration => calls.push(`start:${migration.version}`),
    runInTransaction: async migration => calls.push(`run:${migration.version}`),
  }

  const applied = await applyPendingMigrations(adapter, stagedMigrations, { to: '0003' })

  assert.deepEqual(applied, ['0001', '0003'])
  assert.deepEqual(calls, ['start:0001', 'run:0001', 'start:0003', 'run:0003'])
})

// tenant-create (specifica 2026-10-20, §3.3): tre opzioni obbligatorie, l'email normalizzata come
// la normalizza l'app, lo slug controllato prima di toccare il database.
test('parses tenant-create flags', () => {
  assert.deepEqual(parseTenantCreateArguments(['--slug', 'acme', '--name', 'Acme Spa', '--admin', ' Capo@Acme.IT ']),
    { slug: 'acme', name: 'Acme Spa', admin: 'capo@acme.it' })
  // L'ordine delle opzioni non conta.
  assert.deepEqual(parseTenantCreateArguments(['--admin', 'a@b.it', '--name', 'B', '--slug', 'b-2']),
    { slug: 'b-2', name: 'B', admin: 'a@b.it' })
})

test('rejects a missing flag, an unknown flag, a bad slug, an admin without @', () => {
  const valid = ['--slug', 'acme', '--name', 'Acme Spa', '--admin', 'capo@acme.it']
  assert.throws(() => parseTenantCreateArguments([]), /--slug/)
  assert.throws(() => parseTenantCreateArguments(['--slug', 'acme', '--name', 'Acme Spa']), /--admin/)
  assert.throws(() => parseTenantCreateArguments(['--slug', 'acme', '--admin', 'capo@acme.it']), /--name/)
  assert.throws(() => parseTenantCreateArguments(['--name', 'Acme Spa', '--admin', 'capo@acme.it']), /--slug/)
  assert.throws(() => parseTenantCreateArguments([...valid, '--color', 'red']), /--color/)
  assert.throws(() => parseTenantCreateArguments([...valid, 'extra']), /extra/)
  assert.throws(() => parseTenantCreateArguments(['--slug=acme', '--name', 'Acme Spa', '--admin', 'capo@acme.it']), /--slug acme/)
  assert.throws(() => parseTenantCreateArguments([...valid, '--slug', 'altro']), /--slug/)
  assert.throws(() => parseTenantCreateArguments(['--slug', 'acme', '--name', 'Acme Spa', '--admin']), /--admin/)
  assert.throws(() => parseTenantCreateArguments(['--slug', 'acme', '--name', '  ', '--admin', 'capo@acme.it']), /--name/)
  for (const slug of ['Ab', 'a_b', 'a'.repeat(41), 'ab']) {
    assert.throws(() => parseTenantCreateArguments(['--slug', slug, '--name', 'X', '--admin', 'capo@acme.it']),
      /slug/, slug)
  }
  assert.doesNotThrow(() => parseTenantCreateArguments(['--slug', 'a'.repeat(40), '--name', 'X', '--admin', 'capo@acme.it']))
  for (const admin of ['capo.acme.it', ' ', '@', 'capo@', '@acme.it']) {
    assert.throws(() => parseTenantCreateArguments(['--slug', 'acme', '--name', 'X', '--admin', admin]),
      /--admin/, admin)
  }
})

// Gli indirizzi dei tenant (specifica 2026-10-21, MT4-DEC-13): stessa forma di `normalizeHost` di
// lib/tenancy/request-host.ts (minuscolo, senza porta, senza punto finale), perché l'app confronta
// con la forma che il comando ha salvato.
test('normalizeHostArgument lowercases and strips port and trailing dot, like the app', () => {
  assert.equal(normalizeHostArgument('A.Localhost:3000'), 'a.localhost')
  assert.equal(normalizeHostArgument('  acme.example.it. '), 'acme.example.it')
  assert.equal(normalizeHostArgument('a.localhost'), 'a.localhost')
  assert.equal(normalizeHostArgument('xn--caf-dma.example'), 'xn--caf-dma.example')
  for (const bad of ['', '   ', 'a b.localhost', 'a/b', 'user@a.localhost', 'a.localhost:abc', 'a..localhost', '.', 'http://a.localhost', 'a.localhost:99999999', '[::1]', '[::1]:3000']) {
    assert.equal(normalizeHostArgument(bad), null, JSON.stringify(bad))
  }
  assert.equal(normalizeHostArgument(undefined), null)
})

test('tenant-create accepts --host and normalizes it', () => {
  const base = ['--slug', 'acme', '--name', 'Acme Spa', '--admin', 'capo@acme.it']
  assert.deepEqual(parseTenantCreateArguments([...base, '--host', ' A.Localhost:3000 ']),
    { slug: 'acme', name: 'Acme Spa', admin: 'capo@acme.it', host: 'a.localhost' })
  assert.deepEqual(parseTenantCreateArguments(['--host', 'a.localhost', ...base]),
    { slug: 'acme', name: 'Acme Spa', admin: 'capo@acme.it', host: 'a.localhost' })
  // Senza --host il risultato non cambia.
  assert.deepEqual(parseTenantCreateArguments(base), { slug: 'acme', name: 'Acme Spa', admin: 'capo@acme.it' })
  assert.throws(() => parseTenantCreateArguments([...base, '--host', 'a b']), /--host/)
  assert.throws(() => parseTenantCreateArguments([...base, '--host']), /--host/)
  assert.throws(() => parseTenantCreateArguments([...base, '--host', 'a.localhost', '--host', 'b.localhost']), /--host/)
  assert.throws(() => parseTenantCreateArguments([...base, '--host=a.localhost']), /--host a\.localhost/)
})

test('tenant-host-add requires --slug and --host and accepts --primary', () => {
  assert.deepEqual(parseTenantHostArguments(['--slug', 'acme', '--host', 'A.Localhost:3000']),
    { slug: 'acme', host: 'a.localhost', primary: false })
  assert.deepEqual(parseTenantHostArguments(['--primary', '--host', 'a.localhost', '--slug', 'acme']),
    { slug: 'acme', host: 'a.localhost', primary: true })
  assert.deepEqual(parseTenantHostArguments(['--slug', 'acme', '--host', 'a.localhost', '--primary']),
    { slug: 'acme', host: 'a.localhost', primary: true })
  assert.throws(() => parseTenantHostArguments([]), /--slug/)
  assert.throws(() => parseTenantHostArguments(['--slug', 'acme']), /--host/)
  assert.throws(() => parseTenantHostArguments(['--host', 'a.localhost']), /--slug/)
  assert.throws(() => parseTenantHostArguments(['--slug', 'acme', '--host', 'a.localhost', '--name', 'X']), /--name/)
  assert.throws(() => parseTenantHostArguments(['--slug', 'acme', '--host', 'a.localhost', 'extra']), /extra/)
  assert.throws(() => parseTenantHostArguments(['--slug', 'acme', '--host', 'a.localhost', '--primary', '--primary']), /--primary/)
  assert.throws(() => parseTenantHostArguments(['--slug', 'acme', '--host', 'a.localhost', '--slug', 'b']), /--slug/)
  assert.throws(() => parseTenantHostArguments(['--slug', 'acme', '--host']), /--host/)
  assert.throws(() => parseTenantHostArguments(['--slug', 'acme', '--host', 'a b']), /--host/)
  assert.throws(() => parseTenantHostArguments(['--slug', 'Ab', '--host', 'a.localhost']), /slug/)
  assert.throws(() => parseTenantHostArguments(['--slug=acme', '--host', 'a.localhost']), /--slug acme/)
})

// I comandi di prova per l'E2E dei tenant (specifica 2026-10-21, Task 11): aggiungono una persona a
// un tenant di prova e cancellano il tenant alla fine. Stesse regole di tenant-create per slug ed
// email; il predefinito non si cancella mai.
test('test-tenant-member-add requires --slug and --email and accepts --admin', () => {
  assert.deepEqual(parseTenantMemberArguments(['--slug', 'e2e-b', '--email', ' Solo-B@Construct.DEV ']),
    { slug: 'e2e-b', email: 'solo-b@construct.dev', admin: false })
  assert.deepEqual(parseTenantMemberArguments(['--admin', '--email', 'b@construct.dev', '--slug', 'e2e-b']),
    { slug: 'e2e-b', email: 'b@construct.dev', admin: true })
  assert.throws(() => parseTenantMemberArguments([]), /--slug/)
  assert.throws(() => parseTenantMemberArguments(['--slug', 'e2e-b']), /--email/)
  assert.throws(() => parseTenantMemberArguments(['--email', 'b@construct.dev']), /--slug/)
  assert.throws(() => parseTenantMemberArguments(['--slug', 'e2e-b', '--email', 'b@construct.dev', '--host', 'x']), /--host/)
  assert.throws(() => parseTenantMemberArguments(['--slug', 'e2e-b', '--email', 'b@construct.dev', 'extra']), /extra/)
  assert.throws(() => parseTenantMemberArguments(['--slug', 'e2e-b', '--email', 'b@construct.dev', '--admin', '--admin']), /--admin/)
  assert.throws(() => parseTenantMemberArguments(['--slug', 'e2e-b', '--email']), /--email/)
  assert.throws(() => parseTenantMemberArguments(['--slug=e2e-b', '--email', 'b@construct.dev']), /--slug e2e-b/)
  assert.throws(() => parseTenantMemberArguments(['--slug', 'Ab', '--email', 'b@construct.dev']), /slug/)
  for (const email of ['b.construct.dev', ' ', '@', 'b@', '@construct.dev']) {
    assert.throws(() => parseTenantMemberArguments(['--slug', 'e2e-b', '--email', email]), /--email/, email)
  }
})

test('test-tenant-delete requires --slug and refuses the default tenant', () => {
  assert.deepEqual(parseTenantDeleteArguments(['--slug', 'e2e-a']), { slugs: ['e2e-a'] })
  assert.throws(() => parseTenantDeleteArguments([]), /--slug/)
  assert.throws(() => parseTenantDeleteArguments(['--slug']), /--slug/)
  assert.throws(() => parseTenantDeleteArguments(['--slug', 'e2e-a', '--slug']), /--slug/)
  assert.throws(() => parseTenantDeleteArguments(['--slug', 'e2e-a', '--slug', 'e2e-a']), /due volte/)
  assert.throws(() => parseTenantDeleteArguments(['--slug=e2e-a']), /--slug e2e-a/)
  assert.throws(() => parseTenantDeleteArguments(['--slug', 'e2e-a', '--admin']), /--admin/)
  assert.throws(() => parseTenantDeleteArguments(['--slug', 'e2e-a', 'extra']), /extra/)
  assert.throws(() => parseTenantDeleteArguments(['--slug', 'Ab']), /slug/)
  assert.throws(() => parseTenantDeleteArguments(['--slug', 'default']), /predefinito/)
  assert.throws(() => parseTenantDeleteArguments(['--slug', 'e2e-a', '--slug', 'default']), /predefinito/)
})

test('test-tenant-delete takes --slug more than once, in the order given', () => {
  assert.deepEqual(
    parseTenantDeleteArguments(['--slug', 'e2e-a', '--slug', 'e2e-b', '--slug', 'e2e-c']),
    { slugs: ['e2e-a', 'e2e-b', 'e2e-c'] },
  )
})

// platform-admin-add / platform-admin-remove (specifica 2026-10-26, MT5-DEC-2): una sola opzione,
// `--email`, normalizzata come la normalizza l'app.
test('parses platform-admin flags', () => {
  assert.deepEqual(parsePlatformAdminArguments(['--email', ' Capo@Acme.IT ']), { email: 'capo@acme.it' })
})

test('platform-admin arguments reject a missing, repeated, unknown or malformed flag', () => {
  assert.throws(() => parsePlatformAdminArguments([]), /--email/)
  assert.throws(() => parsePlatformAdminArguments(['--email']), /--email/)
  assert.throws(() => parsePlatformAdminArguments(['--email', 'a@b.it', '--email', 'c@d.it']), /due volte/)
  assert.throws(() => parsePlatformAdminArguments(['--email=a@b.it']), /--email a@b\.it/)
  assert.throws(() => parsePlatformAdminArguments(['--email', 'a@b.it', '--admin']), /--admin/)
  assert.throws(() => parsePlatformAdminArguments(['--email', 'a@b.it', 'extra']), /extra/)
  for (const email of ['a.b.it', ' ', '@', 'a@', '@b.it']) {
    assert.throws(() => parsePlatformAdminArguments(['--email', email]), /--email/, email)
  }
})

// L'utente del sistema operativo, se c'è (MT5-DEC-22): lo dà il sistema, poi USER e LOGNAME, poi niente.
test('commandActorEmail prefers the operating system user, then USER, then LOGNAME, then null', () => {
  assert.equal(commandActorEmail({ USER: 'env-user' }, () => ({ username: 'os-user' })), 'os-user')
  assert.equal(commandActorEmail({ USER: 'env-user' }, () => { throw new Error('no passwd entry') }), 'env-user')
  assert.equal(commandActorEmail({ LOGNAME: 'login' }, () => ({ username: '' })), 'login')
  assert.equal(commandActorEmail({ USER: '  ', LOGNAME: '' }, () => { throw new Error('no passwd entry') }), null)
  assert.equal(commandActorEmail({}, () => ({ username: undefined })), null)
})

// Un finto `tx` che registra le chiamate al tag di postgres.js.
function recordingTransaction() {
  const calls = []
  const tx = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values })
    return Promise.resolve([])
  }
  return { tx, calls }
}

test('recordCommandAudit inserts a command row with the operating system user and no person', async () => {
  const { tx, calls } = recordingTransaction()
  await recordCommandAudit(tx, {
    operation: 'platform.admin.add',
    objectType: 'user',
    objectId: 'abc',
    details: { email: 'a@b.it', accountCreated: true },
  }, 'mario')
  assert.equal(calls.length, 1)
  assert.match(calls[0].text, /insert into public\.platform_audit_event/)
  assert.match(calls[0].text, /'command'/)
  // id_tenant, actor_email, operation, object_type, object_id, details
  assert.deepEqual(calls[0].values, [null, 'mario', 'platform.admin.add', 'user', 'abc', '{"email":"a@b.it","accountCreated":true}'])
})

test('recordCommandAudit records the tenant and turns ids into text', async () => {
  const { tx, calls } = recordingTransaction()
  await recordCommandAudit(tx, { tenantId: '7', operation: 'tenant.create', objectType: 'tenant', objectId: 7 }, null)
  assert.deepEqual(calls[0].values, ['7', null, 'tenant.create', 'tenant', '7', '{}'])
})

test('recordCommandAudit never writes a password, token, link or secret, at any depth', async () => {
  const { tx, calls } = recordingTransaction()
  await recordCommandAudit(tx, {
    operation: 'platform.admin.add',
    objectType: 'user',
    objectId: 'abc',
    details: { email: 'a@b.it', invitationToken: 'x', Password: 'y', setLink: 'z', nested: { client_secret: 's', keep: 1 }, list: [{ token: 't', ok: true }] },
  }, 'mario')
  assert.equal(calls[0].values[5], '{"email":"a@b.it","nested":{"keep":1},"list":[{"ok":true}]}')
})

test('recordCommandAudit refuses an operation the audit log does not know', async () => {
  const { tx, calls } = recordingTransaction()
  await assert.rejects(recordCommandAudit(tx, { operation: 'platform.admin.adds', objectType: 'user', objectId: 'a' }, 'm'), /platform\.admin\.adds/)
  assert.equal(calls.length, 0)
})

// I codici dei comandi sono un sottoinsieme di quelli dell'app: lo stesso codice nel registro, scritto
// da SQL qui e da TypeScript là (lib/audit/audit-types.ts).
test('every command audit operation is an operation of the application audit log', () => {
  const source = readFileSync(new URL('../../microservices/web-construct/lib/audit/audit-types.ts', import.meta.url), 'utf8')
  const declared = source.slice(source.indexOf('AUDIT_OPERATIONS = ['), source.indexOf('] as const'))
  for (const operation of COMMAND_AUDIT_OPERATIONS) {
    assert.ok(declared.includes(`'${operation}'`), operation)
  }
})
