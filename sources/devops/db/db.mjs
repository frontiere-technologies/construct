#!/usr/bin/env node
/**
 * Apply schema.sql, or run an ad-hoc query, against DATABASE_URL.
 *
 * Exists because `psql` is not a dependency of this project and is absent from
 * some dev machines. It reuses the `postgres` driver the app already depends on
 * and the same DATABASE_URL from web-construct/.env.local, so there is exactly
 * one connection string in the repo.
 *
 *   node sources/devops/db/db.mjs apply
 *   node sources/devops/db/db.mjs query "select code from app_language"
 *
 * `apply` runs schema.sql through the simple query protocol (multi-statement)
 * and forwards every RAISE NOTICE to stdout, so the seed summaries are visible.
 * Exits 1 on the first error — the equivalent of psql's ON_ERROR_STOP.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../../microservices/web-construct')
const schemaPath = resolve(here, 'schema.sql')

// Resolved from the app's node_modules rather than this file's ancestors: the
// driver is the app's dependency, and devops/ has no package.json of its own.
const require = createRequire(resolve(appDir, 'package.json'))
const postgres = require('postgres')

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = resolve(appDir, '.env.local')
  const line = readFileSync(envFile, 'utf8')
    .split('\n')
    .find(l => l.startsWith('DATABASE_URL='))
  if (!line) throw new Error(`DATABASE_URL not set and not found in ${envFile}`)
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
}

const [command, argument] = process.argv.slice(2)
if (command !== 'apply' && command !== 'query') {
  console.error('usage: db.mjs apply | db.mjs query "<sql>"')
  process.exit(2)
}

const sql = postgres(databaseUrl(), {
  prepare: false,
  connect_timeout: 30,
  idle_timeout: 5,
  onnotice: notice => console.log(`NOTICE: ${notice.message}`),
})

try {
  if (command === 'apply') {
    await sql.unsafe(readFileSync(schemaPath, 'utf8')).simple()
    console.log(`applied ${schemaPath}`)
  } else {
    if (!argument) throw new Error('query requires a SQL argument')
    // `.simple()` so multi-statement verification queries work like psql's -c chain.
    const result = await sql.unsafe(argument).simple()
    const resultSets = Array.isArray(result[0]) ? result : [result]
    for (const rows of resultSets) {
      if (rows.length) console.table([...rows])
      else console.log('(0 rows)')
    }
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`)
  if (err.position) console.error(`  at character ${err.position}`)
  if (err.where) console.error(`  in ${err.where}`)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
