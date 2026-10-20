import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { countRoundTrips, type RecordedStatement } from '@/lib/db/round-trips'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant } from '@/lib/tenancy/testing'

/**
 * I tetti dei viaggi verso il database (specifica 2026-10-15, §3 e MTP-DEC-5). Il client dell'app
 * è sostituito da uno che registra ogni istruzione inviata: le funzioni misurate sono quelle vere,
 * con le loro withTenant/withGlobal. I tetti sono totali (piano, "Deviazione dalla specifica").
 */
const recorded = vi.hoisted(() => [] as { query: string; parameterCount: number }[])

vi.mock('@/lib/db/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db/client')>()
  const { database, close } = actual.createDatabase(process.env.TEST_DATABASE_URL ?? '', {
    max: 1,
    onQuery: (query, parameters) => recorded.push({ query, parameterCount: parameters.length }),
  })
  return { ...actual, db: database, __closeCountingClient: close }
})

async function measure(operation: () => Promise<unknown>) {
  recorded.length = 0
  await operation()
  const count = countRoundTrips(recorded as RecordedStatement[])
  // Un client che non registra darebbe 0 viaggi e ogni tetto passerebbe a vuoto.
  expect(count.statements, 'the counting client recorded nothing: onQuery is not wired').toBeGreaterThan(0)
  return count
}

describeIntegration('round-trip budget', () => {
  // La prima istruzione su una connessione nuova è la lettura dei tipi array di postgres.js (una
  // volta per connessione): fuori dal conto, altrimenti ogni misura ne porterebbe una in più.
  // Il client misurato ha una sola connessione (max: 1): quella scaldata è l'unica che si usa.
  beforeAll(async () => {
    const { withGlobal } = await import('@/lib/db/tenant-db')
    await withGlobal(async () => null)
  }, 30_000)
  beforeEach(() => { recorded.length = 0 })
  afterAll(async () => {
    const client = await import('@/lib/db/client') as unknown as { __closeCountingClient: () => Promise<void> }
    await client.__closeCountingClient()
  })

  it('an empty withTenant costs at most 3 trips (BEGIN, set_config, COMMIT)', async () => {
    const { withTenant } = await import('@/lib/db/tenant-db')
    const count = await measure(() => withTenant(defaultTestTenant(), async () => null))
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(3)
  })
})
