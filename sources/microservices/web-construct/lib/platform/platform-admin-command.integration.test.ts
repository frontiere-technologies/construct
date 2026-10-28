import { execFile } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { passwordSetTokens, users } from '@/lib/db/schema'
import { withGlobal } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'

/**
 * I comandi `db.mjs test-platform-admin-add` e `test-platform-admin-remove` (specifica 2026-10-26,
 * MT5-DEC-2, MT5-DEC-22, MT5-DEC-23): nominano o tolgono un amministratore di piattaforma, creando
 * l'account se manca (il link per la password si stampa verso AUTH_URL), rifiutano di togliere
 * l'ultimo, e scrivono nel registro della piattaforma con veste "command". Il comando gira come
 * processo figlio, con l'ambiente che vitest.integration.config.ts ha già riempito.
 */
const run = promisify(execFile)
const APP_DIR = resolve(__dirname, '../..')
const AUTH_URL = 'https://construct.example.test/'
const PASSWORD_HASH = '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234'

interface CommandResult { code: number; stdout: string; stderr: string }

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await run('node', ['../../devops/db/db.mjs', command, ...args], {
      cwd: APP_DIR,
      env: { ...process.env, AUTH_URL },
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

const adminAdd = (email: string) => runCommand('test-platform-admin-add', ['--email', email])
const adminRemove = (email: string) => runCommand('test-platform-admin-remove', ['--email', email])

function email(): string {
  return `zzz_platform_admin_${unique()}@example.test`
}

/** L'utente del sistema operativo, come lo scrive il comando (MT5-DEC-22). */
const OPERATOR = userInfo().username

const createdUserIds: string[] = []
/** Gli amministratori di piattaforma che c'erano prima: la prova li toglie e li rimette. */
let preexisting: string[] = []

async function userRow(address: string) {
  const [row] = await withGlobal(tx => tx.select({
    id: users.id,
    isPlatformAdmin: users.isPlatformAdmin,
    passwordHash: users.passwordHash,
    authProvider: users.authProvider,
  }).from(users).where(eq(users.email, address)))
  return row
}

async function createAccount(address: string, extra: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await withGlobal(tx => tx.insert(users)
    .values({ email: address, authProvider: 'credentials', passwordHash: PASSWORD_HASH, ...extra })
    .returning({ id: users.id }))
  createdUserIds.push(row.id)
  return row.id
}

/** Il registro della piattaforma, letto come proprietario: il ruolo dell'app non lo rilegge. */
async function auditRowsOf(userId: string) {
  return withOwner(tx => tx.execute<{
    id_tenant: string | null
    actor_user_id: string | null
    actor_email: string | null
    actor_kind: string
    operation: string
    object_type: string | null
    object_id: string | null
    details: Record<string, unknown>
  }>(sql`
    select id_tenant, actor_user_id, actor_email, actor_kind, operation, object_type, object_id, details
    from public.platform_audit_event where object_id = ${userId} order by id`))
}

/** Nessun amministratore di piattaforma: le prove sul "non si toglie l'ultimo" partono da qui. */
async function clearAdmins(): Promise<void> {
  await withOwner(tx => tx.execute(sql`update public.users set is_platform_admin = false where is_platform_admin`))
}

async function flaggedAdmins(): Promise<string[]> {
  const rows = await withGlobal(tx => tx.select({ id: users.id }).from(users).where(eq(users.isPlatformAdmin, true)))
  return rows.map(row => row.id).sort()
}

/**
 * ATTENZIONE: questa prova toglie l'attributo a TUTTI gli amministratori di piattaforma del database
 * di prova condiviso (servono amministratori noti per provare "non si toglie l'ultimo") e li rimette
 * in `afterAll`. Se l'esecuzione viene uccisa prima, il database resta senza amministratori di
 * piattaforma: per rimetterli, `bash sources/devops/db/local-test-db.sh reset` (database locale) oppure
 * `test-platform-admin-add --email <email dell'amministratore E2E>` con l'ambiente di prova caricato.
 * Per ridurre il rischio, l'elenco di chi c'era si scrive nel file temporaneo qui sotto prima di toccare
 * il database; il lancio successivo, se lo trova, rimette quegli amministratori prima di cominciare.
 */
const RESTORE_FILE = join(tmpdir(), 'construct-platform-admin-command-test-restore.json')

function readRestoreFile(): string[] {
  try { return JSON.parse(readFileSync(RESTORE_FILE, 'utf8')) as string[] } catch { return [] }
}

async function restoreAdmins(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await withOwner(tx => tx.execute(sql`update public.users set is_platform_admin = true where id in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})`))
}

describeIntegration('db.mjs test-platform-admin-add / test-platform-admin-remove', () => {
  beforeAll(async () => {
    // Un'esecuzione uccisa ha lasciato il suo elenco: si rimette a posto prima di cominciare.
    await restoreAdmins(readRestoreFile())
    preexisting = await flaggedAdmins()
    writeFileSync(RESTORE_FILE, JSON.stringify(preexisting))
    // Per provare "non si toglie l'ultimo" servono amministratori noti: gli altri si rimettono alla fine.
    await clearAdmins()
  }, 30_000)

  afterAll(async () => {
    const errors: unknown[] = []
    try {
      await withOwner(async tx => {
        if (createdUserIds.length > 0) {
          await tx.execute(sql`delete from public.platform_audit_event where object_id in (${sql.join(createdUserIds.map(id => sql`${id}`), sql`, `)})`)
          await tx.execute(sql`update public.users set is_platform_admin = false where id in (${sql.join(createdUserIds.map(id => sql`${id}::uuid`), sql`, `)})`)
        }
      })
      await restoreAdmins(preexisting)
      rmSync(RESTORE_FILE, { force: true })
    } catch (error) { errors.push(error) }
    if (createdUserIds.length > 0) {
      try { await withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))) } catch (error) { errors.push(error) }
    }
    try { await closeOwner() } catch (error) { errors.push(error) }
    if (errors.length > 0) throw errors[0]
  }, 30_000)

  it('creates a new account, flags it and prints a set-password link toward AUTH_URL', async () => {
    const address = email()
    const result = await adminAdd(` ${address.toUpperCase()} `)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout).not.toContain('NOTICE')
    const account = await userRow(address)
    createdUserIds.push(account.id)

    const lines = result.stdout.trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(`Amministratore di piattaforma: ${address} (account nuovo)`)
    const link = /^Link per impostare la password \(valido 48 ore\): https:\/\/construct\.example\.test\/set-password\?token=([0-9a-f-]{36})$/
      .exec(lines[1])
    expect(link, lines[1]).not.toBeNull()
    const token = link![1]

    expect(account).toMatchObject({ isPlatformAdmin: true, passwordHash: null, authProvider: 'credentials' })
    const tokens = await withGlobal(tx => tx.select().from(passwordSetTokens).where(eq(passwordSetTokens.userId, account.id)))
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ token, purpose: 'invitation', deliveryStatus: 'sent', usedAt: null })
    expect(tokens[0].deliveredAt).not.toBeNull()
    const hoursLeft = (new Date(tokens[0].expiresAt).getTime() - Date.now()) / 3_600_000
    expect(hoursLeft).toBeGreaterThan(47)
    expect(hoursLeft).toBeLessThan(49)

    // Una voce nel registro della piattaforma, con veste "command" e senza il link (MT5-RISK-4).
    const audit = await auditRowsOf(account.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      id_tenant: null,
      actor_user_id: null,
      actor_email: OPERATOR,
      actor_kind: 'command',
      operation: 'platform.admin.add',
      object_type: 'user',
      object_id: account.id,
    })
    expect(audit[0].details).toEqual({ email: address, accountCreated: true })
    expect(JSON.stringify(audit[0])).not.toContain(token)
  }, 60_000)

  it('flags an existing account without a new link', async () => {
    const address = email()
    const id = await createAccount(address)
    const result = await adminAdd(address)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout.trimEnd().split('\n')).toEqual([`Amministratore di piattaforma: ${address} (account esistente)`])
    expect(await userRow(address)).toMatchObject({ id, isPlatformAdmin: true, passwordHash: PASSWORD_HASH })
    expect(await withGlobal(tx => tx.select({ id: passwordSetTokens.id }).from(passwordSetTokens)
      .where(eq(passwordSetTokens.userId, id)))).toEqual([])
    const audit = await auditRowsOf(id)
    expect(audit.map(row => [row.operation, row.actor_kind, row.details])).toEqual([
      ['platform.admin.add', 'command', { email: address, accountCreated: false }],
    ])
  }, 60_000)

  it('adding an account that is already an administrator changes nothing and writes no row', async () => {
    const address = email()
    const id = await createAccount(address)
    expect((await adminAdd(address)).code).toBe(0)
    const again = await adminAdd(address)
    expect(again.stderr).toBe('')
    expect(again.code).toBe(0)
    expect(again.stdout.trimEnd().split('\n')).toEqual([`${address} è già amministratore di piattaforma: nessuna modifica`])
    expect(await auditRowsOf(id)).toHaveLength(1)
    expect((await userRow(address)).isPlatformAdmin).toBe(true)
  }, 60_000)

  it('adding again an administrator who has no password prints a fresh link, supersedes the old one and writes an invite row', async () => {
    const address = email()
    const first = await adminAdd(address)
    expect(first.code).toBe(0)
    const account = await userRow(address)
    createdUserIds.push(account.id)
    const linkOf = (stdout: string) => /set-password\?token=([0-9a-f-]{36})$/m.exec(stdout)?.[1]
    const oldToken = linkOf(first.stdout)!
    expect(oldToken).toBeDefined()
    // Il link è scaduto: l'orologio è quello del database.
    await withOwner(tx => tx.execute(sql`update public.password_set_tokens set expires_at = now() - interval '1 hour' where user_id = ${account.id}`))

    const again = await adminAdd(address)
    expect(again.stderr).toBe('')
    expect(again.code).toBe(0)
    const lines = again.stdout.trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(`Amministratore di piattaforma: ${address} (già nominato, senza password: invito rinnovato)`)
    const freshToken = linkOf(again.stdout)!
    expect(lines[1]).toBe(`Link per impostare la password (valido 48 ore): https://construct.example.test/set-password?token=${freshToken}`)
    expect(freshToken).not.toBe(oldToken)

    const tokens = await withGlobal(tx => tx.select().from(passwordSetTokens).where(eq(passwordSetTokens.userId, account.id)))
    expect(tokens).toHaveLength(2)
    const old = tokens.find(token => token.token === oldToken)!
    const fresh = tokens.find(token => token.token === freshToken)!
    expect(old.supersededAt).not.toBeNull()
    expect(fresh).toMatchObject({ purpose: 'invitation', deliveryStatus: 'sent', usedAt: null, supersededAt: null })
    const hoursLeft = (new Date(fresh.expiresAt).getTime() - Date.now()) / 3_600_000
    expect(hoursLeft).toBeGreaterThan(47)
    expect(hoursLeft).toBeLessThan(49)
    expect((await userRow(address)).isPlatformAdmin).toBe(true)

    const audit = await auditRowsOf(account.id)
    expect(audit.map(row => [row.operation, row.actor_kind, row.actor_email, row.actor_user_id])).toEqual([
      ['platform.admin.add', 'command', OPERATOR, null],
      ['platform.admin.invite', 'command', OPERATOR, null],
    ])
    expect(audit[1]).toMatchObject({ object_type: 'user', object_id: account.id, id_tenant: null })
    expect(audit[1].details).toEqual({ email: address })
    expect(JSON.stringify(audit)).not.toContain(oldToken)
    expect(JSON.stringify(audit)).not.toContain(freshToken)

    // Una volta impostata la password torna un'operazione senza effetto e senza voce.
    await withOwner(tx => tx.execute(sql`update public.users set password_hash = ${PASSWORD_HASH} where id = ${account.id}`))
    const done = await adminAdd(address)
    expect(done.stdout.trimEnd().split('\n')).toEqual([`${address} è già amministratore di piattaforma: nessuna modifica`])
    expect(await auditRowsOf(account.id)).toHaveLength(2)
  }, 90_000)

  it('refuses a globally deactivated account and changes nothing', async () => {
    const address = email()
    const id = await createAccount(address, { idUserStatus: 1 })
    const result = await adminAdd(address)
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^ERROR: .*disattivato/)
    expect((await userRow(address)).isPlatformAdmin).toBe(false)
    expect(await auditRowsOf(id)).toEqual([])
  }, 60_000)

  it('removes an administrator while another remains, and records it', async () => {
    const keeper = email()
    const leaving = email()
    await clearAdmins()
    const keeperId = await createAccount(keeper)
    const leavingId = await createAccount(leaving)
    expect((await adminAdd(keeper)).code).toBe(0)
    expect((await adminAdd(leaving)).code).toBe(0)

    const result = await adminRemove(` ${leaving.toUpperCase()} `)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout.trimEnd().split('\n')).toEqual([`Amministratore di piattaforma tolto: ${leaving}`])
    expect((await userRow(leaving)).isPlatformAdmin).toBe(false)
    expect((await userRow(keeper)).isPlatformAdmin).toBe(true)
    const audit = await auditRowsOf(leavingId)
    expect(audit.map(row => [row.operation, row.actor_kind, row.actor_email, row.actor_user_id, row.id_tenant])).toEqual([
      ['platform.admin.add', 'command', OPERATOR, null, null],
      ['platform.admin.remove', 'command', OPERATOR, null, null],
    ])
    expect(audit[1]).toMatchObject({ object_type: 'user', object_id: leavingId })
    expect(audit[1].details).toEqual({ email: leaving })

    // Chi resta è l'ultimo: non si toglie, e non cambia niente, nemmeno nel registro.
    const last = await adminRemove(keeper)
    expect(last.code).toBe(1)
    expect(last.stdout).toBe('')
    expect(last.stderr).toContain("Non si toglie l'ultimo amministratore di piattaforma")
    expect((await userRow(keeper)).isPlatformAdmin).toBe(true)
    expect((await auditRowsOf(keeperId)).map(row => row.operation)).toEqual(['platform.admin.add'])
  }, 90_000)

  it('removing an account that is not an administrator, or does not exist, changes nothing', async () => {
    const plain = email()
    const plainId = await createAccount(plain)
    const holder = email()
    await createAccount(holder)
    expect((await adminAdd(holder)).code).toBe(0)

    const notAdmin = await adminRemove(plain)
    expect(notAdmin.stderr).toBe('')
    expect(notAdmin.code).toBe(0)
    expect(notAdmin.stdout.trimEnd().split('\n')).toEqual([`${plain} non è amministratore di piattaforma: nessuna modifica`])
    expect(await auditRowsOf(plainId)).toEqual([])

    const unknown = email()
    const missing = await adminRemove(unknown)
    expect(missing.code).toBe(1)
    expect(missing.stdout).toBe('')
    expect(missing.stderr).toContain(`Nessun account con l'email ${unknown}`)
    expect((await userRow(holder)).isPlatformAdmin).toBe(true)
  }, 90_000)

  it('two concurrent removals cannot leave the platform without an administrator', async () => {
    // Solo questi due sono amministratori.
    await clearAdmins()
    const first = email()
    const second = email()
    const firstId = await createAccount(first)
    const secondId = await createAccount(second)
    expect((await adminAdd(first)).code).toBe(0)
    expect((await adminAdd(second)).code).toBe(0)

    const [a, b] = await Promise.all([adminRemove(first), adminRemove(second)])
    expect([a.code, b.code].sort()).toEqual([0, 1])
    expect([a, b].find(result => result.code === 1)!.stderr).toContain("Non si toglie l'ultimo amministratore di piattaforma")
    expect(await flaggedAdmins()).toHaveLength(1)
    const removed = (await auditRowsOf(firstId)).concat(await auditRowsOf(secondId)).filter(row => row.operation === 'platform.admin.remove')
    expect(removed).toHaveLength(1)
  }, 90_000)

  it('rejects a bad email before touching the database', async () => {
    const result = await adminAdd('non-una-email')
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^ERROR: --email non è un indirizzo email/)
  })
})
