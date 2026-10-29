import { expect, it } from 'vitest'
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
