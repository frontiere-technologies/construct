import { describe, expect, it } from 'vitest'
import { resolveDatabaseUrl, resolvePlatformDatabaseUrl } from './test-database'

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

describe('platform database url', () => {
  it('fails with a clear Italian message when the variable is missing, so the rest of the app can still start', () => {
    expect(() => resolvePlatformDatabaseUrl({})).toThrow(/PLATFORM_DATABASE_URL.*non è impostata/)
    expect(() => resolvePlatformDatabaseUrl({ PLATFORM_DATABASE_URL: '' })).toThrow(/PLATFORM_DATABASE_URL/)
  })

  it('uses PLATFORM_DATABASE_URL outside mutating integration tests', () => {
    expect(resolvePlatformDatabaseUrl({ PLATFORM_DATABASE_URL: 'postgresql://platform@host/app' })).toBe('postgresql://platform@host/app')
  })

  it('goes through the same disposable-database checks as the runtime url during integration tests', () => {
    expect(() => resolvePlatformDatabaseUrl({ I18N_INTEGRATION_DB: '1' })).toThrow(/TEST_PLATFORM_DATABASE_URL/)
    expect(() => resolvePlatformDatabaseUrl({
      I18N_INTEGRATION_DB: '1',
      TEST_PLATFORM_DATABASE_URL: 'postgresql://platform@host/test',
    })).toThrow(/TEST_DATABASE_DISPOSABLE/)
    expect(() => resolvePlatformDatabaseUrl({
      I18N_INTEGRATION_DB: '1',
      TEST_DATABASE_DISPOSABLE: '1',
      PLATFORM_DATABASE_URL: 'postgresql://platform@host/same',
      TEST_PLATFORM_DATABASE_URL: 'postgresql://platform@host/same',
    })).toThrow(/different/)
    expect(resolvePlatformDatabaseUrl({
      I18N_INTEGRATION_DB: '1',
      TEST_DATABASE_DISPOSABLE: '1',
      PLATFORM_DATABASE_URL: 'postgresql://platform@host/app',
      TEST_PLATFORM_DATABASE_URL: 'postgresql://platform@host/test',
    })).toBe('postgresql://platform@host/test')
  })

  it('never falls back to the development url in integration mode, even when the test one is absent', () => {
    expect(() => resolvePlatformDatabaseUrl({
      I18N_INTEGRATION_DB: '1',
      TEST_DATABASE_DISPOSABLE: '1',
      PLATFORM_DATABASE_URL: 'postgresql://platform@host/app',
    })).toThrow(/TEST_PLATFORM_DATABASE_URL/)
  })
})
