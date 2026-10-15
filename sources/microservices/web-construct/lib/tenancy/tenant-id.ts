/**
 * Un id di tenant che lo strato dati accetta (specifica 2026-10-13, §3.1–3.2). È un numero
 * "marchiato": solo i moduli di lib/tenancy/ lo costruiscono, e guards/tenant-boundary.test.ts
 * impedisce `as TenantId` e `toTenantId` altrove. Così un numero arrivato dalla richiesta non
 * diventa un tenant senza passare da chi ha verificato da dove viene.
 */
export type TenantId = number & { readonly __brand: 'TenantId' }

/** Lo slug del tenant unico di questo pezzo (MTF-DEC-2). */
export const DEFAULT_TENANT_SLUG = 'default'

export function toTenantId(value: number): TenantId {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('invalid tenant id')
  return value as TenantId
}
