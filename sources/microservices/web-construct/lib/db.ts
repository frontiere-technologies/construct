import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './db/schema'

// Supavisor transaction-mode pooling does not support prepared statements
// across the pooled connection — prepare: false is required, not optional.
// Long-running Node pod per instance ⇒ one client for the pod's lifetime,
// not re-created per request.
// max/connect_timeout raised/lowered from postgres.js's defaults (10 / 30s):
// the default pool was observed saturating under concurrent load, and a
// saturated pool silently blocked new connections for the full 30s default
// instead of failing fast — a wider pool absorbs the same concurrency
// without queuing, and a shorter timeout surfaces genuine exhaustion quickly.
const client = postgres(process.env.DATABASE_URL!, { prepare: false, max: 20, connect_timeout: 10 })

export const db = drizzle(client, { schema })
