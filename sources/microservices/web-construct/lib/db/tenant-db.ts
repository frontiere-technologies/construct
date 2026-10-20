import { sql } from 'drizzle-orm'
import type { PgTransactionConfig } from 'drizzle-orm/pg-core'
import { createLogger } from '@/lib/logger'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { db, type Database } from './client'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Una transazione con il tenant impostato: può toccare tabelle di tenant e globali. */
export type TenantTx = Tx & { readonly __txBrand: 'TenantTx' }
/** Una transazione senza tenant: solo tabelle globali. Una tabella di tenant qui dà 42501. */
export type GlobalTx = Tx & { readonly __txBrand: 'GlobalTx' }
/** Per le query che leggono solo tabelle globali e servono in entrambi i contesti. */
export type AnyTx = TenantTx | GlobalTx
export type TransactionOptions = PgTransactionConfig

const log = createLogger('tenant-db')

type PgErrorLike = { code?: string; message?: string; cause?: unknown }

// Il 42501 del confine è quello di app_private.current_tenant_id(), con il messaggio `tenant
// context missing`. Un altro 42501 (per esempio un permission denied su una tabella globale in
// sola lettura) è un problema di permessi, non una violazione del confine: etichettarlo così
// manderebbe fuori strada chi analizza l'incidente. Drizzle avvolge l'errore di postgres.js, che
// resta in `cause`: si guardano entrambi.
function isTenantBoundaryError(error: unknown): boolean {
  const candidates = [error as PgErrorLike | null | undefined, (error as PgErrorLike | null | undefined)?.cause as PgErrorLike | undefined]
  return candidates.some(candidate => candidate?.code === '42501' && /tenant context missing/.test(candidate.message ?? ''))
}

/**
 * Le due sole porte verso il database (specifica 2026-10-13, §3.1, MTF-DEC-6). Il tenant vale
 * fino alla fine della transazione e mai oltre (set_config(..., true)), quindi una connessione
 * restituita al pooler non porta il tenant al cliente successivo.
 *
 * Il numero del tenant è scritto nel testo, non passato come parametro (specifica 2026-10-15,
 * MTP-DEC-3): con prepare: false un parametro costa un viaggio in più. È sicuro perché il valore
 * è appena stato verificato come intero positivo: nel testo può finire solo un numero. È l'unico
 * punto del progetto dove il tenant entra nel testo SQL.
 */
export function createTenantAccess(database: Database) {
  async function withTenant<T>(
    tenantId: TenantId,
    fn: (tx: TenantTx) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error('invalid tenant id')
    try {
      return await database.transaction(async tx => {
        // Senza parametri e senza attenderne la risposta prima di far partire la funzione. L'ordine
        // non lo garantisce una scrittura immediata sul socket: viene dalle microattività in ordine
        // FIFO, perché set_config e la prima query della funzione percorrono catene di chiamate di
        // pari lunghezza (Drizzle QueryPromise.then -> execute -> Query.handle di postgres.js), e
        // set_config parte per primo perché `then` si chiama qui, subito (le query di Drizzle
        // partono solo allora). Se l'ordine si rompesse, la query della funzione vedrebbe il tenant
        // mancante e fallirebbe con 42501: mai il tenant di un altro, perché l'impostazione vale
        // solo nella transazione e la transazione sopravvive alla funzione (si attendono entrambe,
        // poi si rilancia). Contro un aggiornamento delle librerie che cambi la lunghezza delle
        // catene vigila tenant-concurrency.integration.test.ts (ordine della prima query, in ogni
        // modalità del pooler, per entrambi i rami di esecuzione di Drizzle).
        const tenantSet = tx
          .execute(sql.raw(`select set_config('app.tenant_id', '${tenantId}', true)`))
          .then(() => undefined)
        // L'async trasforma anche un throw sincrono in un rifiuto, così nessuna promessa resta senza gestore.
        const work = (async () => fn(tx as TenantTx))()
        const [tenantOutcome, workOutcome] = await Promise.allSettled([tenantSet, work])
        if (tenantOutcome.status === 'rejected') throw tenantOutcome.reason
        if (workOutcome.status === 'rejected') throw workOutcome.reason
        return workOutcome.value
      }, options)
    } catch (error) {
      // Un 42501 qui è sempre un errore di programmazione, mai di chi usa l'app (§5.2).
      if (isTenantBoundaryError(error)) log.error({ tenantId, err: error }, 'tenant boundary violation')
      throw error
    }
  }

  async function withGlobal<T>(fn: (tx: GlobalTx) => Promise<T>, options?: TransactionOptions): Promise<T> {
    try {
      return await database.transaction(async tx => fn(tx as GlobalTx), options)
    } catch (error) {
      if (isTenantBoundaryError(error)) log.error({ tenantId: null, err: error }, 'tenant table touched without a tenant')
      throw error
    }
  }

  return { withTenant, withGlobal }
}

const access = createTenantAccess(db)
export const withTenant = access.withTenant
export const withGlobal = access.withGlobal
