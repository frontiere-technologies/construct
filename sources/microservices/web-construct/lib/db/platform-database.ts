import { sql } from 'drizzle-orm'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { resolvePlatformDatabaseUrl } from '@/lib/test-database'
import { createDatabase, type Database } from './client'

export type PlatformTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

let platform: ReturnType<typeof createDatabase> | null = null
/** Il pool in uso ha già superato il controllo del login (una volta per pool: dopo non costa un viaggio in più). */
let identityVerified = false

/**
 * Il client dell'identità di piattaforma (specifica 2026-10-26, §2.2, MT5-RISK-1): costruito alla
 * prima richiesta e non all'avvio, perché l'app deve partire anche senza `PLATFORM_DATABASE_URL`
 * (la serve solo la console). Un pool piccolo: la console non ha il traffico dell'app.
 */
function platformDatabase(): Database {
  if (!platform) {
    platform = createDatabase(resolvePlatformDatabaseUrl(process.env), { max: 3 })
    identityVerified = false
  }
  return platform.database
}

/**
 * Il login con cui il pool si è collegato dev'essere quello di piattaforma e non un'identità più
 * forte (MT5-RISK-1): se `PLATFORM_DATABASE_URL` puntasse per errore al login delle migrazioni o a
 * un superutente, `set local role` non servirebbe più a niente, perché quel login potrebbe già
 * tutto (e senza passare dalle guardie dell'identità ridotta). Si rifiuta quindi un login che usa
 * construct_owner senza `set role` (eredita il ruolo), che è superutente o che salta la RLS.
 * Un'istruzione sola, prima del `set local role` della prima transazione del pool; il risultato
 * positivo si ricorda e le transazioni dopo non pagano nulla. Il difetto invece non si ricorda: ogni
 * richiesta lo rivede e fallisce, finché la configurazione non è corretta.
 */
async function assertPlatformLoginIsLimited(tx: PlatformTransaction): Promise<void> {
  const [login] = await tx.execute<{ name: string; inherits_owner: boolean; superuser: boolean; bypass_rls: boolean }>(sql`
    select r.rolname::text as name,
           pg_catalog.pg_has_role(r.oid, 'construct_owner', 'USAGE') as inherits_owner,
           r.rolsuper as superuser,
           r.rolbypassrls as bypass_rls
    from pg_catalog.pg_roles r
    where r.rolname = current_user
  `)
  const problems = [
    login?.inherits_owner ? 'usa construct_owner senza `set role`' : null,
    login?.superuser ? 'è un superutente' : null,
    login?.bypass_rls ? 'salta la RLS' : null,
  ].filter((problem): problem is string => problem !== null)
  if (!login || problems.length > 0) {
    throw new Error(
      `PLATFORM_DATABASE_URL non è il login di piattaforma: ${login ? `${login.name} ${problems.join(' e ')}` : 'il login non si legge nel catalogo'}. `
      + 'Serve il login creato da `db.mjs provision-platform-role` (README, "Identità di piattaforma"), mai l\'identità delle migrazioni.',
    )
  }
}

/**
 * La transazione dell'identità di piattaforma. Il login `construct_platform` è membro di
 * construct_owner con NOINHERIT: da solo non ha alcun privilegio, e `set local role` è la prima
 * istruzione (vale fino alla fine della transazione e non resta sulla connessione restituita al
 * pool). La RLS forzata vale anche per il proprietario: con `tenantId` la transazione imposta il
 * tenant come withTenant (`set_config(..., true)`, il numero è verificato intero positivo, MTP-DEC-3);
 * senza, solo le tabelle globali rispondono.
 *
 * Il driver e la variabile di sessione del tenant vivono in lib/db/ (guards/tenant-boundary.test.ts);
 * questo modulo lo importa solo lib/platform/db.ts, che è la porta (guards/platform-boundary.test.ts).
 */
export async function platformTransaction<T>(
  fn: (tx: PlatformTransaction) => Promise<T>,
  tenantId?: TenantId,
): Promise<T> {
  if (tenantId !== undefined && (!Number.isSafeInteger(tenantId) || tenantId <= 0)) {
    throw new Error('invalid tenant id')
  }
  return platformDatabase().transaction(async tx => {
    if (!identityVerified) {
      await assertPlatformLoginIsLimited(tx)
      identityVerified = true
    }
    await tx.execute(sql`set local role construct_owner`)
    if (tenantId !== undefined) await setTransactionTenant(tx, tenantId)
    return fn(tx)
  })
}

/** Imposta il tenant della transazione: un intero positivo, l'unico valore che entra nel testo SQL (MTP-DEC-3). */
async function setTransactionTenant(tx: PlatformTransaction, tenantId: number): Promise<void> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error('invalid tenant id')
  await tx.execute(sql.raw(`select set_config('app.tenant_id', '${tenantId}', true)`))
}

/**
 * Passa, dentro una transazione della piattaforma già aperta, al tenant indicato. Serve a chi crea
 * il tenant nella stessa transazione (la console: il tenant nuovo non esiste prima di aprirla) e
 * deve scrivere subito la sua voce nel registro del tenant. Il tenant vale fino alla fine della
 * transazione, come con `platformTransaction`.
 */
export async function enterTenantInPlatformTransaction(tx: PlatformTransaction, tenantId: TenantId): Promise<void> {
  await setTransactionTenant(tx, tenantId)
}

/** Per i test di integrazione: chiude il pool, così il processo può uscire. */
export async function closePlatformDatabase(): Promise<void> {
  const open = platform
  platform = null
  identityVerified = false
  await open?.close()
}
