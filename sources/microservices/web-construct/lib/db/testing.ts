import { sql } from 'drizzle-orm'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import { createDatabase, type Database } from './client'

type OwnerTx = Parameters<Parameters<Database['transaction']>[0]>[0]

let owner: ReturnType<typeof createDatabase> | null = null

function ownerDatabase(): Database {
  const url = process.env.TEST_MIGRATION_DATABASE_URL
  if (!url) throw new Error('TEST_MIGRATION_DATABASE_URL is required for fixtures written as construct_owner')
  owner ??= createDatabase(url, { max: 1 })
  return owner.database
}

/**
 * Solo per i test di integrazione: scrive come construct_owner, che può modificare i cataloghi
 * globali in sola lettura per l'app (permission, tenant). Con `tenantId` imposta anche il tenant,
 * perché la RLS forzata vale per il proprietario (MTF-DEC-4).
 */
export async function withOwner<T>(fn: (tx: OwnerTx) => Promise<T>, tenantId?: TenantId): Promise<T> {
  return ownerDatabase().transaction(async tx => {
    await tx.execute(sql`set local role construct_owner`)
    if (tenantId !== undefined) {
      await tx.execute(sql`select set_config('app.tenant_id', ${String(tenantId)}, true)`)
    }
    return fn(tx)
  })
}

export async function closeOwner(): Promise<void> {
  await owner?.close()
  owner = null
}
