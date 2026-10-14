import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDatabase } from '@/lib/db/client'
import { menuEntry, tenant } from '@/lib/db/schema'
import { createTenantAccess } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'

const A = defaultTestTenant()
let B: TenantId | undefined

// Gira su ogni URL configurato: la modalità sessione c'è sempre, quella transazione (il pooler di
// Supabase) solo dove TEST_DATABASE_POOLED_URL è impostata. In CI (PostgreSQL senza pooler) gira
// solo il primo blocco.
const targets = [
  { mode: 'session', url: process.env.TEST_DATABASE_URL },
  { mode: 'transaction pooler', url: process.env.TEST_DATABASE_POOLED_URL },
].filter((target): target is { mode: string; url: string } => Boolean(target.url))

describeIntegration('tenant isolation under concurrency', () => {
  beforeAll(async () => {
    const slug = `zzz-con-${unique()}`.slice(0, 40)
    const [created] = await withOwner(tx => tx.insert(tenant).values({ slug, name: 'Concurrency B' }).returning({ id: tenant.id }))
    B = tenantIdForTest(created.id)
    await withOwner(tx => tx.insert(menuEntry).values(Array.from({ length: 5 }, (_, i) => ({ name: `B ${i}` }))), B)
  })

  // Pulisce anche quando un caso è fallito a metà. Ogni delete nomina il tenant B: nessuna
  // cancellazione senza filtro, perché non può mai toccare le righe del tenant predefinito.
  afterAll(async () => {
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    if (B !== undefined) {
      const tenantB = B
      await step(() => withOwner(tx => tx.delete(menuEntry).where(eq(menuEntry.idTenant, tenantB)), tenantB))
      await step(() => withOwner(tx => tx.delete(tenant).where(eq(tenant.id, tenantB))))
    }
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  })

  for (const target of targets) {
    it(`never returns a row of the other tenant across 400 interleaved transactions (${target.mode})`, async () => {
      const tenantB = B!
      const { database, close } = createDatabase(target.url, { max: 10 })
      const { withTenant } = createTenantAccess(database)
      try {
        const started = Date.now()
        const runs = Array.from({ length: 400 }, (_, index) => {
          const expected = index % 2 === 0 ? A : tenantB
          return withTenant(expected, async tx => {
            const first = await tx.select({ t: menuEntry.idTenant }).from(menuEntry)
            const second = await tx.select({ t: menuEntry.idTenant }).from(menuEntry)
            return { expected, seen: [...first, ...second].map(row => row.t) }
          })
        })
        const results = await Promise.all(runs)
        process.stdout.write(`[tenant-concurrency] ${target.mode}: 400 transactions in ${Date.now() - started} ms\n`)
        const leaks = results.filter(result => result.seen.some(t => t !== result.expected))
        expect(leaks).toEqual([])
        // Entrambi i tenant hanno righe: senza questo un risultato vuoto passerebbe per isolato.
        expect(results.every(result => result.seen.length > 0)).toBe(true)
      } finally {
        await close()
      }
    }, 60_000)
  }
})
