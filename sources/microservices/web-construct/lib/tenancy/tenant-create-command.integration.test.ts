import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { passwordSetTokens, tenant, tenantHost, tenantMembership, userRole, users } from '@/lib/db/schema'
import { withGlobal, withTenant } from '@/lib/db/tenant-db'
import { closeOwner, deleteTenantForTest } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { resolveActor } from '@/lib/rbac/actor'
import { getSystemRoleIds } from './system-roles'
import { defaultTestTenant, tenantIdForTest } from './testing'
import type { TenantId } from './tenant-id'

/**
 * Il comando `db.mjs test-tenant-create` (specifica 2026-10-20, §3.3, MT2-DEC-9, MT2-DEC-10,
 * MT2-OK-4): crea un tenant dal modello e registra il primo amministratore, in una transazione
 * sola. Con `--host` (specifica 2026-10-21, MT4-DEC-13) registra anche l'indirizzo principale, e
 * `test-tenant-host-add` ne assegna uno a un tenant esistente (MT4-DEC-17: non al predefinito né
 * al modello). Il comando gira come processo figlio, con l'ambiente che vitest.integration.config.ts ha
 * già riempito (TEST_MIGRATION_DATABASE_URL e TEST_DATABASE_DISPOSABLE).
 */
const run = promisify(execFile)
const APP_DIR = resolve(__dirname, '../..')
const AUTH_URL = 'https://construct.example.test/'
const DEFAULT = defaultTestTenant()

const createdTenants: TenantId[] = []
const createdUserIds: string[] = []

// Il tenant e il primo amministratore del primo test, che il secondo riusa.
let newTenant: TenantId
let adminId: string

interface CommandResult { code: number; stdout: string; stderr: string }

async function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await run('node', ['../../devops/db/db.mjs', command, ...args], { cwd: APP_DIR, env })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

function tenantCreate(args: string[], env: NodeJS.ProcessEnv = { ...process.env, AUTH_URL }): Promise<CommandResult> {
  return runCommand('test-tenant-create', args, env)
}

function tenantHostAdd(args: string[]): Promise<CommandResult> {
  return runCommand('test-tenant-host-add', args, { ...process.env, AUTH_URL })
}

/** Un indirizzo dedicato di prova, già nella forma normalizzata. */
function hostName(): string {
  return `zz-${unique()}.localhost`
}

async function hostRows(host: string) {
  return withGlobal(tx => tx.select({ host: tenantHost.host, idTenant: tenantHost.idTenant, isPrimary: tenantHost.isPrimary })
    .from(tenantHost).where(eq(tenantHost.host, host)))
}

async function hostRowsOf(tenantId: TenantId) {
  return withGlobal(tx => tx.select({ host: tenantHost.host, isPrimary: tenantHost.isPrimary })
    .from(tenantHost).where(eq(tenantHost.idTenant, tenantId)).orderBy(tenantHost.host))
}

function slug(): string {
  return `zzz-cmd-${unique()}`.slice(0, 40)
}

function email(): string {
  return `zzz_tenant_create_${unique()}@example.test`
}

/** L'id stampato nella prima riga: il tenant va cancellato anche se un'asserzione dopo fallisce. */
function trackTenant(stdout: string): TenantId {
  const match = /^Tenant creato: id=(\d+) /m.exec(stdout)
  if (!match) throw new Error(`no tenant id in the output:\n${stdout}`)
  const id = tenantIdForTest(Number(match[1]))
  createdTenants.push(id)
  return id
}

async function userIdOf(address: string): Promise<string | undefined> {
  const [row] = await withGlobal(tx => tx.select({ id: users.id }).from(users).where(eq(users.email, address)))
  return row?.id
}

async function rolesIn(tenantId: TenantId, userId: string): Promise<number[]> {
  const rows = await withTenant(tenantId, tx => tx.select({ id: userRole.idRole }).from(userRole)
    .where(eq(userRole.userId, userId)))
  return rows.map(row => row.id).sort((a, b) => a - b)
}

