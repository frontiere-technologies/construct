import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createDatabase } from '@/lib/db/client'
import { menuEntry, tenant } from '@/lib/db/schema'
import { createTenantAccess, type TenantTx } from '@/lib/db/tenant-db'
import { closeOwner, withOwner } from '@/lib/db/testing'
import { describeIntegration, unique } from '@/lib/i18n/test-support/db-fixtures'
import { defaultTestTenant, tenantIdForTest } from '@/lib/tenancy/testing'
import type { TenantId } from '@/lib/tenancy/tenant-id'

// A è il tenant predefinito e qui si legge soltanto: non vi si scrive mai. Le scritture vanno
// su B e C, due tenant usa e getta creati da questo file.
const A = defaultTestTenant()
let B: TenantId | undefined
let C: TenantId | undefined
const RUN = unique()
const WRITE_PREFIX = `zzz-con-w-${RUN}-`

// Gira su ogni URL configurato: la modalità sessione c'è sempre, quella transazione (il pooler di
// Supabase) solo dove TEST_DATABASE_POOLED_URL è impostata. In CI (PostgreSQL senza pooler) gira
// solo il primo blocco.
const targets = [
  { mode: 'session', url: process.env.TEST_DATABASE_URL },
  { mode: 'transaction pooler', url: process.env.TEST_DATABASE_POOLED_URL },
].filter((target): target is { mode: string; url: string } => Boolean(target.url))

interface Outcome {
  expected: TenantId
  seen: number[]
  /** Il tenant che il database ha scritto sulla riga inserita, se la transazione ha scritto. */
  inserted?: number
  /** La transazione che ha scritto rilegge la propria riga. */
  sawOwnRow?: boolean
}

type Rows = Array<{ id: number; t: number }>

/** Le due letture della transazione: in sequenza, o insieme sulla stessa connessione (pipelining). */
async function readTwice(tx: TenantTx, parallel: boolean): Promise<Rows> {
  const read = (): Promise<Rows> => tx.select({ id: menuEntry.idMenuEntry, t: menuEntry.idTenant }).from(menuEntry)
  if (parallel) {
    const [first, second] = await Promise.all([read(), read()])
    return [...first, ...second]
  }
  const first = await read()
  const second = await read()
  return [...first, ...second]
}

/** Solo letture. */
async function readOnly(tx: TenantTx, expected: TenantId, parallel: boolean): Promise<Outcome> {
  const rows = await readTwice(tx, parallel)
  return { expected, seen: rows.map(row => row.t) }
}

/** Scrive una riga senza nominare il tenant (lo dà il contesto) e poi legge nella stessa transazione. */
async function writeThenRead(tx: TenantTx, expected: TenantId, parallel: boolean, index: number): Promise<Outcome> {
  const [row] = await tx.insert(menuEntry).values({ name: `${WRITE_PREFIX}${index}` })
    .returning({ id: menuEntry.idMenuEntry, t: menuEntry.idTenant })
  const rows = await readTwice(tx, parallel)
  return { expected, seen: rows.map(entry => entry.t), inserted: row.t, sawOwnRow: rows.some(entry => entry.id === row.id) }
}

