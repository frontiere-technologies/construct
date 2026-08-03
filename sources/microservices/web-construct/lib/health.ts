import { sql, type SQL } from 'drizzle-orm'

interface ReadinessDatabase {
  execute(query: SQL): Promise<unknown>
}

export async function checkDatabaseReadiness(database: ReadinessDatabase, timeoutMs = 1_000): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      database.execute(sql`select 1`),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('database readiness timeout')), timeoutMs)
      }),
    ])
    return true
  } catch {
    return false
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
