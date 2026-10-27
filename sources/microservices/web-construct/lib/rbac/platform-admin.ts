import { eq } from 'drizzle-orm'
import { isActiveAccount } from '@/lib/auth-policy'
import { users } from '@/lib/db/schema'
import { withGlobal } from '@/lib/db/tenant-db'
import { isDedicatedHost } from '@/lib/tenancy/host-tenants'
import { readRequestHost } from '@/lib/tenancy/request-host'

/** Chi agisce dalla console della piattaforma: la persona, non un tenant (MT5-DEC-1). */
export type PlatformActor = { userId: string; email: string }

/**
 * Decide se la persona può usare la console della piattaforma (MT5-DEC-1, MT5-DEC-3), per le
 * guardie `requirePlatformAdmin*`. Legge l'attributo dal database con la porta normale dell'app
 * (`withGlobal`), mai dal token e mai da `withPlatform`: la guardia stabilisce se la porta della
 * piattaforma si può aprire, quindi non può usarla. Non dipende dallo stato del tenant, ma vale
 * solo sull'indirizzo principale: su un indirizzo dedicato la console non esiste.
 *
 * Un account disattivato non è un amministratore, qualunque cosa dica l'attributo. Una persona
 * senza email non è ammessa: il registro della piattaforma ne ha bisogno per dire chi ha agito.
 */
export async function resolvePlatformAdmin(userId: string): Promise<PlatformActor | null> {
  if (await isDedicatedHost(await readRequestHost())) return null
  const [row] = await withGlobal(tx => tx
    .select({ email: users.email, status: users.idUserStatus, isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1))
  if (!row || !row.isPlatformAdmin || !isActiveAccount(row.status) || !row.email) return null
  return { userId, email: row.email }
}
