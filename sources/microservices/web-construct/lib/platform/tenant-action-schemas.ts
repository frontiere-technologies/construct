import { z } from 'zod'
import { emailSchema } from '@/lib/rbac/action-input-schemas'
import { TENANT_STATUSES } from './tenants-grid-query'

/**
 * Gli argomenti delle azioni della console sui tenant (specifica 2026-10-26, MT5-DEC-5…9). Una
 * server action è un endpoint POST: gli argomenti sono quelli che il chiamante manda, non quelli che
 * TypeScript dichiara. Stanno qui perché un file `'use server'` esporta solo azioni.
 */
export const tenantIdArgSchema = z.number().int().positive()
export const tenantStatusSchema = z.enum(TENANT_STATUSES)
/** Lo stesso vincolo dello slug nel database (0046). */
export const slugSchema = z.string().regex(/^[a-z0-9-]{3,40}$/)
export const tenantNameSchema = z.string().trim().min(1).max(120)
/** Il motivo scritto di un cambio di stato: finisce nel registro, quindi ha un tetto. */
export const reasonSchema = z.string().trim().max(500)
/** L'indirizzo come lo scrive la persona: la normalizzazione la fa `normalizeHost`. */
export const hostInputSchema = z.string().min(1).max(300)

export const createTenantInputSchema = z.object({
  name: tenantNameSchema,
  slug: slugSchema,
  host: hostInputSchema.optional(),
  adminEmail: emailSchema,
})
