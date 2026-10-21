import { z } from 'zod'
import { USER_STATUS_ACTIVE, USER_STATUS_DEACTIVATED } from './types'

/**
 * Una server action è un endpoint POST: i suoi argomenti sono il JSON che il chiamante decide di
 * mandare, non i tipi che TypeScript dichiara. Senza questa validazione `updateUserRoles(id, ['1'])`
 * supera i controlli di scalata (`'1' === 1` è falso) e poi il cast `::bigint[]` scrive comunque il
 * ruolo 1. Gli schemi stanno qui perché i file `'use server'` esportano solo endpoint.
 */

const id = z.number().int().nonnegative()
const delta = z.object({ idItem: z.number().int(), authorization: z.boolean() })

export const userIdSchema = z.string().uuid()
export const roleIdsSchema = z.array(id)
export const userStatusSchema = z.union([z.literal(USER_STATUS_ACTIVE), z.literal(USER_STATUS_DEACTIVATED)])
export const roleIdSchema = z.number().int()
export const rolePermissionDeltasSchema = z.object({
  functionalities: z.array(delta),
  operations: z.array(delta),
})

// Maiuscole e spazi non devono creare un secondo account: l'email si normalizza prima di cercarla.
export const emailSchema = z.string().trim().toLowerCase().email().max(254)
