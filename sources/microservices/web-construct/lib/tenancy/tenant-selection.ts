import type { AvailableTenant } from './host-tenants'
import type { TenantId } from './tenant-id'

/**
 * Lo stato del tenant nel token di sessione (specifica 2026-10-21, §3.1): `ready` lavora in un
 * tenant; `choose` deve scegliere fra più tenant dell'indirizzo; `none` non ha tenant sull'indirizzo
 * e vede il messaggio di MT4-DEC-3.
 */
export type TenantState = 'ready' | 'choose' | 'none'

export type TenantSelection = { state: 'ready'; tenantId: TenantId } | { state: 'choose' } | { state: 'none' }

/**
 * La regola di ingresso (MT4-DEC-4, MT4-DEC-7), pura: il tenant del token se è ancora disponibile
 * sull'indirizzo; altrimenti l'unico disponibile; con più tenant l'ultimo usato, se è fra loro;
 * altrimenti la scelta. Nessun disponibile: `none`. `current` e `lastTenantId` sono solo
 * candidati: un tenant entra soltanto se compare in `available`, che viene dal database.
 */
export function selectTenant(input: {
  available: AvailableTenant[]
  lastTenantId: number | null
  current: number | null
}): TenantSelection {
  const { available, lastTenantId, current } = input
  const find = (id: number | null) => (id === null ? undefined : available.find(tenant => tenant.tenantId === id))

  const kept = find(current)
  if (kept) return { state: 'ready', tenantId: kept.tenantId }
  if (available.length === 0) return { state: 'none' }
  if (available.length === 1) return { state: 'ready', tenantId: available[0].tenantId }
  const last = find(lastTenantId)
  if (last) return { state: 'ready', tenantId: last.tenantId }
  return { state: 'choose' }
}
