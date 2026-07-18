import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './db/schema'

// Supavisor transaction-mode pooling does not support prepared statements
// across the pooled connection — prepare: false is required, not optional.
// Long-running Node pod per instance ⇒ one client for the pod's lifetime,
// not re-created per request.
const client = postgres(process.env.DATABASE_URL!, { prepare: false })

export const db = drizzle(client, { schema })
