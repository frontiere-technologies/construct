import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth-session'
import { isSupportSession, tenantFromSession } from '@/lib/tenancy/request-tenant'
import { resolveActor, resolveSupportActor, type Actor } from './actor'
import type { PermissionCode } from './permission-catalog'
import { resolvePlatformAdmin, type PlatformActor } from './platform-admin'

export type { PlatformActor }

/**
 * Il punto di controllo (specifica 2026-09-01, §6.2). Ogni azione server, rotta API e pagina
 * protetta chiama una di queste funzioni come prima istruzione, oppure un'esenzione di
 * `access-declarations.ts`: lo impone `guards/permission-declared.test.ts`.
 *
 * Due varianti per due chiamanti: un'azione o una rotta deve rifiutare (lancia, e la rotta lo
 * trasforma in 403); una pagina deve portare altrove (`redirect`, che in Next lancia a sua volta).
 * Il messaggio `'Unauthorized'` è quello che `theme-actions.ts` confronta: non cambiarlo.
 */

async function currentActor(): Promise<Actor | null> {
  const session = await getSession()
  const userId = session?.user?.id
  if (!session || !userId) return null
  // Senza un tenant scelto (stato 'choose' o 'none') nessuna autorità: rifiuto, non un errore 500.
  // Il tenant si legge dalla sessione già letta: una seconda auth() in una rotta rifarebbe la lettura.
  const tenantId = tenantFromSession(session)
  if (tenantId === null) return null
  // In assistenza (pezzo 5a, §3.2) la persona non è membro del tenant: l'attore lo dà il permesso, riletto.
  return isSupportSession(session) ? resolveSupportActor(tenantId, userId) : resolveActor(tenantId, userId)
}

export async function requirePermission(code: PermissionCode): Promise<Actor> {
  const actor = await currentActor()
  if (!actor || !actor.permissions.has(code)) throw new Error('Unauthorized')
  return actor
}

export async function requirePagePermission(code: PermissionCode): Promise<Actor> {
  const actor = await currentActor()
  if (!actor || !actor.permissions.has(code)) redirect('/')
  return actor
}

/** Solo per ciò che non ha un codice nel catalogo: oggi il tema dell'app (DEC-23). */
export async function requireAdministrator(): Promise<Actor> {
  const actor = await currentActor()
  if (!actor || !actor.isAdmin) throw new Error('Unauthorized')
  return actor
}

export async function requireAdministratorPage(): Promise<Actor> {
  const actor = await currentActor()
  if (!actor || !actor.isAdmin) redirect('/')
  return actor
}

/**
 * La sessione di chi chiede la console. Il tenant non conta (la console funziona in ogni stato:
 * `ready`, `choose`, `none`) e il flag della sessione nemmeno: l'attributo si rilegge dal database.
 *
 * Con una sessione in assistenza la console è chiusa (pezzo 5a, controllore, fix 1 del Task 10): in
 * assistenza ogni modifica deve finire nel registro del tenant assistito, e le azioni della
 * console (cataloghi globali, stati dei tenant) non ci passano. Lo stato si legge dalla sessione di
 * questa richiesta, cioè dal token appena rivalidato dal server, mai da un dato del client. Solo
 * l'uscita (`requireSupportExit`) la vuole in assistenza.
 */
async function currentPlatformAdmin(inSupport: boolean): Promise<PlatformActor | null> {
  const session = await getSession()
  const userId = session?.user?.id
  if (!session || !userId) return null
  if (isSupportSession(session) !== inSupport) return null
  return resolvePlatformAdmin(userId)
}

/**
 * Il controllo delle azioni e delle rotte della console della piattaforma (MT5-DEC-1, MT5-DEC-3):
 * rifiuta come `requirePermission`, e la rotta lo trasforma in 403. Va chiamato prima di aprire
 * qualunque porta della piattaforma (`withPlatform`). Su un indirizzo dedicato rifiuta.
 */
export async function requirePlatformAdmin(): Promise<PlatformActor> {
  const admin = await currentPlatformAdmin(false)
  if (!admin) throw new Error('Unauthorized')
  return admin
}

/**
 * Il controllo dell'uscita dall'assistenza, che è l'unica porta della console che la vuole: la
 * persona è amministratore di piattaforma (riletto dal database, indirizzo principale) **e** la
 * sessione è in assistenza. Fuori dall'assistenza rifiuta, come ogni altra porta rifiuta dentro.
 */
export async function requireSupportExit(): Promise<PlatformActor> {
  const admin = await currentPlatformAdmin(true)
  if (!admin) throw new Error('Unauthorized')
  return admin
}

/** Per le pagine della console: chi non è ammesso, o è su un indirizzo dedicato, vede un 404. */
export async function requirePlatformAdminPage(): Promise<PlatformActor> {
  const admin = await currentPlatformAdmin(false)
  if (!admin) notFound()
  return admin
}
