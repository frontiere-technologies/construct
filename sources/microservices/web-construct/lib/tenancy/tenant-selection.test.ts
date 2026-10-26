import { describe, expect, it } from 'vitest'
import type { AvailableTenant } from './host-tenants'
import { selectTenant } from './tenant-selection'
import { tenantIdForTest } from './testing'

/**
 * La regola di ingresso (specifica 2026-10-21, MT4-DEC-4, MT4-DEC-7, MT4-DEC-16): quale tenant
 * scegliere fra quelli disponibili sull'indirizzo, dati il tenant del token e l'ultimo usato.
 */
function available(...ids: number[]): AvailableTenant[] {
  return ids.map(id => ({ tenantId: tenantIdForTest(id), name: `Tenant ${id}`, isAdmin: false }))
}

describe('selectTenant', () => {
  it('keeps the current tenant when it is still available', () => {
    expect(selectTenant({ available: available(1, 2, 3), lastTenantId: 3, current: 2 }))
      .toEqual({ state: 'ready', tenantId: 2 })
  })

  it('enters the only available tenant', () => {
    expect(selectTenant({ available: available(5), lastTenantId: null, current: null }))
      .toEqual({ state: 'ready', tenantId: 5 })
  })

  it('enters the last used tenant when it is among several available ones', () => {
    expect(selectTenant({ available: available(1, 2, 3), lastTenantId: 3, current: null }))
      .toEqual({ state: 'ready', tenantId: 3 })
  })

  it('asks for a choice with several available tenants and no last used one', () => {
    expect(selectTenant({ available: available(1, 2), lastTenantId: null, current: null }))
      .toEqual({ state: 'choose' })
  })

  it('gives none without available tenants', () => {
    expect(selectTenant({ available: [], lastTenantId: 1, current: 1 })).toEqual({ state: 'none' })
  })

  it('on a recompute (token from another host) falls back to the last used tenant when the current one is not available', () => {
    expect(selectTenant({ available: available(1, 3), lastTenantId: 3, current: 2 }))
      .toEqual({ state: 'ready', tenantId: 3 })
  })

  // MT4-DEC-7: il tenant del token non supera più i controlli sullo stesso indirizzo. Nessun
  // ingresso diretto in un altro tenant: la scelta, o il messaggio.
  it('after a failed revalidation asks for a choice even with a single other tenant available', () => {
    expect(selectTenant({ available: available(4), lastTenantId: null, current: 2, revalidationFailed: true }))
      .toEqual({ state: 'choose' })
  })

  it('after a failed revalidation asks for a choice even when the last used tenant is available', () => {
    expect(selectTenant({ available: available(1, 3), lastTenantId: 3, current: 2, revalidationFailed: true }))
      .toEqual({ state: 'choose' })
  })

  it('after a failed revalidation gives none without available tenants', () => {
    expect(selectTenant({ available: [], lastTenantId: 3, current: 2, revalidationFailed: true }))
      .toEqual({ state: 'none' })
  })

  it('asks for a choice when the last used tenant is not available among several', () => {
    expect(selectTenant({ available: available(1, 2), lastTenantId: 9, current: null }))
      .toEqual({ state: 'choose' })
  })

  it('enters the only available tenant even when the current and last used ones are elsewhere', () => {
    expect(selectTenant({ available: available(4), lastTenantId: 9, current: 8 }))
      .toEqual({ state: 'ready', tenantId: 4 })
  })
})