describeIntegration('tenant isolation under concurrency', () => {
  beforeAll(async () => {
    // Senza URL il ciclo qui sotto non genererebbe nessun caso e la suite passerebbe a vuoto.
    if (targets.length === 0) throw new Error('no database URL configured: TEST_DATABASE_URL is required')
    const [createdB, createdC] = await withOwner(async tx => [
      (await tx.insert(tenant).values({ slug: `zzz-con-b-${RUN}`.slice(0, 40), name: 'Concurrency B' }).returning({ id: tenant.id }))[0],
      (await tx.insert(tenant).values({ slug: `zzz-con-c-${RUN}`.slice(0, 40), name: 'Concurrency C' }).returning({ id: tenant.id }))[0],
    ])
    B = tenantIdForTest(createdB.id)
    C = tenantIdForTest(createdC.id)
    const seed = Array.from({ length: 5 }, (_, i) => ({ name: `${WRITE_PREFIX}seed ${i}` }))
    await withOwner(tx => tx.insert(menuEntry).values(seed), B)
    await withOwner(tx => tx.insert(menuEntry).values(seed), C)
  })

  // Pulisce anche quando un caso è fallito a metà. Ogni passo è indipendente e ogni delete nomina
  // il suo tenant (B o C): nessuna cancellazione senza filtro, quindi mai le righe di A.
  afterAll(async () => {
    const errors: unknown[] = []
    const step = async (fn: () => Promise<unknown>) => { try { await fn() } catch (error) { errors.push(error) } }
    for (const created of [B, C]) {
      if (created === undefined) continue
      await step(() => withOwner(tx => tx.delete(menuEntry).where(eq(menuEntry.idTenant, created)), created))
      await step(() => withOwner(tx => tx.delete(tenant).where(eq(tenant.id, created))))
    }
    await step(() => closeOwner())
    if (errors.length > 0) throw errors[0]
  })

  for (const target of targets) {
    it(`never mixes tenants across 400 interleaved reads and writes (${target.mode})`, async () => {
      const tenantB = B!
      const tenantC = C!
      const { database, close } = createDatabase(target.url, { max: 10 })
      const { withTenant } = createTenantAccess(database)
      try {
        const started = Date.now()
        // Sei forme di transazione alternate: A solo legge, B e C scrivono e rileggono, con le due
        // letture in sequenza o insieme (pipelining). Le scritture non toccano mai A.
        const runs = Array.from({ length: 400 }, (_, index): Promise<Outcome> => {
          switch (index % 6) {
            case 0: return withTenant(A, tx => readOnly(tx, A, false))
            case 1: return withTenant(tenantB, tx => writeThenRead(tx, tenantB, false, index))
            case 2: return withTenant(tenantC, tx => writeThenRead(tx, tenantC, true, index))
            case 3: return withTenant(A, tx => readOnly(tx, A, true))
            case 4: return withTenant(tenantB, tx => writeThenRead(tx, tenantB, true, index))
            default: return withTenant(tenantC, tx => writeThenRead(tx, tenantC, false, index))
          }
        })
        const results = await Promise.all(runs)
        process.stdout.write(`[tenant-concurrency] ${target.mode}: 400 transactions in ${Date.now() - started} ms\n`)
        const writers = results.filter(result => result.inserted !== undefined)
        expect(writers.length).toBeGreaterThan(200)
        expect(results.filter(result => result.seen.some(t => t !== result.expected))).toEqual([])
        // La riga scritta porta il tenant del contesto: né quello di una transazione vicina né nessun altro.
        expect(writers.filter(result => result.inserted !== result.expected)).toEqual([])
        expect(writers.filter(result => !result.sawOwnRow)).toEqual([])
        // Entrambi i tenant hanno righe: senza questo un risultato vuoto passerebbe per isolato.
        expect(results.every(result => result.seen.length > 0)).toBe(true)
      } finally {
        await close()
      }
    }, 60_000)

    // set_config parte in coda senza attenderne la risposta (MTP §2.3): la primissima query della
    // funzione deve comunque vedere già il tenant, su ogni modalità del pooler.
    it(`sees the tenant in the very first query of every transaction (${target.mode})`, async () => {
      const tenantB = B!
      const { database, close } = createDatabase(target.url, { max: 10 })
      const { withTenant } = createTenantAccess(database)
      try {
        const seen = await Promise.all(Array.from({ length: 200 }, (_, index) => {
          const expected = index % 2 === 0 ? A : tenantB
          return withTenant(expected, async tx => {
            const [row] = await tx.execute<{ tenant: string }>(sql`select current_setting('app.tenant_id', true) as tenant`)
            return { expected, tenant: row.tenant }
          })
        }))
        expect(seen.filter(item => item.tenant !== String(item.expected))).toEqual([])
      } finally {
        await close()
      }
    }, 60_000)
  }
})
