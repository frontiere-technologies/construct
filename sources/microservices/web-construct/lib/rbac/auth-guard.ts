import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { resolveActor, type Actor } from './actor'
import type { PermissionCode } from './permission-catalog'

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
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null
  return resolveActor(userId)
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
