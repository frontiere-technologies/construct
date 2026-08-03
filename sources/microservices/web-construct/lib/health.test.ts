import { describe, expect, it } from 'vitest'
import { checkDatabaseReadiness } from './health'

describe('database readiness', () => {
  it('is ready only after the bounded database probe succeeds', async () => {
    const database = { execute: async () => [{ ok: 1 }] }
    await expect(checkDatabaseReadiness(database, 20)).resolves.toBe(true)
  })

  it('is unavailable when the database probe rejects', async () => {
    const database = { execute: async () => { throw new Error('connection refused') } }
    await expect(checkDatabaseReadiness(database, 20)).resolves.toBe(false)
  })

  it('is unavailable when the database probe exceeds its deadline', async () => {
    const database = { execute: async () => new Promise(() => {}) }
    await expect(checkDatabaseReadiness(database, 5)).resolves.toBe(false)
  })
})
