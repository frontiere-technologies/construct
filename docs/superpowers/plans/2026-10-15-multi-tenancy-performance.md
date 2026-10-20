# Multi-tenancy, prestazioni dopo il pezzo 1 — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** riportare i viaggi verso il database di `/`, `/user-management` e `/functionalities`
entro il 20% di quelli di prima del pezzo 1, senza toccare l'isolamento fra tenant.

**Architecture:** cinque riduzioni mirate dentro l'architettura del pezzo 1. `withTenant` manda
`set_config` senza parametro e senza attenderlo; l'autorizzazione si legge con un'istruzione
sola; la sessione si legge una volta per richiesta; le preferenze dell'utente e la pagina utenti
usano meno transazioni; le letture indipendenti partono insieme. Un test di integrazione conta i
viaggi e fissa un tetto per ogni operazione.

**Tech Stack:** Next.js 16 (App Router), Auth.js v5, Drizzle ORM 0.45 con postgres.js 3.4
(`prepare: false`), PostgreSQL 15+ (sviluppo su Supabase 17.6), Vitest, pytest + Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-15-multi-tenancy-performance-design.md`](../specs/2026-10-15-multi-tenancy-performance-design.md)
(MTP-DEC-1…5, §2 interventi, §3 budget, §4 test). Contesto: la
[specifica del pezzo 1](../specs/2026-10-13-multi-tenancy-foundations-design.md) e il suo
[piano](2026-10-13-multi-tenancy-foundations.md).

## Global Constraints

- **Isolamento invariato** (pezzo 1):
  - `withTenant` e `withGlobal` (`lib/db/tenant-db.ts`) restano le sole porte verso il database;
  - ogni query sta in una transazione; il tenant si imposta con `set_config('app.tenant_id', …, true)` e vale solo nella transazione;
  - `prepare: false` sempre; nessuno stato di sessione;
  - nessuna modifica a migrazioni, policy, ruoli, `boundary-check`.
- **Eccezione MTP-DEC-3:** il numero del tenant si scrive nel testo di `set_config` **solo** dentro `withTenant`, **solo** dopo `Number.isSafeInteger(tenantId) && tenantId > 0`. In nessun altro punto il tenant entra nel testo SQL.
- **Revoca immediata (MTP-DEC-4):** ogni richiesta rilegge l'autorizzazione; `cache()` di React vale solo dentro una richiesta. Nessuna cache fra richieste.
- **Obiettivo (MTP-DEC-1):** percorso critico al massimo 20, 33, 31 viaggi per `/`, `/user-management`, `/functionalities`.
- **Regole di conteggio:** un'istruzione con parametri = 2 viaggi, senza parametri = 1; inizio e fine transazione 1 ciascuno.
- **Database:**
  - il database di sviluppo è già alla 0047; questo piano non ha migrazioni;
  - test di integrazione ed E2E solo sul database di prova usa e getta, mai insieme (condividono il database); E2E solo con la configurazione `web-construct-e2e`;
  - per un E2E lungo il computer resta sveglio (`caffeinate -dims uv run pytest`).
- **Lingua:** commenti e messaggi per l'utente in italiano; commit in inglese, `type(scope): …`, chiusi dal `Co-Authored-By` del modello che scrive il commit.
- **Checkbox:** quando un elemento MTP-x della specifica è finito e verificato, si segna `- [✅]` nella specifica (AGENTS.md).
- **Base dei test unitari:** gli 8 fallimenti già noti in 4 file `components/Sidebar*.test.tsx` (Node 26, `localStorage` sperimentale) non dipendono da questo lavoro; contano solo i fallimenti in più.
- **Deviazione dalla specifica, decisa qui:** i tetti di §3 della specifica sono sul percorso critico, ma il contatore del test vede il **totale** delle istruzioni inviate, non quelle spedite in coda senza attendere. I tetti del test sono quindi quelli di §3 più 1 per ogni `set_config` spedito in coda (e più le letture spedite insieme). Il risparmio sul percorso critico lo verificano il test unitario d'ordine (Task 1) e la misura finale (Task 5).

## Review Focus

1. **La prima query di una `withTenant` parte prima che il tenant sia impostato.** Darebbe 42501 (mai righe di un altro tenant, perché il valore vale solo nella transazione). → test d'ordine sotto concorrenza nelle due modalità del pooler, Task 1.
2. **Un errore di `set_config` o della funzione resta senza gestione** (promessa rifiutata non attesa). Deve arrivare al chiamante, senza avvisi di promesse non gestite. → test unitari, Task 1.
3. **L'istruzione unica dell'autorizzazione sbaglia un caso limite:** utente disattivato, utente inesistente, ruoli di sistema mancanti, utente senza ruoli. → test di integrazione, Task 2.
4. **Una revoca non vale dalla richiesta successiva** perché qualcosa resta in memoria fra richieste. → test di integrazione (due letture con un ruolo tolto in mezzo), Task 2.
5. **Le pagine anonime** (login, registrazione) si rompono o fanno query inutili senza sessione. → test unitari di lingua e aspetto con sessione assente, Task 3.

---

## Mappa dei file

| File | Responsabilità | Task |
|---|---|---|
| `web-construct/lib/db/round-trips.ts` | conteggio puro di istruzioni e viaggi | 1 |
| `web-construct/lib/db/round-trips.test.ts` | test del conteggio | 1 |
| `web-construct/lib/db/client.ts` | opzione `onQuery` per osservare le istruzioni | 1 |
| `web-construct/lib/db/tenant-db.ts` | `set_config` senza parametro e in coda | 1 |
| `web-construct/lib/db/tenant-db.test.ts` | testo, ordine ed errori di `withTenant` | 1 |
| `web-construct/lib/db/round-trip-budget.integration.test.ts` | tetti dei viaggi | 1, 2, 4 |
| `web-construct/lib/db/tenant-concurrency.integration.test.ts` | ordine sotto concorrenza | 1 |
| `web-construct/lib/rbac/auth-roles.ts` | istruzione unica dell'autorizzazione | 2 |
| `web-construct/lib/rbac/actor.ts` | `resolveActor` sull'istruzione unica | 2 |
| `web-construct/lib/rbac/auth-roles.integration.test.ts` | casi limite e revoca | 2 |
| `web-construct/lib/auth-session.ts` | `getSession()` per richiesta | 3 |
| `web-construct/lib/user-preferences.ts` | lingua e aspetto da una sola lettura | 3 |
| `web-construct/guards/session-access.test.ts` | `auth()` solo da `getSession` e dal proxy | 3 |
| `web-construct/lib/rbac/navigation-service.ts`, `functionalities-service.ts`, `grant-service.ts` | letture insieme | 4 |
| `web-construct/lib/rbac/user-management-loader.ts` | dati della pagina utenti in una transazione | 4 |
| `docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md` | eccezione MTP-DEC-3, chiusura MTF-RISK-2/3 | 1, 5 |

`web-construct/` sta per `sources/microservices/web-construct/`.

---

### Task 1: Contatore dei viaggi e `set_config` leggero (MTP §2.3)

**Files:**
- Create: `web-construct/lib/db/round-trips.ts`, `web-construct/lib/db/round-trips.test.ts`
- Create: `web-construct/lib/db/round-trip-budget.integration.test.ts`
- Modify: `web-construct/lib/db/client.ts`, `web-construct/lib/db/tenant-db.ts`, `web-construct/lib/db/tenant-db.test.ts`
- Modify: `web-construct/lib/db/tenant-concurrency.integration.test.ts`
- Modify: `docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md` (§3.1 e vincolo di `set_config`)

**Interfaces:**
- Produces:
  - `countRoundTrips(recorded: readonly RecordedStatement[]): RoundTripCount`, con `RecordedStatement = { query: string; parameterCount: number }` e `RoundTripCount = { statements: number; roundTrips: number; queries: string[] }`;
  - `createDatabase(url, { max?, onQuery? })`, dove `onQuery: (query: string, parameters: readonly unknown[]) => void`;
  - `withTenant` invariata nella firma.

- [✅] **Step 1: Test del conteggio.** Creare `lib/db/round-trips.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { countRoundTrips } from './round-trips'

