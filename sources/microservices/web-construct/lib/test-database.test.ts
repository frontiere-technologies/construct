import { describe, expect, it } from 'vitest'
import { resolveDatabaseUrl } from './test-database'

describe('test database safety boundary', () => {
  it('uses the application database outside mutating integration tests', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgresql://host/app' })).toBe('postgresql://host/app')
  })

  it('requires an explicitly disposable and distinct database for integration tests', () => {
    expect(() => resolveDatabaseUrl({ I18N_INTEGRATION_DB: '1' })).toThrow(/TEST_DATABASE_URL/)
    expect(() => resolveDatabaseUrl({
      I18N_INTEGRATION_DB: '1',
      TEST_DATABASE_URL: 'postgresql://host/test',
    })).toThrow(/TEST_DATABASE_DISPOSABLE/)
    expect(() => resolveDatabaseUrl({
      I18N_INTEGRATION_DB: '1',
      TEST_DATABASE_DISPOSABLE: '1',
      DATABASE_URL: 'postgresql://host/same',
      TEST_DATABASE_URL: 'postgresql://host/same',
    })).toThrow(/different/)
  })

  it('uses the dedicated database only after every safety check passes', () => {
    expect(resolveDatabaseUrl({
      I18N_INTEGRATION_DB: '1',
      TEST_DATABASE_DISPOSABLE: '1',
      DATABASE_URL: 'postgresql://host/app',
      TEST_DATABASE_URL: 'postgresql://host/test',
    })).toBe('postgresql://host/test')
  })
})
