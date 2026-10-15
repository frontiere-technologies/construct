import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { resolveDatabaseUrl } from '@/lib/test-database'
import * as schema from './schema'

export type Database = PostgresJsDatabase<typeof schema>

/**
 * L'unico punto che costruisce un client. Fuori da lib/db/ nessuno importa questo modulo
 * (ESLint e guards/tenant-boundary.test.ts): si passa da withTenant o withGlobal.
 *
 * prepare: false resta sempre, anche in modalità sessione: funziona con entrambe le modalità del
 * pooler (il pooler Supavisor in modalità transazione non supporta i prepared statement sulla
 * connessione condivisa), e la modalità la decide l'URL (MTF-DEC-7).
 * max/connect_timeout sono alzati/abbassati rispetto ai default di postgres.js (10 / 30s): il pool
 * di default si saturava sotto carico concorrente e bloccava le nuove connessioni per i 30s di
 * default invece di fallire subito. Un pool più largo assorbe la stessa concorrenza senza coda, e
 * un timeout più corto fa emergere subito un esaurimento vero.
 */
export function createDatabase(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { prepare: false, max: options.max ?? 20, connect_timeout: 10 })
  return {
    database: drizzle(client, { schema }) as Database,
    close: () => client.end({ timeout: 5 }),
  }
}

/** Un client per la vita del pod (processo Node di lunga durata), non per richiesta. */
export const db: Database = createDatabase(resolveDatabaseUrl(process.env)).database
