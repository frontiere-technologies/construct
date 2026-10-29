import { asc, eq } from 'drizzle-orm'
import { isActiveAccount } from '@/lib/auth-policy'
import { users } from '@/lib/db/schema'
import { withGlobal } from '@/lib/db/tenant-db'
import { requirePlatformAdmin } from '@/lib/rbac/auth-guard'

/** Un amministratore di piattaforma com'è nell'elenco della console (MT5-DEC-1, MT5-DEC-2). */
export type PlatformAdminRow = { id: string; email: string; name: string | null; active: boolean }

/**
 * Gli amministratori di piattaforma, per la pagina della console. L'attributo sta sull'account
 * (globale, leggibile dall'app): nessuna porta della piattaforma serve per leggerlo, e nessun dato
 * di tenant entra qui. Verifica comunque chi chiede, come ogni porta della console. Un account
 * disattivato resta nell'elenco, segnato: non conta come amministratore attivo per la regola
 * dell'ultimo.
 */
export async function listPlatformAdmins(): Promise<PlatformAdminRow[]> {
  await requirePlatformAdmin()
  const rows = await withGlobal(tx => tx
    .select({
      id: users.id, email: users.email, name: users.name, firstName: users.firstName, lastName: users.lastName,
      status: users.idUserStatus,
    })
    .from(users)
    .where(eq(users.isPlatformAdmin, true))
    .orderBy(asc(users.email)))
  return rows.map(row => ({
    id: row.id,
    email: row.email ?? '',
    name: [row.firstName, row.lastName].filter(Boolean).join(' ') || row.name || null,
    active: isActiveAccount(row.status),
  }))
}
