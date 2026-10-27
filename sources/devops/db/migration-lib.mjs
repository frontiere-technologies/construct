import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { userInfo } from 'node:os'
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

// Un indirizzo nella forma con cui l'app lo confronta e `tenant_host.host` lo salva (specifica
// 2026-10-21, MT4-DEC-13): minuscolo, senza porta e senza punto finale (`A.Localhost:3000` →
// `a.localhost`). È la stessa regola di `normalizeHost` in lib/tenancy/request-host.ts, duplicata
// perché questo file non importa codice dell'app; i due test devono restare allineati. Un indirizzo
// IPv6 non si registra: il controllo della tabella rifiuta i due punti. `null` se non è valido.
const HOST_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/
const MAX_HOST_LENGTH = 253

export function normalizeHostArgument(raw) {
  const value = raw?.trim().toLowerCase()
  if (!value) return null
  const portAt = value.lastIndexOf(':')
  if (portAt !== -1 && !/^\d{1,5}$/.test(value.slice(portAt + 1))) return null
  const name = (portAt === -1 ? value : value.slice(0, portAt)).replace(/\.$/, '')
  if (!name || name.length > MAX_HOST_LENGTH || !HOST_NAME.test(name)) return null
  return name
}

function parseHostOption(raw) {
  const host = normalizeHostArgument(raw)
  if (!host) throw new Error(`--host non è un indirizzo valido: "${raw}"`)
  return host
}

// Le opzioni con un valore, ognuna una volta sola; `booleanFlags` sono quelle senza valore.
function collectFlags(args, valueFlags, booleanFlags = []) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    const equals = flag.indexOf('=')
    if (flag.startsWith('--') && equals > 0 && valueFlags.includes(flag.slice(0, equals))) {
      throw new Error(`Argomento non previsto "${flag}": usa ${flag.slice(0, equals)} ${flag.slice(equals + 1)}`)
    }
    const isBoolean = booleanFlags.includes(flag)
    if (!isBoolean && !valueFlags.includes(flag)) throw new Error(`Argomento non previsto "${flag}"`)
    if (values.has(flag)) throw new Error(`${flag} compare due volte`)
    if (isBoolean) {
      values.set(flag, true)
      continue
    }
    if (index + 1 >= args.length) throw new Error(`${flag} richiede un valore`)
    values.set(flag, args[index + 1])
    index += 1
  }
  return values
}

function parseSlugOption(slug) {
  if (!TENANT_SLUG.test(slug)) {
    throw new Error(`Lo slug "${slug}" non è valido: da 3 a 40 caratteri fra a-z, 0-9 e -`)
  }
  return slug
}

// L'email si normalizza come la normalizza l'app (minuscole, senza spazi).
function parseEmailOption(flag, raw) {
  const email = raw.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error(`${flag} non è un indirizzo email: "${email}"`)
  return email
}

// tenant-create (specifica 2026-10-20, §3.3): le tre opzioni sono obbligatorie e ognuna compare una
// volta sola; `--host` è facoltativa (MT4-DEC-13). Lo slug segue il controllo di tenant.slug, così un
// valore sbagliato fallisce prima di aprire la connessione; l'email si normalizza come la normalizza
// l'app (minuscole, senza spazi).
const TENANT_CREATE_FLAGS = ['--slug', '--name', '--admin']
const TENANT_SLUG = /^[a-z0-9-]{3,40}$/

export function parseTenantCreateArguments(args) {
  const values = collectFlags(args, [...TENANT_CREATE_FLAGS, '--host'])
  for (const flag of TENANT_CREATE_FLAGS) {
    if (!values.has(flag)) throw new Error(`Manca ${flag}: tenant-create --slug <slug> --name <nome> --admin <email> [--host <indirizzo>]`)
  }

  const slug = parseSlugOption(values.get('--slug'))
  const name = values.get('--name').trim()
  if (!name) throw new Error('--name non può essere vuoto')
  const admin = parseEmailOption('--admin', values.get('--admin'))
  const result = { slug, name, admin }
  if (values.has('--host')) result.host = parseHostOption(values.get('--host'))
  return result
}

// tenant-host-add (specifica 2026-10-21, MT4-DEC-13): assegna un indirizzo dedicato a un tenant che
// esiste già. `--primary` non ha valore e rende l'indirizzo quello dei link nelle email.
export function parseTenantHostArguments(args) {
  const values = collectFlags(args, ['--slug', '--host'], ['--primary'])
  for (const flag of ['--slug', '--host']) {
    if (!values.has(flag)) throw new Error(`Manca ${flag}: tenant-host-add --slug <slug> --host <indirizzo> [--primary]`)
  }
  return {
    slug: parseSlugOption(values.get('--slug')),
    host: parseHostOption(values.get('--host')),
    primary: values.has('--primary'),
  }
}