describe('countRoundTrips', () => {
  it('counts one trip without parameters and two with parameters', () => {
    expect(countRoundTrips([
      { query: 'begin', parameterCount: 0 },
      { query: 'select 1 where x = $1', parameterCount: 1 },
      { query: 'commit', parameterCount: 0 },
    ])).toEqual({ statements: 3, roundTrips: 4, queries: ['begin', 'select 1 where x = $1', 'commit'] })
  })

  it('counts nothing for nothing', () => {
    expect(countRoundTrips([])).toEqual({ statements: 0, roundTrips: 0, queries: [] })
  })
})
```

- [✅] **Step 2: Aggiornare i test di `withTenant`.** In `lib/db/tenant-db.test.ts`:
  - il falso database deve imitare Drizzle: `tx.execute` restituisce un oggetto che parte solo quando qualcuno chiama `then` (come `QueryPromise`), e registra l'ordine degli eventi;
  - sostituire il test "sets the tenant as a transaction-local parameter…" con i tre test qui sotto.

```ts
function lazyDatabase(options: { failSetConfig?: boolean } = {}) {
  const events: string[] = []
  const executed: SQL[] = []
  let setConfigSettled = false
  const tx = {
    execute: (query: SQL) => ({
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        executed.push(query)
        events.push('set_config sent')
        const result = new Promise((resolve, reject) => setTimeout(() => {
          setConfigSettled = true
          if (options.failSetConfig) reject(new Error('set_config failed'))
          else resolve([])
        }, 5))
        return result.then(onFulfilled, onRejected)
      },
    }),
  }
  const database = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Database
  return { database, events, executed, isSetConfigSettled: () => setConfigSettled }
}

describe('withTenant, set_config', () => {
  it('writes the verified tenant into the statement text, without parameters', async () => {
    const { database, executed } = lazyDatabase()
    const { withTenant } = createTenantAccess(database)
    await withTenant(tenantIdForTest(7), async () => 'done')
    const rendered = dialect.sqlToQuery(executed[0])
    expect(rendered.sql).toBe("select set_config('app.tenant_id', '7', true)")
    expect(rendered.params).toEqual([])
  })

  it('sends set_config before the callback starts, without waiting for its answer', async () => {
    const { database, events, isSetConfigSettled } = lazyDatabase()
    const { withTenant } = createTenantAccess(database)
    let settledWhenCallbackStarted: boolean | null = null
    await withTenant(tenantIdForTest(7), async () => {
      events.push('callback started')
      settledWhenCallbackStarted = isSetConfigSettled()
      return null
    })
    expect(events).toEqual(['set_config sent', 'callback started'])
    expect(settledWhenCallbackStarted).toBe(false)
  })

  it('surfaces a set_config failure to the caller', async () => {
    const { database } = lazyDatabase({ failSetConfig: true })
    const { withTenant } = createTenantAccess(database)
    await expect(withTenant(tenantIdForTest(7), async () => 'done')).rejects.toThrow('set_config failed')
  })
})
```

  Il test che rifiuta `[0, -1, 1.5, NaN, Infinity]` resta com'è: nessuna istruzione partita.

- [✅] **Step 3: Verificare che falliscano.**

Run: `cd sources/microservices/web-construct && npx vitest run lib/db/round-trips.test.ts lib/db/tenant-db.test.ts`
Expected: FAIL. `./round-trips` non esiste; il testo atteso contiene `'7'` ma oggi c'è `$1`; l'ordine atteso fallisce perché oggi `set_config` viene atteso prima della funzione.

- [✅] **Step 4: Scrivere `lib/db/round-trips.ts`.**

```ts
/**
 * Conta istruzioni e viaggi verso il database, a partire da ciò che postgres.js invia (specifica
 * 2026-10-15, MTP-DEC-5). Con `prepare: false` un'istruzione con parametri costa due viaggi
 * (descrizione, poi esecuzione), una senza parametri uno. Il conto è il totale inviato: non vede
 * quali istruzioni sono partite in coda senza attendere la precedente.
 */
