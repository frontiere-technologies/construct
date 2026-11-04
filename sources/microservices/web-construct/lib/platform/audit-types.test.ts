import { expect, expectTypeOf, it } from 'vitest'
import type { TenantTx } from '@/lib/db/tenant-db'
import type { selectTenantPolicy } from '@/lib/tenancy/tenant-policy-service'
import type { lockTenantPolicy } from '@/lib/tenancy/tenant-policy-lock'
import type { PlatformAuditTx } from '@/lib/audit/audit-types'
import type { PlatformTx } from './db'

/**
 * `PlatformAuditTx` (lib/audit) è la forma di `PlatformTx` senza nominare lib/platform/db, che solo
 * lib/platform/** può importare. Se le due forme si separassero, questa assegnazione non compila più.
 */
it('PlatformTx is accepted where the audit module expects a platform transaction', () => {
  const accepts = (tx: PlatformTx): PlatformAuditTx => tx
  const sameShape = (tx: PlatformAuditTx): PlatformTx => tx
  expect(typeof accepts).toBe('function')
  expect(typeof sameShape).toBe('function')
})

/** Il riuso strutturale non allarga la porta di piattaforma fuori da lib/platform/. */
it('policy readers and locks accept exactly tenant or platform transactions', () => {
  expectTypeOf<Parameters<typeof selectTenantPolicy>[0]>().toEqualTypeOf<TenantTx | PlatformTx>()
  expectTypeOf<Parameters<typeof lockTenantPolicy>[0]>().toEqualTypeOf<TenantTx | PlatformTx>()
})