async function membershipIn(tenantId: TenantId, userId: string) {
  return withTenant(tenantId, tx => tx.select({ status: tenantMembership.status }).from(tenantMembership)
    .where(eq(tenantMembership.userId, userId)))
}

describeIntegration('db.mjs test-tenant-create', () => {
  let firstRun: CommandResult
  let firstSlug: string
  let firstEmail: string

  beforeAll(async () => {
    firstSlug = slug()
    firstEmail = email()
    // L'email arriva con maiuscole e spazi: il comando la normalizza come fa l'app.
    firstRun = await tenantCreate(['--slug', firstSlug, '--name', 'Acme di prova', '--admin', ` ${firstEmail.toUpperCase()} `])
    if (firstRun.code === 0) newTenant = trackTenant(firstRun.stdout)
    const id = await userIdOf(firstEmail)
    if (id) {
      createdUserIds.push(id)
      adminId = id
    }
    // DB remoto: un processo figlio che apre la sua connessione e copia il modello.
  }, 60_000)

  afterAll(async () => {
    const errors: unknown[] = []
    for (const id of createdTenants) {
      try { await deleteTenantForTest(id) } catch (error) { errors.push(error) }
    }
    // Token e appartenenze spariscono con gli utenti (ON DELETE CASCADE).
    if (createdUserIds.length > 0) {
      try { await withGlobal(tx => tx.delete(users).where(inArray(users.id, createdUserIds))) } catch (error) { errors.push(error) }
    }
    try { await closeOwner() } catch (error) { errors.push(error) }
    if (errors.length > 0) throw errors[0]
  }, 30_000)

  it('creates the tenant and a new first admin with a set-password link', async () => {
    expect(firstRun.stderr).toBe('')
    expect(firstRun.code).toBe(0)
    // Nessun avviso del database nell'uscita: la copia non lascia passare i NOTICE dei suoi
    // "drop table if exists" (client_min_messages della 0051).
    expect(firstRun.stdout).not.toContain('NOTICE')
    const lines = firstRun.stdout.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(`Tenant creato: id=${newTenant} slug=${firstSlug} nome=Acme di prova`)
    expect(lines[1]).toBe(`Primo amministratore: ${firstEmail} (account nuovo)`)
    const link = /^Link per impostare la password \(valido 48 ore\): https:\/\/construct\.example\.test\/set-password\?token=([0-9a-f-]{36})$/
      .exec(lines[2])
    expect(link, lines[2]).not.toBeNull()
    const token = link![1]

    const [created] = await withGlobal(tx => tx.select({ slug: tenant.slug, name: tenant.name, isTemplate: tenant.isTemplate })
      .from(tenant).where(eq(tenant.id, newTenant)))
    expect(created).toEqual({ slug: firstSlug, name: 'Acme di prova', isTemplate: false })

    const [account] = await withGlobal(tx => tx.select({ authProvider: users.authProvider, passwordHash: users.passwordHash })
      .from(users).where(eq(users.id, adminId)))
    expect(account).toEqual({ authProvider: 'credentials', passwordHash: null })

    expect(await membershipIn(newTenant, adminId)).toEqual([{ status: 'active' }])
    // Il comando lavora solo nel tenant nuovo: nessuna appartenenza nel predefinito.
    expect(await membershipIn(DEFAULT, adminId)).toEqual([])
    const system = await withTenant(newTenant, tx => getSystemRoleIds(tx))
    expect(await rolesIn(newTenant, adminId)).toEqual([system.registered, system.tenantAdmin].sort((a, b) => a - b))

    const tokens = await withGlobal(tx => tx.select().from(passwordSetTokens).where(eq(passwordSetTokens.userId, adminId)))
    expect(tokens).toHaveLength(1)
    const [row] = tokens
    expect(row.token).toBe(token)
    expect(row.purpose).toBe('invitation')
    expect(row.deliveryStatus).toBe('sent')
    expect(row.deliveredAt).not.toBeNull()
    expect(row.deliveryAttemptedAt).not.toBeNull()
    expect(row.usedAt).toBeNull()
    const hoursLeft = (new Date(row.expiresAt).getTime() - Date.now()) / 3_600_000
    expect(hoursLeft).toBeGreaterThan(47)
    expect(hoursLeft).toBeLessThan(49)
  })

  it('the first admin is an admin actor inside the new tenant', async () => {
    const actor = await resolveActor(newTenant, adminId)
    expect(actor?.isAdmin).toBe(true) // MT2-OK-4
    expect(actor?.tenantId).toBe(newTenant)
  })

  it('links an existing account without printing a link', async () => {
    const address = email()
    const [existing] = await withGlobal(tx => tx.insert(users)
      .values({ email: address, authProvider: 'credentials', passwordHash: '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234' })
      .returning({ id: users.id }))
    createdUserIds.push(existing.id)

    const newSlug = slug()
    const result = await tenantCreate(['--slug', newSlug, '--name', 'Esistente', '--admin', address])
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    const tenantId = trackTenant(result.stdout)
    expect(result.stdout.trimEnd().split('\n')).toEqual([
      `Tenant creato: id=${tenantId} slug=${newSlug} nome=Esistente`,
      `Primo amministratore: ${address} (account esistente)`,
    ])

    expect(await userIdOf(address)).toBe(existing.id)
    expect(await membershipIn(tenantId, existing.id)).toEqual([{ status: 'active' }])
    const system = await withTenant(tenantId, tx => getSystemRoleIds(tx))
    expect(await rolesIn(tenantId, existing.id)).toEqual([system.registered, system.tenantAdmin].sort((a, b) => a - b))
    const tokens = await withGlobal(tx => tx.select({ id: passwordSetTokens.id }).from(passwordSetTokens)
      .where(eq(passwordSetTokens.userId, existing.id)))
    expect(tokens).toEqual([])
    expect((await resolveActor(tenantId, existing.id))?.isAdmin).toBe(true)
  }, 60_000)

  it('without AUTH_URL prints the path and says to prepend the site address', async () => {
    const env = { ...process.env }
    delete env.AUTH_URL
    const address = email()
    const result = await tenantCreate(['--slug', slug(), '--name', 'Senza indirizzo', '--admin', address], env)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    trackTenant(result.stdout)
    const id = await userIdOf(address)
    if (id) createdUserIds.push(id)
    const lines = result.stdout.trimEnd().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[2]).toMatch(/^Link per impostare la password \(valido 48 ore\): \/set-password\?token=[0-9a-f-]{36}$/)
    expect(lines[3]).toBe("AUTH_URL non impostata: anteponi l'indirizzo del sito.")
  }, 60_000)

  it('refuses a globally deactivated first admin with exit code 1 and leaves no tenant, membership or token', async () => {
    // Senza password: se il comando andasse a buon fine stamperebbe anche un link.
    const address = email()
    const [deactivated] = await withGlobal(tx => tx.insert(users)
      .values({ email: address, authProvider: 'credentials', idUserStatus: 1 })
      .returning({ id: users.id }))
    createdUserIds.push(deactivated.id)
    const tenantsBefore = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).orderBy(tenant.id))

    const newSlug = slug()
    const result = await tenantCreate(['--slug', newSlug, '--name', 'Senza amministratore', '--admin', address])
    if (result.code === 0) trackTenant(result.stdout)

    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Il primo amministratore non è attivo: account disattivato a livello globale. Nessun tenant creato.')
    expect(await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, newSlug)))).toEqual([])
    expect(await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).orderBy(tenant.id))).toEqual(tenantsBefore)
    // Nessuna appartenenza, in nessun tenant: la riga si vedrebbe almeno dal tenant del proprio id.
    for (const { id } of tenantsBefore) {
      expect(await membershipIn(tenantIdForTest(id), deactivated.id)).toEqual([])
    }
    expect(await withGlobal(tx => tx.select({ id: passwordSetTokens.id }).from(passwordSetTokens)
      .where(eq(passwordSetTokens.userId, deactivated.id)))).toEqual([])
    const [account] = await withGlobal(tx => tx.select({ status: users.idUserStatus }).from(users).where(eq(users.id, deactivated.id)))
    expect(account.status).toBe(1)
  }, 60_000)

  it('a duplicate slug fails with exit code 1 and leaves no account, membership or tenant behind', async () => {
    const address = email()
    const tenantsBefore = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant))
    const result = await tenantCreate(['--slug', firstSlug, '--name', 'Doppione', '--admin', address])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^ERROR: /)
    const tenantsAfter = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant))
    expect(tenantsAfter).toEqual(tenantsBefore)
    expect(await userIdOf(address)).toBeUndefined()
    // Il primo amministratore del tenant con quello slug non ha preso altre appartenenze.
    expect(await membershipIn(newTenant, adminId)).toEqual([{ status: 'active' }])
    const stillOne = await withTenant(newTenant, tx => tx.select({ userId: tenantMembership.userId }).from(tenantMembership)
      .where(eq(tenantMembership.status, 'active')))
    expect(stillOne.map(row => row.userId)).toEqual([adminId])
  }, 60_000)
  it('tenant-create --host registers it as primary and the set-password link uses it', async () => {
    const host = hostName()
    const address = email()
    const newSlug = slug()
    const env = { ...process.env, AUTH_URL: 'http://localhost:3000' }
    // L'indirizzo arriva con maiuscole, spazi e porta: si salva normalizzato.
    const result = await tenantCreate(['--slug', newSlug, '--name', 'Con indirizzo', '--admin', address, '--host', ` ${host.toUpperCase()}:3000 `], env)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    const tenantId = trackTenant(result.stdout)
    const id = await userIdOf(address)
    if (id) createdUserIds.push(id)

    const lines = result.stdout.trimEnd().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe(`Tenant creato: id=${tenantId} slug=${newSlug} nome=Con indirizzo`)
    expect(lines[1]).toBe(`Indirizzo principale: ${host}`)
    expect(lines[2]).toBe(`Primo amministratore: ${address} (account nuovo)`)
    // Schema e porta di AUTH_URL, solo il nome dell'host è quello del tenant (come tenantBaseUrl).
    expect(lines[3]).toMatch(new RegExp(`^Link per impostare la password \\(valido 48 ore\\): http://${host.replace(/\./g, '\\.')}:3000/set-password\\?token=[0-9a-f-]{36}$`))
    expect(await hostRows(host)).toEqual([{ host, idTenant: tenantId, isPrimary: true }])
  }, 60_000)

  it('tenant-create --host with a host already taken fails and creates nothing', async () => {
    const taken = hostName()
    const added = await tenantHostAdd(['--slug', firstSlug, '--host', taken])
    expect(added.code, added.stderr).toBe(0)

    const address = email()
    const newSlug = slug()
    const tenantsBefore = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).orderBy(tenant.id))
    const result = await tenantCreate(['--slug', newSlug, '--name', 'Indirizzo preso', '--admin', address, '--host', taken])
    if (result.code === 0) trackTenant(result.stdout)
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(`L'indirizzo ${taken} è già assegnato`)
    expect(await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).orderBy(tenant.id))).toEqual(tenantsBefore)
    expect(await userIdOf(address)).toBeUndefined()
    expect(await hostRows(taken)).toEqual([{ host: taken, idTenant: newTenant, isPrimary: false }])
  }, 90_000)

  it('tenant-create with an invalid --host fails before touching the database', async () => {
    const address = email()
    const result = await tenantCreate(['--slug', slug(), '--name', 'Indirizzo storto', '--admin', address, '--host', 'a b/c'])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^ERROR: --host non è un indirizzo valido/)
    expect(await userIdOf(address)).toBeUndefined()
  })

  it('tenant-host-add adds a non-primary host, normalized, to an existing tenant', async () => {
    const host = hostName()
    const result = await tenantHostAdd(['--slug', firstSlug, '--host', ` ${host.toUpperCase()}:3000 `])
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout.trimEnd().split('\n')).toEqual([`Indirizzo assegnato: ${host} al tenant ${firstSlug} (non principale)`])
    expect(await hostRows(host)).toEqual([{ host, idTenant: newTenant, isPrimary: false }])
  }, 60_000)

  it('tenant-host-add --primary makes it the primary, and a second primary is refused', async () => {
    // Il tenant di questo test è nuovo: nessun indirizzo, quindi nessun principale.
    const address = email()
    const ownSlug = slug()
    const created = await tenantCreate(['--slug', ownSlug, '--name', 'Principale', '--admin', address])
    expect(created.code, created.stderr).toBe(0)
    const ownTenant = trackTenant(created.stdout)
    const id = await userIdOf(address)
    if (id) createdUserIds.push(id)

    const first = hostName()
    const added = await tenantHostAdd(['--slug', ownSlug, '--host', first, '--primary'])
    expect(added.stderr).toBe('')
    expect(added.code).toBe(0)
    expect(added.stdout.trimEnd().split('\n')).toEqual([`Indirizzo assegnato: ${first} al tenant ${ownSlug} (principale)`])

    // Un secondo principale si rifiuta, senza spostare quello che c'è: va tolto o cambiato a mano.
    const second = hostName()
    const refused = await tenantHostAdd(['--slug', ownSlug, '--host', second, '--primary'])
    expect(refused.code).toBe(1)
    expect(refused.stdout).toBe('')
    expect(refused.stderr).toContain(`Il tenant ${ownSlug} ha già un indirizzo principale (${first})`)
    expect(await hostRowsOf(ownTenant)).toEqual([{ host: first, isPrimary: true }])

    // Lo stesso indirizzo senza --primary entra.
    const plain = await tenantHostAdd(['--slug', ownSlug, '--host', second])
    expect(plain.code, plain.stderr).toBe(0)
    expect((await hostRowsOf(ownTenant)).map(row => [row.host, row.isPrimary]).sort())
      .toEqual([[first, true], [second, false]].sort())
  }, 90_000)

  it('tenant-host-add refuses a host already taken, and changes nothing', async () => {
    const host = hostName()
    const added = await tenantHostAdd(['--slug', firstSlug, '--host', host])
    expect(added.code, added.stderr).toBe(0)
    const before = await hostRowsOf(newTenant)

    // Stesso tenant e tenant diverso: l'indirizzo è uno solo in tutto il registro.
    for (const target of [firstSlug, 'default']) {
      const result = await tenantHostAdd(['--slug', target, '--host', host.toUpperCase()])
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toMatch(/^ERROR: /)
    }
    const again = await tenantHostAdd(['--slug', firstSlug, '--host', host])
    expect(again.code).toBe(1)
    expect(again.stderr).toContain(`L'indirizzo ${host} è già assegnato`)
    expect(await hostRowsOf(newTenant)).toEqual(before)
    expect(await hostRows(host)).toEqual([{ host, idTenant: newTenant, isPrimary: false }])
  }, 90_000)

  it('tenant-host-add refuses the default tenant and the template', async () => {
    for (const target of ['default', 'template']) {
      const host = hostName()
      const result = await tenantHostAdd(['--slug', target, '--host', host, '--primary'])
      expect(result.code, target).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain(`Il tenant ${target} non può avere un indirizzo dedicato`)
      expect(await hostRows(host)).toEqual([])
    }
  }, 60_000)

  it('tenant-host-add refuses an unknown slug and an invalid host', async () => {
    const host = hostName()
    const unknown = await tenantHostAdd(['--slug', `zzz-nessuno-${unique()}`.slice(0, 40), '--host', host])
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toMatch(/^ERROR: Il tenant .* non esiste/)
    expect(await hostRows(host)).toEqual([])

    const invalid = await tenantHostAdd(['--slug', firstSlug, '--host', 'http://a.localhost'])
    expect(invalid.code).toBe(1)
    expect(invalid.stderr).toMatch(/^ERROR: --host non è un indirizzo valido/)
  }, 60_000)
})
