import { eq } from 'drizzle-orm'
import { tenant } from '@/lib/db/schema'
import { withGlobal } from '@/lib/db/tenant-db'
import { toTenantId, type TenantId } from './tenant-id'

/**
 * Il `TenantId` di un tenant che esiste, per le porte della console (specifica 2026-10-26, MT5-DEC-6):
 * l'id arriva dalla richiesta ed è solo un numero, e diventa un tenant solo se il registro dei
 * tenant lo conosce. Lo chiama chi ha già verificato l'amministratore di piattaforma; non guarda lo
 * stato (un tenant sospeso o archiviato si gestisce dalla console come gli altri). Un id che non
 * esiste lancia.
 */
export async function existingTenantId(raw: number): Promise<TenantId> {
  if (!Number.isSafeInteger(raw) || raw <= 0) throw new Error('invalid tenant id')
  const [row] = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.id, raw)).limit(1))
  if (!row) throw new Error('tenant_not_found')
  return toTenantId(row.id)
}

/**
 * Il `TenantId` di un tenant appena creato dalla transazione della console. L'id viene dalla
 * funzione SQL di creazione che quella stessa transazione ha eseguito, non dalla richiesta: non c'è
 * un registro da consultare prima del commit. Da non usare per un id che arriva da fuori:
 * per quelli c'è `existingTenantId`.
 */
export function createdTenantId(raw: number): TenantId {
  return toTenantId(raw)
}

/**
 * Il `TenantId` del modello (MT5-DEC-21), per chi ne legge il registro dalla console. Il modello è
 * uno solo (indice unico su `is_template`). Lo chiama chi ha già verificato l'amministratore di
 * piattaforma. Se il modello manca lancia, come per un tenant che non esiste.
 */
export async function templateTenantId(): Promise<TenantId> {
  const [row] = await withGlobal(tx => tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.isTemplate, true)).limit(1))
  if (!row) throw new Error('tenant_not_found')
  return toTenantId(row.id)
}
