import { sql } from 'drizzle-orm'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { resolvePlatformDatabaseUrl } from '@/lib/test-database'
import { createDatabase, type Database } from './client'

export type PlatformTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

let platform: ReturnType<typeof createDatabase> | null = null

/**
 * Il client dell'identità di piattaforma (specifica 2026-10-26, §2.2, MT5-RISK-1): costruito alla
 * prima richiesta e non all'avvio, perché l'app deve partire anche senza `PLATFORM_DATABASE_URL`
 * (la serve solo la console). Un pool piccolo: la console non ha il traffico dell'app.
 */
function platformDatabase(): Database {
  platform ??= createDatabase(resolvePlatformDatabaseUrl(process.env), { max: 3 })
  return platform.database
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
    await tx.execute(sql`set local role construct_owner`)
    if (tenantId !== undefined) {
      await tx.execute(sql.raw(`select set_config('app.tenant_id', '${tenantId}', true)`))
    }
    return fn(tx)
  })
}

/** Per i test di integrazione: chiude il pool, così il processo può uscire. */
export async function closePlatformDatabase(): Promise<void> {
  const open = platform
  platform = null
  await open?.close()
}
