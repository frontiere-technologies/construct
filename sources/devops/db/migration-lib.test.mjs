import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import {
  applyPendingMigrations,
  assertAppliedMigrationChecksums,
  discoverMigrations,
  migrationChecksum,
  renderSchemaSnapshot,
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
