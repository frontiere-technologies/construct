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

function isTenantBoundaryError(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code
    ?? (error as { cause?: { code?: string } })?.cause?.code
  return code === '42501'
}

/**
 * Le due sole porte verso il database (specifica 2026-10-13, §3.1, MTF-DEC-6). Il tenant entra
 * come parametro con set_config(..., true): vale fino alla fine della transazione e mai oltre,
 * quindi una connessione restituita al pooler non porta il tenant al cliente successivo.
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
        await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`)
        return fn(tx as TenantTx)
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