export interface RecordedStatement {
  query: string
  parameterCount: number
}

export interface RoundTripCount {
  statements: number
  roundTrips: number
  queries: string[]
}

export function countRoundTrips(recorded: readonly RecordedStatement[]): RoundTripCount {
  return {
    statements: recorded.length,
    roundTrips: recorded.reduce((total, statement) => total + (statement.parameterCount > 0 ? 2 : 1), 0),
    queries: recorded.map(statement => statement.query),
  }
}
```

- [✅] **Step 5: `onQuery` in `lib/db/client.ts`.** La firma di `createDatabase` diventa:

```ts
export function createDatabase(
  url: string,
  options: { max?: number; onQuery?: (query: string, parameters: readonly unknown[]) => void } = {},
) {
  const { onQuery } = options
  const client = postgres(url, {
    prepare: false,
    max: options.max ?? 20,
    connect_timeout: 10,
    // Solo i test che contano i viaggi lo passano (round-trip-budget.integration.test.ts).
    debug: onQuery ? (_connection, query, parameters) => onQuery(query, parameters) : false,
  })
  return {
    database: drizzle(client, { schema }) as Database,
    close: () => client.end({ timeout: 5 }),
  }
}
```

  Aggiungere una riga al commento in testa alla funzione su `onQuery`.

- [✅] **Step 6: `set_config` leggero in `lib/db/tenant-db.ts`.** Sostituire il corpo della transazione di `withTenant` e aggiornare il commento di `createTenantAccess`:

```ts
/**
 * Le due sole porte verso il database (specifica 2026-10-13, §3.1, MTF-DEC-6). Il tenant vale
 * fino alla fine della transazione e mai oltre (set_config(..., true)), quindi una connessione
 * restituita al pooler non porta il tenant al cliente successivo.
 *
 * Il numero del tenant è scritto nel testo, non passato come parametro (specifica 2026-10-15,
 * MTP-DEC-3): con prepare: false un parametro costa un viaggio in più. È sicuro perché il valore
 * è appena stato verificato come intero positivo: nel testo può finire solo un numero. È l'unico
 * punto del progetto dove il tenant entra nel testo SQL.
 */