// test-tenant-member-add (solo database di prova, E2E dei tenant): dà a una persona l'appartenenza
// attiva a un tenant; `--admin` la rende anche amministratrice, come il primo amministratore di
// tenant-create.
export function parseTenantMemberArguments(args) {
  const values = collectFlags(args, ['--slug', '--email'], ['--admin'])
  for (const flag of ['--slug', '--email']) {
    if (!values.has(flag)) throw new Error(`Manca ${flag}: test-tenant-member-add --slug <slug> --email <email> [--admin]`)
  }
  return {
    slug: parseSlugOption(values.get('--slug')),
    email: parseEmailOption('--email', values.get('--email')),
    admin: values.has('--admin'),
  }
}

// test-tenant-delete (solo database di prova, E2E dei tenant): cancella uno o più tenant di prova
// con tutte le loro righe, in una transazione sola. `--slug` si ripete, una volta per tenant: gli E2E
// ne tolgono tre a ogni pulizia, e ogni lancio di db.mjs costa un processo e una connessione. Lo
// stesso slug due volte è un errore. Il predefinito si rifiuta già qui; il modello, che si
// riconosce solo dal database, lo rifiuta il comando.
export function parseTenantDeleteArguments(args) {
  const slugs = []
  // A coppie: ogni coppia passa da collectFlags, che dà gli stessi errori degli altri comandi
  // (argomento non previsto, --slug senza valore, --slug=valore).
  for (let index = 0; index < args.length; index += 2) {
    const values = collectFlags(args.slice(index, index + 2), ['--slug'])
    const slug = parseSlugOption(values.get('--slug'))
    if (slug === 'default') throw new Error('Il tenant predefinito non si cancella')
    if (slugs.includes(slug)) throw new Error(`--slug ${slug} compare due volte`)
    slugs.push(slug)
  }
  if (!slugs.length) throw new Error('Manca --slug: test-tenant-delete --slug <slug> [--slug <slug> ...]')
  return { slugs }
}

// platform-admin-add / platform-admin-remove (specifica 2026-10-26, MT5-DEC-2): l'account si
// indica per email, normalizzata come la normalizza l'app.
export function parsePlatformAdminArguments(args) {
  const values = collectFlags(args, ['--email'])
  if (!values.has('--email')) throw new Error('Manca --email: platform-admin-add --email <email> | platform-admin-remove --email <email>')
  return { email: parseEmailOption('--email', values.get('--email')) }
}

/**
 * Chi ha lanciato il comando, per il registro della piattaforma (MT5-DEC-22): l'utente del sistema
 * operativo se c'è, poi USER e LOGNAME dell'ambiente, altrimenti niente. Il valore finisce nella
 * colonna `actor_email` (la persona può mancare per un comando).
 */
export function commandActorEmail(env = process.env, readUser = userInfo) {
  let name = ''
  try {
    name = readUser().username ?? ''
  } catch {
    // Nessuna voce per l'utente nel sistema (contenitori, utenti senza passwd): si prova l'ambiente.
  }
  for (const candidate of [name, env.USER, env.LOGNAME]) {
    const trimmed = typeof candidate === 'string' ? candidate.trim() : ''
    if (trimmed) return trimmed
  }
  return null
}

// I codici delle operazioni che un comando scrive: sono un sottoinsieme di AUDIT_OPERATIONS in
// lib/audit/audit-types.ts (lo verifica migration-lib.test.mjs). Un codice che non compare qui non
// si scrive: un refuso resterebbe nel registro per sempre.
export const COMMAND_AUDIT_OPERATIONS = new Set([
  'platform.admin.add',
  'platform.admin.remove',
  'tenant.create',
  'tenant.host.add',
  'tenant.host.primary',
])

// Le chiavi dei dettagli che porterebbero un segreto (MT5-RISK-4): specchio di
// `sanitizeAuditDetails` in lib/audit/audit-types.ts.
const FORBIDDEN_DETAIL_KEY = /password|token|link|secret/i

function cleanDetails(value) {
  if (Array.isArray(value)) return value.map(cleanDetails)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, inner]) => !FORBIDDEN_DETAIL_KEY.test(key) && inner !== undefined)
        .map(([key, inner]) => [key, cleanDetails(inner)]),
    )
  }
  return value
}

/**
 * Scrive una voce nel registro della piattaforma con veste "command" (MT5-DEC-22), dentro la
 * transazione `tx` della modifica: se la transazione si annulla, la voce non c'è. `tx` è la
 * transazione di postgres.js, già `set local role construct_owner` (il proprietario inserisce in
 * `platform_audit_event`). La persona manca (`actor_user_id` nullo); `actorEmail` è l'utente del
 * sistema operativo. I dettagli passano dal filtro delle chiavi segrete: il link e il token della
 * password non ci entrano mai.
 */
export async function recordCommandAudit(tx, { tenantId = null, operation, objectType, objectId, details = {} }, actorEmail = commandActorEmail()) {
  if (!COMMAND_AUDIT_OPERATIONS.has(operation)) throw new Error(`Operazione di registro sconosciuta: ${operation}`)
  await tx`
    insert into public.platform_audit_event (id_tenant, actor_user_id, actor_email, actor_kind, operation, object_type, object_id, details)
    values (${tenantId}, null, ${actorEmail}, 'command', ${operation}, ${objectType}, ${objectId === null ? null : String(objectId)}, ${JSON.stringify(cleanDetails(details))}::text::jsonb)
  `
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
