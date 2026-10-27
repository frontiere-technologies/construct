import { cache } from 'react'
import { sql } from 'drizzle-orm'
import { isActiveAccount } from '@/lib/auth-policy'
import { withGlobal } from '@/lib/db/tenant-db'
import { normalizeHost, readRequestHost } from '@/lib/tenancy/request-host'

/** Chi agisce dalla console della piattaforma: la persona, non un tenant (MT5-DEC-1). */
export type PlatformActor = { userId: string; email: string }

/**
 * Decide se la persona può usare la console della piattaforma (MT5-DEC-1, MT5-DEC-3), per le
 * guardie `requirePlatformAdmin*`. Legge l'attributo dal database con la porta normale dell'app
 * (`withGlobal`), mai dal token e mai da `withPlatform`: la guardia stabilisce se la porta della
 * piattaforma si può aprire, quindi non può usarla. Non dipende dallo stato del tenant, ma vale
 * solo sull'indirizzo principale: su un indirizzo dedicato la console non esiste.
 *
 * Una sola istruzione per l'attributo e per l'indirizzo (la stessa verifica di `isDedicatedHost`),
 * e una sola lettura per richiesta, come `resolveActor`: una revoca vale dalla richiesta successiva.
 *
 * Un account disattivato non è un amministratore, qualunque cosa dica l'attributo. Una persona
 * senza email non è ammessa: il registro della piattaforma ne ha bisogno per dire chi ha agito.
 */
export const resolvePlatformAdmin = cache(async (userId: string): Promise<PlatformActor | null> => {
  const host = normalizeHost(await readRequestHost())
  const [row] = await withGlobal(tx => tx.execute<{
    email: string | null
    status: number | null
    is_platform_admin: boolean
    dedicated: boolean
  }>(sql`
    select u.email, u.id_user_status::int as status, u.is_platform_admin,
      exists (select 1 from public.tenant_host h where h.host = ${host}::text) as dedicated
    from public.users u
    where u.id = ${userId}::uuid`))
  if (!row || row.dedicated || !row.is_platform_admin || !isActiveAccount(row.status) || !row.email) return null
  return { userId, email: row.email }
})