```

```ts
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error('invalid tenant id')
    try {
      return await database.transaction(async tx => {
        // Senza parametri e senza attenderne la risposta: postgres.js lo scrive subito sulla
        // connessione della transazione, prima della prima query della funzione, e Postgres esegue
        // le istruzioni nell'ordine in cui arrivano (MTP §2.3). Le query di Drizzle partono solo
        // quando qualcuno chiama `then`: lo si chiama qui, subito, per spedirlo per primo.
        const tenantSet = tx
          .execute(sql.raw(`select set_config('app.tenant_id', '${tenantId}', true)`))
          .then(() => undefined)
        const [, result] = await Promise.all([tenantSet, fn(tx as TenantTx)])
        return result
      }, options)
    } catch (error) {
```

- [✅] **Step 7: Verificare che i test unitari passino.**

Run: `npx vitest run lib/db/round-trips.test.ts lib/db/tenant-db.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS; lint pulito (la guardia `guards/tenant-boundary.test.ts` permette `app.tenant_id` in `lib/db/`).

- [✅] **Step 8: Test d'ordine sotto concorrenza.** In `lib/db/tenant-concurrency.integration.test.ts`, dentro il blocco che gira per ogni modalità (`targets`), aggiungere:

```ts
    it('sees the tenant in the very first query of every transaction', async () => {
      const { database, close } = createDatabase(target.url, { max: 10 })
      const { withTenant } = createTenantAccess(database)
      try {
        const seen = await Promise.all(Array.from({ length: 200 }, (_, index) => {
          const expected = index % 2 === 0 ? A : B
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
```

  Aggiungere `sql` all'import da `drizzle-orm` se manca.

- [✅] **Step 9: Il file dei tetti, con la prima voce.** Creare `lib/db/round-trip-budget.integration.test.ts`:

```ts
import { afterAll, beforeEach, expect, it, vi } from 'vitest'
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
    max: 2,
    onQuery: (query, parameters) => recorded.push({ query, parameterCount: parameters.length }),
  })
  return { ...actual, db: database, __closeCountingClient: close }
})

async function measure(operation: () => Promise<unknown>) {
  recorded.length = 0
  await operation()
  return countRoundTrips(recorded as RecordedStatement[])
}

describeIntegration('round-trip budget', () => {
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
```

- [✅] **Step 10: Verificare i test di integrazione toccati.**

Run: `npm run test:integration -- lib/db/round-trip-budget.integration.test.ts lib/db/tenant-concurrency.integration.test.ts`
Expected: PASS. Il conto di una `withTenant` vuota è 3 (prima era 4); il test d'ordine non trova nessuna transazione senza tenant nelle due modalità. Riportare nel rapporto i viaggi contati e le query registrate.

  **Se il test d'ordine fallisce** (MTP-RISK-1): non indebolire il test. In `withTenant` tornare ad attendere `tenantSet` prima di chiamare `fn` (il testo senza parametri resta: 1 viaggio invece di 2), e riportare l'esito.

- [✅] **Step 11: Aggiornare la specifica del pezzo 1.** In `docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md`, nel commento di `withTenant` della §3.1, sostituire "con il valore come parametro (mai sql.raw)" con:

```
// apre la transazione e imposta set_config('app.tenant_id', '<n>', true). Il numero è scritto nel
// testo, solo dopo averlo verificato come intero sicuro e positivo (specifica 2026-10-15,
// MTP-DEC-3): con prepare: false un parametro costerebbe un viaggio in più. Rifiuta id non interi
// o non positivi.
```

- [✅] **Step 12: Suite e commit.**

Run: `npm run test && npm run test:integration`
Expected: PASS, a parte la base delle 8 Sidebar.

```bash
git add sources/microservices/web-construct/lib/db docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md
git commit -m "perf(db): set_config goes out without a parameter, ahead of the first query"
```

---

### Task 2: Autorizzazione in un'istruzione sola (MTP §2.2)

**Files:**
- Modify: `web-construct/lib/rbac/auth-roles.ts`, `web-construct/lib/rbac/actor.ts`
- Create: `web-construct/lib/rbac/auth-roles.integration.test.ts`
- Modify: `web-construct/lib/db/round-trip-budget.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 (`withTenant`, file dei tetti, `measure`).
- Produces:
  - `selectUserAuthorization(tx: TenantTx, userId: string, ensureRegisteredRole = false): Promise<{ accountActive: boolean; roleIds: number[]; isAdmin: boolean }>` — firma invariata;
  - `selectAuthorizationSnapshot(tx: TenantTx, userId: string, options?: { permissionCodes?: boolean }): Promise<AuthorizationSnapshot>`, con `AuthorizationSnapshot = { userExists: boolean; status: number | null; roleIds: number[]; system: SystemRoleIds; permissionCodes: string[] }`;
  - `resolveActor(tenantId, userId)` — firma invariata.

- [ ] **Step 1: Casi limite, test che fissa il comportamento.** Creare `lib/rbac/auth-roles.integration.test.ts`. Prepara gli utenti con le funzioni già usate dagli altri test dell'area (`withGlobal` per `users`, `withTenant(defaultTestTenant(), …)` per `user_role`, `withOwner` per un tenant senza ruoli di sistema) e li cancella in `afterAll` (solo le righe create, filtrate per id). Casi, ognuno con `resolveUserAuthorization(defaultTestTenant(), userId)` e `resolveActor(defaultTestTenant(), userId)`:

| Caso | `resolveUserAuthorization` | `resolveActor` |
|---|---|---|
| amministratore attivo (ruoli REGISTERED e TENANT_ADMIN) | `{ accountActive: true, roleIds: [registered, tenantAdmin], isAdmin: true }` | attore con tutti i codici del catalogo |
| utente attivo con un ruolo che concede `read-menu` | `isAdmin: false`, `roleIds` con quel ruolo | `permissions` contiene `read-menu` e nient'altro di non concesso |
| utente attivo senza ruoli | `{ accountActive: true, roleIds: [], isAdmin: false }` | attore con `permissions` vuoto |
| utente disattivato (status 1) con ruolo amministratore | `{ accountActive: false, roleIds: [], isAdmin: false }` | `null` |
| utente inesistente (uuid casuale) | `{ accountActive: false, roleIds: [], isAdmin: false }` | `null` |
| tenant senza ruoli di sistema (tenant di prova creato con `withOwner`) | rifiuta con `system roles missing` | rifiuta con `system roles missing` |
| revoca (Review Focus 4): togliere il ruolo amministratore fra due chiamate | la seconda chiamata dà `isAdmin: false` | la seconda chiamata non ha più i codici |

  Più `ensureRegisteredRole`: per un utente attivo senza ruoli, `resolveUserAuthorization(tenant, id, true)` restituisce `roleIds` con il ruolo REGISTERED e la riga esiste in `user_role`.

- [ ] **Step 2: Tetti nel file dei tetti.** Aggiungere a `round-trip-budget.integration.test.ts` (con utenti di prova creati in `beforeAll` e cancellati in `afterAll`):

```ts
  it('one authorization read (the jwt callback) costs at most 5 trips', async () => {
    const { resolveUserAuthorization } = await import('@/lib/rbac/auth-roles')
    const count = await measure(() => resolveUserAuthorization(defaultTestTenant(), adminUserId))
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(5)
  })

  it.each(['admin', 'reader'] as const)('resolveActor for a %s costs at most 5 trips', async kind => {
    const { resolveActor } = await import('@/lib/rbac/actor')
    const count = await measure(() => resolveActor(defaultTestTenant(), kind === 'admin' ? adminUserId : readerUserId))
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(5)
  })
```

- [ ] **Step 3: Verificare.** I casi limite passano già oggi (fissano il comportamento); i tetti falliscono.

Run: `npm run test:integration -- lib/rbac/auth-roles.integration.test.ts lib/db/round-trip-budget.integration.test.ts`
Expected: casi limite PASS; tetti FAIL con circa 8 viaggi per il callback e 8–10 per `resolveActor`. Riportare i numeri.

- [ ] **Step 4: L'istruzione unica in `lib/rbac/auth-roles.ts`.**

```ts
import { sql } from 'drizzle-orm'
import { withTenant, type TenantTx } from '@/lib/db/tenant-db'
import { userRole } from '@/lib/db/schema'
import { evaluateAuthorization } from '@/lib/auth-policy'
import type { TenantId } from '@/lib/tenancy/tenant-id'
import type { SystemRoleIds } from '@/lib/tenancy/system-roles'

type UserAuthorization = { accountActive: boolean; roleIds: number[]; isAdmin: boolean }

export interface AuthorizationSnapshot {
  userExists: boolean
  status: number | null
  roleIds: number[]
  system: SystemRoleIds
  permissionCodes: string[]
}

type SnapshotRow = {
  registered: string | null
  tenant_admin: string | null
  user_exists: boolean
  status: string | null
  role_ids: string[] | null
  permission_codes: string[] | null
}

/**
 * Tutto ciò che serve per decidere chi è l'utente nel tenant della transazione, in una sola
 * istruzione (specifica 2026-10-15, §2.2): i due ruoli di sistema, lo stato (globale) e i ruoli nel
 * tenant, più, se richiesti, i codici dei permessi di quei ruoli. La RLS limita ruoli e
 * concessioni al tenant corrente. Le colonne bigint arrivano da postgres.js come stringhe.
 */
export async function selectAuthorizationSnapshot(
  tx: TenantTx,
  userId: string,
  options: { permissionCodes?: boolean } = {},
): Promise<AuthorizationSnapshot> {
  const codes = options.permissionCodes
    ? sql`coalesce((
        select array_agg(distinct p.code order by p.code)
        from public.role_permission rp
        join public.permission p on p.id_permission = rp.id_permission
        where rp.id_role in (select ur.id_role from public.user_role ur where ur.user_id = ${userId})
          and p.deprecated_at is null and p.code is not null
      ), '{}')`
    : sql`'{}'::text[]`
  const [row] = await tx.execute<SnapshotRow>(sql`
    select
      (select max(r.id_role) from public.role r where r.system_key = 'REGISTERED')::text as registered,
      (select max(r.id_role) from public.role r where r.system_key = 'TENANT_ADMIN')::text as tenant_admin,
      exists (select 1 from public.users u where u.id = ${userId}) as user_exists,
      (select u.id_user_status from public.users u where u.id = ${userId})::text as status,
      coalesce((select array_agg(ur.id_role order by ur.id_role)::text[] from public.user_role ur where ur.user_id = ${userId}), '{}') as role_ids,
      ${codes} as permission_codes
  `)
  if (row.registered === null || row.tenant_admin === null) throw new Error('system roles missing')
  return {
    userExists: row.user_exists,
    status: row.status === null ? null : Number(row.status),
    roleIds: (row.role_ids ?? []).map(Number),
    system: { registered: Number(row.registered), tenantAdmin: Number(row.tenant_admin) },
    permissionCodes: row.permission_codes ?? [],
  }
}

export async function selectUserAuthorization(
  tx: TenantTx,
  userId: string,
  ensureRegisteredRole = false,
): Promise<UserAuthorization> {
  const snapshot = await selectAuthorizationSnapshot(tx, userId)
  if (!snapshot.userExists) return evaluateAuthorization(null, [], snapshot.system.tenantAdmin)
  let roleIds = snapshot.roleIds
  // Solo all'accesso (callback jwt con ensureRegisteredRole): il ruolo base si aggiunge qui.
  if (ensureRegisteredRole && snapshot.status === 2 && !roleIds.includes(snapshot.system.registered)) {
    await tx.insert(userRole).values({ userId, idRole: snapshot.system.registered }).onConflictDoNothing()
    roleIds = [...roleIds, snapshot.system.registered].sort((a, b) => a - b)
  }
  return evaluateAuthorization(snapshot.status, roleIds, snapshot.system.tenantAdmin)
}
```

  `resolveUserAuthorization` resta com'è.

- [ ] **Step 5: `resolveActor` sull'istruzione unica.** In `lib/rbac/actor.ts`, il corpo diventa:

```ts
export const resolveActor = cache(async (tenantId: TenantId, userId: string): Promise<Actor | null> =>
  withTenant(tenantId, async tx => {
    // Stato, ruoli e codici dei permessi in un'istruzione sola (specifica 2026-10-15, §2.2).
    const snapshot = await selectAuthorizationSnapshot(tx, userId, { permissionCodes: true })
    const authorization = evaluateAuthorization(
      snapshot.userExists ? snapshot.status : null,
      snapshot.userExists ? snapshot.roleIds : [],
      snapshot.system.tenantAdmin,
    )
    return buildActor(userId, tenantId, authorization, snapshot.permissionCodes)
  }))
```

  Aggiornare gli import (via `and`, `eq`, `inArray`, `isNotNull`, `isNull`, `permission`, `rolePermission`, `selectUserAuthorization` se non più usati; aggiungere `selectAuthorizationSnapshot` e `evaluateAuthorization`). Il commento sopra `resolveActor` resta, con "Una lettura per richiesta" che ora è letteralmente un'istruzione. Un permesso deprecato non conta: lo filtra `p.deprecated_at is null`.

- [ ] **Step 6: Verificare.**

Run: `npx tsc --noEmit && npm run lint && npx vitest run lib/rbac && npm run test:integration -- lib/rbac/auth-roles.integration.test.ts lib/db/round-trip-budget.integration.test.ts lib/rbac/actor.integration.test.ts`
Expected: PASS. Tetti: callback ≤ 5, `resolveActor` ≤ 5. Riportare i numeri.

- [ ] **Step 7: Suite e commit.**

Run: `npm run test && npm run test:integration`
Expected: PASS (base delle 8 Sidebar a parte).

```bash
git add sources/microservices/web-construct/lib/rbac sources/microservices/web-construct/lib/db/round-trip-budget.integration.test.ts
git commit -m "perf(rbac): one statement reads who the user is in the tenant"
```

---

### Task 3: Sessione una volta per richiesta e preferenze dell'utente (MTP §2.1, §2.4)

**Files:**
- Create: `web-construct/lib/auth-session.ts`, `web-construct/lib/user-preferences.ts`, `web-construct/guards/session-access.test.ts`
- Modify (da `auth()` a `getSession()`): `lib/i18n/server.ts`, `lib/appearance-server.ts`, `app/(protected)/layout.tsx`, `lib/rbac/auth-guard.ts`, `app/(protected)/profile/page.tsx`, `app/(protected)/embedded/[itemId]/page.tsx`, `app/api/auth/change-password/route.ts`, `app/api/i18n/preferences/language/route.ts`, `lib/profile-actions.ts`, `lib/appearance-actions.ts`, `lib/i18n/audit.ts`, `lib/i18n/user-language-actions.ts`
- Modify: i test unitari che oggi fanno `vi.mock('@/lib/auth', …)` per quei moduli: passano a `vi.mock('@/lib/auth-session', …)`.

**Interfaces:**
- Produces:
  - `getSession(): Promise<Session | null>` = `auth()` memorizzata per richiesta;
  - `getUserPreferences(userId: string): Promise<{ languageCode: string | null; themeMode: string | null; textScale: number | null } | null>`, memorizzata per richiesta, una `withGlobal`.

- [ ] **Step 1: La guardia, che fallisce.** Creare `guards/session-access.test.ts`. Sullo stile di `guards/tenant-boundary.test.ts` (stesse radici sorgente, stesso modo di leggere gli import con il compilatore TypeScript): nessun file fuori da `lib/auth.ts`, `lib/auth-session.ts` e `proxy.ts` importa il simbolo `auth` da `@/lib/auth` (né lo riesporta); i file di test sono esclusi.

```ts
/**
 * La sessione si legge una volta per richiesta (specifica 2026-10-15, §2.1): fuori dal proxy, dove
 * cache() non vale, e da getSession, nessuno chiama auth() direttamente. Ogni chiamata diretta
 * farebbe girare di nuovo il callback jwt, cioè una transazione in più per richiesta.
 */
const ALLOWED = new Set(['lib/auth.ts', 'lib/auth-session.ts', 'proxy.ts'])
```

  Il test raccoglie gli import con nome `auth` da `@/lib/auth` (dichiarazioni `import`, `export … from`) in `app/`, `components/`, `context/`, `lib/` e nei file alla radice (`proxy.ts`), ed elenca i file fuori da `ALLOWED`. Più un test della funzione che legge gli import, su un testo d'esempio, così la guardia non smette di vedere senza dirlo.

Run: `npx vitest run guards/session-access.test.ts`
Expected: FAIL con i 12 file elencati sopra (e nessun altro).

- [ ] **Step 2: `lib/auth-session.ts`.**

```ts
import { cache } from 'react'
import { auth } from '@/lib/auth'

/**
 * La sessione della richiesta, letta una volta sola (specifica 2026-10-15, §2.1, MTP-DEC-4): ogni
 * auth() fa girare il callback jwt, che rilegge l'autorizzazione dal database. cache() di React
 * vale solo dentro una richiesta, quindi una revoca vale dalla richiesta successiva. Fuori dal
 * rendering (route, azioni) non memorizza: lì la sessione si legge comunque una volta.
 */
export const getSession = cache(async () => auth())
```

- [ ] **Step 3: Sostituire `auth()` con `getSession()`** nei 12 file, cambiando solo import e chiamata. Aggiornare i mock dei loro test unitari (`grep -rln "vi.mock('@/lib/auth'" lib app components`): dove il modulo sotto test ora importa `@/lib/auth-session`, il mock segue.

Run: `npx vitest run guards/session-access.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Test delle preferenze, che fallisce.** Creare `lib/user-preferences.test.ts` (unit, con `vi.mock('@/lib/db/tenant-db', …)` il cui `withGlobal` chiama la callback con un finto `tx` che registra la query, come in `language-service.test.ts`):
  - una sola `withGlobal` restituisce `{ languageCode, themeMode, textScale }` per l'utente;
  - utente non trovato: `null`.

  E aggiornare i test esistenti di lingua e aspetto (Review Focus 5):
  - `getAppearance` senza sessione: non chiama `getUserPreferences` e usa il cookie (`anonymousAppearance`), come oggi;
  - `getI18n` senza sessione: nessuna lettura delle preferenze; con sessione e scelta di sessione utilizzabile: il profilo non serve (`profileCode` resta `null`), come oggi.

Run: `npx vitest run lib/user-preferences.test.ts lib/appearance.test.ts lib/i18n`
Expected: FAIL (`./user-preferences` non esiste).

- [ ] **Step 5: `lib/user-preferences.ts`.**

```ts
import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { withGlobal } from '@/lib/db/tenant-db'
import { appLanguage, users } from '@/lib/db/schema'

export interface UserPreferences {
  languageCode: string | null
  themeMode: string | null
  textScale: number | null
}

/**
 * Lingua del profilo e aspetto vengono dalla stessa riga di `users`: una lettura per richiesta
 * invece di due transazioni (specifica 2026-10-15, §2.4). Chi la usa gestisce l'errore come prima.
 */
export const getUserPreferences = cache(async (userId: string): Promise<UserPreferences | null> => {
  const [row] = await withGlobal(tx => tx
    .select({ languageCode: appLanguage.code, themeMode: users.themeMode, textScale: users.textScale })
    .from(users)
    .leftJoin(appLanguage, eq(appLanguage.idLanguage, users.idLanguage))
    .where(eq(users.id, userId))
    .limit(1))
  return row ?? null
})
```

  Se i tipi di `themeMode` e `textScale` nello schema sono diversi da quelli qui sopra, usare quelli dello schema (`toAppearance` deve continuare a ricevere quello che riceve oggi).

- [ ] **Step 6: Usarla in lingua e aspetto.**
  - `lib/appearance-server.ts`: `const session = await getSession()`; con un utente, `const row = await getUserPreferences(userId)` dentro il `try` di oggi, e `if (row) return toAppearance({ themeMode: row.themeMode, textScale: row.textScale })`. Il messaggio di log resta.
  - `lib/i18n/server.ts`: `profileLanguageCode()` usa `getSession()` e `getUserPreferences(userId)`, restituisce `row?.languageCode ?? null`, con lo stesso `try/catch` e lo stesso log. In `getI18n` la lettura delle lingue e la sessione partono insieme:

```ts
  const [cookieStore, headerList, languages] = await Promise.all([
    cookies(), headers(), listLanguages(),
    // In parallelo: l'aspetto la legge comunque, e getSession() è memorizzata per richiesta.
    getSession(),
  ])
```

    Il resto di `getI18n` non cambia: `profileLanguageCode()` resta chiamata solo se la scelta di sessione non è utilizzabile, e a quel punto sessione e preferenze sono già in memoria.

Run: `npx vitest run lib/user-preferences.test.ts lib/appearance.test.ts lib/i18n && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 7: Suite, browser e commit.**

Run: `npm run test && npm run test:integration`
Expected: PASS (base delle 8 Sidebar a parte).

  Nel browser con `web-construct-e2e` (database di prova): `/login` da disconnessi mostra lingua e tema; dopo l'accesso, cambio di aspetto dal profilo e cambio di lingua funzionano come prima; nessun errore nel log del server.

```bash
git add sources/microservices/web-construct
git commit -m "perf(auth): the session is read once per request, user preferences in one query"
```

---

### Task 4: Menu, albero e pagina utenti con meno attese (MTP §2.4, §2.5)

**Files:**
- Modify: `web-construct/lib/rbac/navigation-service.ts` (`getSidebarMenu`), `web-construct/lib/rbac/functionalities-service.ts` (`loadNavAndTags`), `web-construct/lib/rbac/grant-service.ts` (`grantsForRoles`, `assignableRoleIds`), `web-construct/lib/rbac/roles-service.ts` (nuova `selectAllRoles(tx)`)
- Create: `web-construct/lib/rbac/user-management-loader.ts`
- Modify: `web-construct/app/(protected)/(admin)/user-management/page.tsx`
- Modify: `web-construct/lib/db/round-trip-budget.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 (`measure`), Task 2 (attore).
- Produces:
  - `selectAllRoles(tx: TenantTx, roleTypes?: RoleType[]): Promise<{ id: number; description: string }[]>`; `getAllRoles(tenantId, roleTypes?)` diventa `withTenant(tenantId, tx => selectAllRoles(tx, roleTypes))` con lo stesso `cache()` e la stessa gestione d'errore;
  - `loadUserManagementPage(actor: Actor): Promise<{ allRoles: { id: number; name: string }[]; assignable: number[]; registeredRoleId: number }>`.

- [ ] **Step 1: Tetti, che falliscono.** Aggiungere a `round-trip-budget.integration.test.ts`:

```ts
  it('the sidebar menu costs at most 6 trips', async () => {
    const { getSidebarMenu } = await import('@/lib/rbac/navigation-service')
    const count = await measure(() => getSidebarMenu(defaultTestTenant(), [adminRoleId], 'it', 'it'))
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(6)
  })

  it('the functionalities tree costs at most 5 trips', async () => {
    const { getNavigationSubtree } = await import('@/lib/rbac/functionalities-service')
    const count = await measure(() => getNavigationSubtree(defaultTestTenant()))
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(5)
  })

  it('the user management page data costs at most 11 trips for an administrator', async () => {
    const { resolveActor } = await import('@/lib/rbac/actor')
    const { loadUserManagementPage } = await import('@/lib/rbac/user-management-loader')
    const actor = await resolveActor(defaultTestTenant(), adminUserId)
    const count = await measure(() => loadUserManagementPage(actor!))
    expect(count.roundTrips, count.queries.join('\n')).toBeLessThanOrEqual(11)
  })
```

  `adminRoleId` è il ruolo TENANT_ADMIN del tenant predefinito (da `getSystemRoleIds`, letto in `beforeAll`).

Run: `npm run test:integration -- lib/db/round-trip-budget.integration.test.ts`
Expected: FAIL. `user-management-loader` non esiste; il menu e l'albero passano già dal Task 1 o vanno sopra di poco. Riportare i numeri.

- [ ] **Step 2: Letture insieme.**
  - `getSidebarMenu`: le due letture partono insieme.

```ts
): Promise<MenuItem[]> => withTenant(tenantId, async tx => {
  // Insieme: postgres.js le mette in coda sulla stessa connessione (specifica 2026-10-15, §2.5).
  const [entryRows, grantRows] = await Promise.all([
    tx.select().from(menuEntry).orderBy(asc(menuEntry.orderPosition)),
    roleIds.length
      ? tx.select({ id_role: roleFunctionality.idRole, id_menu_entry: roleFunctionality.idMenuEntry })
        .from(roleFunctionality)
        .where(inArray(roleFunctionality.idRole, roleIds))
      : Promise.resolve([]),
  ])
```

  - `loadNavAndTags`: `const [navRows, tagRows] = await Promise.all([...])` con le stesse due query.
  - `grantsForRoles`: `const [codes, functionalities] = await Promise.all([...])` con le stesse due query.
  - `assignableRoleIds`: `const [visible, grants, { tenantAdmin }] = await Promise.all([functionalityIdsForRoles(tx, actor.roleIds), grantsForRoles(tx, roleIds), getSystemRoleIds(tx)])`.
  - Sostituire i commenti MTF-RISK-3 ("vanno in serie") con il commento della §2.5.

- [ ] **Step 3: La pagina utenti in una transazione.** In `lib/rbac/roles-service.ts` estrarre `selectAllRoles(tx, roleTypes?)` dal corpo di `getAllRoles` (stessa query, stesso mapping) e far chiamare `getAllRoles` attraverso di lei. Creare `lib/rbac/user-management-loader.ts`:

```ts
import { withTenant } from '@/lib/db/tenant-db'
import { getSystemRoleIds } from '@/lib/tenancy/system-roles'
import { hasPermission, type Actor } from './actor'
import { assignableRoleIds } from './grant-service'
import { selectAllRoles } from './roles-service'

/**
 * I dati della pagina Utenti in una transazione sola (specifica 2026-10-15, §2.4): l'elenco dei
 * ruoli, quelli che l'attore può assegnare (DEC-29, DEC-32) e il ruolo base del tenant, che il
 * client non conosce (MTF-DEC-5).
 */
export async function loadUserManagementPage(actor: Actor) {
  return withTenant(actor.tenantId, async tx => {
    const roles = await selectAllRoles(tx)
    const allRoles = roles.map(r => ({ id: r.id, name: r.description }))
    const canAssignRoles = hasPermission(actor, 'assign-user-roles')
    const [assignable, system] = await Promise.all([
      canAssignRoles ? assignableRoleIds(tx, actor, allRoles.map(r => r.id)) : Promise.resolve([]),
      getSystemRoleIds(tx),
    ])
    return { allRoles, assignable, registeredRoleId: system.registered }
  })
}
```

  In `app/(protected)/(admin)/user-management/page.tsx` sostituire `getAllRoles`, la `withTenant` e il calcolo di `registeredRoleId` con `const { allRoles, assignable, registeredRoleId } = await loadUserManagementPage(actor)`. Il resto della pagina e le props di `UsersTableClient` non cambiano.

- [ ] **Step 4: Verificare.**

Run: `npx tsc --noEmit && npm run lint && npx vitest run lib/rbac && npm run test:integration -- lib/db/round-trip-budget.integration.test.ts lib/rbac`
Expected: PASS, con i tetti rispettati. Riportare i numeri finali di tutte le voci del file dei tetti.

- [ ] **Step 5: Suite, browser e commit.**

Run: `npm run test && npm run test:integration`
Expected: PASS (base delle 8 Sidebar a parte).

  Nel browser con `web-construct-e2e`: menu laterale completo, pagina Utenti con "Gestisci ruoli" (ruolo base bloccato), pagina Funzionalità con l'albero; nessun errore nel log.

```bash
git add sources/microservices/web-construct
git commit -m "perf(rbac): menu, tree and user management read together, in fewer transactions"
```

---

### Task 5: Verifica finale e misura (MTP-OK-1…4)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-multi-tenancy-performance-design.md` (checkbox, numeri)
- Modify: `docs/superpowers/specs/2026-10-13-multi-tenancy-foundations-design.md` (MTF-RISK-2, MTF-RISK-3)

- [ ] **Step 1: Tutte le porte di qualità.**

Run: `cd sources/microservices/web-construct && npm run lint && npm run test && npm run test:integration && npm run build && npm run test:migrations && npm run test:env-contract && npm run test:i18n-keys && npm run test:docs-contract && npm run test:collection && node ../../devops/db/db.mjs schema-check`
Expected: PASS (base delle 8 Sidebar a parte). `boundary-check` sul database di prova: tutto `ok`.

- [ ] **Step 2: E2E completo**, a integrazione ferma, con il computer sveglio.

Run: `caffeinate -dims uv run pytest` (dalla radice del repository, con il server `web-construct-e2e` avviato)
Expected: 144 passati.

- [ ] **Step 3: Percorso critico stimato.** Con i numeri del file dei tetti, ricalcolare il percorso critico delle tre pagine come nella §3 della specifica e scriverlo nella specifica: deve restare entro 20, 33, 31 (MTP-OK-1).

- [ ] **Step 4: Misura sul database di sviluppo** (MTP-OK-2), stesso metodo del 2026-10-15:
  - server `web-construct` sulla porta 3000 (il ritorno da Google è su `localhost:3000`), sessione da amministratore nel riquadro del browser (il proprietario entra se serve);
  - per `/`, `/user-management`, `/functionalities`: 2 caricamenti di riscaldamento, 10 misurati con `fetch` del corpo completo, mediana;
  - confronto con 690, 798, 702 ms: obiettivo entro circa 830, 960, 840 ms.

  Se un valore resta sopra, riportarlo al proprietario con i numeri prima di proporre altro.

- [ ] **Step 5: Specifiche e commit.**
  - Nella specifica delle prestazioni: segnare MTP-OK-1…4 e MTP-RISK-1…4 verificati, con i numeri.
  - Nella specifica del pezzo 1: MTF-RISK-2 e MTF-RISK-3 con le misure finali, segnati se dentro l'obiettivo.

```bash
git add docs/superpowers/specs
git commit -m "docs(multi-tenancy): performance after piece 1 measured and closed"
```
