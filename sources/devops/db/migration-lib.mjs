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
    // Il controllo di esistenza vale per ogni riga di cronologia, completata o no: se il file
    // sparisse dal repository, applyPendingMigrations (sotto) itera sui file letti da disco, non
    // sulla cronologia, quindi una riga senza file corrispondente non verrebbe mai più né
    // ritentata né segnalata — sparirebbe in silenzio. Questo vale anche per un tentativo mai
    // completato: non aver mai applicato lo schema non è una ragione per smettere di sapere che
    // quella migrazione esiste.
    const migration = migrationByVersion.get(row.version)
    if (!migration) throw new Error(`Applied migration ${row.version} is missing from the repository`)

    // completed_at nullo significa "tentata e fallita": la transazione della migrazione è stata
    // annullata, nessuno schema porta il segno di quel tentativo. db.mjs (markStarted) registra
    // l'inizio con un upsert che sovrascrive proprio checksum e completed_at ad ogni tentativo —
    // l'unica ragione per farlo è permettere di correggere il file e riprovare. Controllare il
    // checksum di una riga così non protegge nulla di applicato: renderebbe invece ogni migrazione
    // fallita un blocco permanente, perché il tentativo successivo — con il file corretto — non
    // potrebbe mai più superare questo controllo. Una riga con completed_at valorizzato è tutt'altra
    // cosa: quella è una migrazione che ha davvero cambiato lo schema, ed è lì che l'immutabilità va
    // fatta rispettare senza eccezioni. Solo *questo* confronto va limitato alle righe completate —
    // non il controllo di esistenza sopra, che resta incondizionato.
    if (!row.completedAt) continue
    if (migration.checksum !== row.checksum) {
      throw new Error(`Checksum mismatch for applied migration ${migration.version}_${migration.name}`)
    }
  }
}

// Rilascio a tappe (specifica 2026-10-13, §5.1): `apply --to <versione>` applica le migrazioni in
// sospeso fino a quella versione compresa, poi si ferma. Senza versione restituisce l'elenco intero.
export function selectMigrationsUpTo(migrations, to) {
  if (to === undefined) return migrations
  if (!/^\d{4}$/.test(to)) throw new Error(`Migration version must be four digits, got "${to}"`)
  const index = migrations.findIndex(migration => migration.version === to)
  if (index === -1) throw new Error(`Migration ${to} does not exist`)
  return migrations.slice(0, index + 1)
}

export function parseApplyArguments(args) {
  if (args.length === 0) return { to: undefined }
  if (args[0].startsWith('--to=')) {
    throw new Error(`Unexpected argument "${args[0]}": use --to ${args[0].slice('--to='.length)}`)
  }
  if (args[0] !== '--to') throw new Error(`Unexpected argument "${args[0]}"`)
  if (args.length < 2) throw new Error('--to requires a version, for example --to 0045')
  if (args.length > 2) throw new Error(`Unexpected argument "${args[2]}"`)
  return { to: args[1] }
}

export async function applyPendingMigrations(adapter, migrations, { to } = {}) {
  // La selezione avviene prima di toccare il database, così una versione inesistente fallisce subito.
  const selected = selectMigrationsUpTo(migrations, to)
  const historyRows = await adapter.loadHistory()
  // Il controllo dei checksum vale per l'elenco intero, non per quello tagliato: una migrazione già
  // applicata oltre la versione scelta non e' "assente dal repository".
  assertAppliedMigrationChecksums(migrations, historyRows)
  const historyByVersion = new Map(historyRows.map(row => [row.version, row]))
  const applied = []

  for (const migration of selected) {
    if (historyByVersion.get(migration.version)?.completedAt) continue
    await adapter.markStarted(migration)
    await adapter.runInTransaction(migration)
    applied.push(migration.version)
  }

  return applied
}
