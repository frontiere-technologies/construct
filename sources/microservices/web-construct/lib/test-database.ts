type DatabaseEnvironment = Record<string, string | undefined>

export function resolveDatabaseUrl(env: DatabaseEnvironment): string {
  if (env.I18N_INTEGRATION_DB !== '1') return env.DATABASE_URL ?? ''
  if (!env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for mutating integration tests')
  if (env.TEST_DATABASE_DISPOSABLE !== '1') {
    throw new Error('TEST_DATABASE_DISPOSABLE=1 is required for mutating integration tests')
  }
  if (env.DATABASE_URL && env.TEST_DATABASE_URL === env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must be different from DATABASE_URL')
  }
  return env.TEST_DATABASE_URL
}
