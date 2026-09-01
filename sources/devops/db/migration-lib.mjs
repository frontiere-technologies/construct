import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION_FILENAME = /^(\d{4})_([a-z0-9_]+)\.sql$/

export function migrationChecksum(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

export function discoverMigrations(directory) {
  const migrations = []
  const versions = new Set()

  for (const filename of readdirSync(directory).sort()) {
    const match = MIGRATION_FILENAME.exec(filename)
    if (!match) continue
    const [, version, name] = match
    if (versions.has(version)) throw new Error(`Duplicate migration version ${version}`)
    versions.add(version)
    const sql = readFileSync(join(directory, filename), 'utf8')
    migrations.push({ version, name, filename, sql, checksum: migrationChecksum(sql) })
  }

  return migrations.sort((left, right) => left.version.localeCompare(right.version))
}

export function renderSchemaSnapshot(migrations) {
  const parts = ['-- GENERATED FILE. Edit sources/devops/db/migrations/*.sql instead.']
  for (const migration of migrations) {
    parts.push(`-- Migration: ${migration.filename}`)
    parts.push(migration.sql.replace(/\n+$/, ''))
    parts.push('')
  }
  return parts.join('\n')
}

export function assertAppliedMigrationChecksums(migrations, historyRows) {
  const migrationByVersion = new Map(migrations.map(migration => [migration.version, migration]))
  for (const row of historyRows) {
    // completed_at nullo significa "tentata e fallita": la transazione della migrazione è stata
    // annullata, nessuno schema porta il segno di quel tentativo. db.mjs (markStarted) registra
    // l'inizio con un upsert che sovrascrive proprio checksum e completed_at ad ogni tentativo —
    // l'unica ragione per farlo è permettere di correggere il file e riprovare. Controllare il
    // checksum di una riga così non protegge nulla di applicato: renderebbe invece ogni migrazione
    // fallita un blocco permanente, perché il tentativo successivo — con il file corretto — non
    // potrebbe mai più superare questo controllo. Una riga con completed_at valorizzato è tutt'altra
    // cosa: quella è una migrazione che ha davvero cambiato lo schema, ed è lì che l'immutabilità va
    // fatta rispettare senza eccezioni.
    if (!row.completedAt) continue
    const migration = migrationByVersion.get(row.version)
    if (!migration) throw new Error(`Applied migration ${row.version} is missing from the repository`)
    if (migration.checksum !== row.checksum) {
      throw new Error(`Checksum mismatch for applied migration ${migration.version}_${migration.name}`)
    }
  }
}

export async function applyPendingMigrations(adapter, migrations) {
  const historyRows = await adapter.loadHistory()
  assertAppliedMigrationChecksums(migrations, historyRows)
  const historyByVersion = new Map(historyRows.map(row => [row.version, row]))
  const applied = []

  for (const migration of migrations) {
    if (historyByVersion.get(migration.version)?.completedAt) continue
    await adapter.markStarted(migration)
    await adapter.runInTransaction(migration)
    applied.push(migration.version)
  }

  return applied
}
