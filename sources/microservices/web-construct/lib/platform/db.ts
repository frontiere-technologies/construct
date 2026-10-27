import { closePlatformDatabase, enterTenantInPlatformTransaction, platformTransaction, type PlatformTransaction } from '@/lib/db/platform-database'
import type { TenantId } from '@/lib/tenancy/tenant-id'

/** Una transazione dell'identità di piattaforma, già passata a construct_owner. */
export type PlatformTx = PlatformTransaction & { readonly __txBrand: 'PlatformTx' }

/**
 * L'unica porta verso l'identità di piattaforma (specifica 2026-10-26, §2.2, MT5-RISK-1).
 *
 * Apre una transazione con il login dedicato `construct_platform` e passa subito a construct_owner
 * (`set local role`, in lib/db/platform-database.ts): così può scrivere `tenant`, `tenant_host` e
 * creare tenant dal modello, e il trigger su `users.is_platform_admin` lo lascia passare. Con
 * `tenantId` imposta anche il tenant della transazione, perché la RLS forzata vale per il
 * proprietario; senza, solo le tabelle globali.
 *
 * Chi chiama ha già verificato che la persona è amministratore di piattaforma: questa funzione non
 * lo sa e non lo controlla. Per questo la importa solo lib/platform/** (guards/platform-boundary.test.ts)
 * e ogni porta della console controlla l'attributo prima di aprire la transazione.
 *
 * Senza `PLATFORM_DATABASE_URL` fallisce con un errore chiaro alla prima chiamata: l'app parte
 * lo stesso, e solo le porte della console ne hanno bisogno.
 */
export function withPlatform<T>(fn: (tx: PlatformTx) => Promise<T>, tenantId?: TenantId): Promise<T> {
  return platformTransaction(tx => fn(tx as PlatformTx), tenantId)
}

/**
 * Passa al tenant indicato dentro la transazione di piattaforma già aperta: per la creazione di un
 * tenant, che nasce nella transazione e vi scrive subito la voce del suo registro. Per un tenant che
 * esiste già si apre `withPlatform(fn, tenantId)`. Un intero positivo, o fallisce.
 */
export function enterTenant(tx: PlatformTx, tenantId: number): Promise<void> {
  return enterTenantInPlatformTransaction(tx, tenantId)
}

/** Solo per i test di integrazione: chiude il pool dell'identità di piattaforma. */
export function closePlatform(): Promise<void> {
  return closePlatformDatabase()
}
