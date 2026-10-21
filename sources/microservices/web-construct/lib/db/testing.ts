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

/**
 * Solo per i test di integrazione: cancella un tenant creato da un fixture. Toglie le sue righe da
 * ogni tabella di tenant del registro `app_private.table_class` (così una tabella nuova non resta
 * indietro), poi la riga di `tenant`. Rifiuta il predefinito e il modello, che vivono in ogni
 * database di test.
 */
export async function deleteTenantForTest(tenantId: TenantId): Promise<void> {
  await withOwner(async tx => {
    const [target] = await tx.execute<{ slug: string; is_template: boolean }>(
      sql`select slug, is_template from public.tenant where id = ${tenantId}`)
    if (!target) return
    if (target.slug === 'default' || target.is_template) {
      throw new Error(`deleteTenantForTest refuses to delete tenant ${target.slug}`)
    }
    const tables = await tx.execute<{ name: string }>(
      sql`select table_name as name from app_private.table_class where class = 'tenant' order by table_name`)
    // Le chiavi esterne fra tabelle di tenant sono tutte in cascata: l'ordine non conta.
    for (const { name } of tables) {
      await tx.execute(sql`delete from ${sql.identifier('public')}.${sql.identifier(name)} where id_tenant = ${tenantId}`)
    }
    // Gli indirizzi del tenant (0053): tabella globale, fuori dal registro delle tabelle di tenant.
    await tx.execute(sql`delete from public.tenant_host where id_tenant = ${tenantId}`)
    await tx.execute(sql`delete from public.tenant where id = ${tenantId}`)
  }, tenantId)
}

export async function closeOwner(): Promise<void> {
  await owner?.close()
  owner = null
}
