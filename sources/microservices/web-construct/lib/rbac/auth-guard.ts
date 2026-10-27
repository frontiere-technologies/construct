import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth-session'
import { tenantFromSession } from '@/lib/tenancy/request-tenant'
import { resolveActor, type Actor } from './actor'
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
  return resolveActor(tenantId, userId)
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
 */
async function currentPlatformAdmin(): Promise<PlatformActor | null> {
  const userId = (await getSession())?.user?.id
  if (!userId) return null
  return resolvePlatformAdmin(userId)
}

/**
 * Il controllo delle azioni e delle rotte della console della piattaforma (MT5-DEC-1, MT5-DEC-3):
 * rifiuta come `requirePermission`, e la rotta lo trasforma in 403. Va chiamato prima di aprire
 * qualunque porta della piattaforma (`withPlatform`). Su un indirizzo dedicato rifiuta.
 */
export async function requirePlatformAdmin(): Promise<PlatformActor> {
  const admin = await currentPlatformAdmin()
  if (!admin) throw new Error('Unauthorized')
  return admin
}

/** Per le pagine della console: chi non è ammesso, o è su un indirizzo dedicato, vede un 404. */
export async function requirePlatformAdminPage(): Promise<PlatformActor> {
  const admin = await currentPlatformAdmin()
  if (!admin) notFound()
  return admin
}
