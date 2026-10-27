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

/**
 * L'indirizzo dell'identità di piattaforma (specifica 2026-10-26, §2.2): `PLATFORM_DATABASE_URL`,
 * oppure nei test di integrazione `TEST_PLATFORM_DATABASE_URL` con le stesse protezioni di
 * resolveDatabaseUrl (database usa-e-getta confermato, diverso da quello di sviluppo). Senza la
 * variabile non c'è un indirizzo di ripiego: l'app parte lo stesso e solo le porte della console, che
 * ne hanno bisogno, rispondono con questo errore.
 */
export function resolvePlatformDatabaseUrl(env: DatabaseEnvironment): string {
  if (env.I18N_INTEGRATION_DB === '1') {
    if (!env.TEST_PLATFORM_DATABASE_URL) {
      throw new Error('TEST_PLATFORM_DATABASE_URL è richiesta dai test di integrazione che usano l\'identità di piattaforma')
    }
    if (env.TEST_DATABASE_DISPOSABLE !== '1') {
      throw new Error('TEST_DATABASE_DISPOSABLE=1 is required for mutating integration tests')
    }
    if (env.PLATFORM_DATABASE_URL && env.TEST_PLATFORM_DATABASE_URL === env.PLATFORM_DATABASE_URL) {
      throw new Error('TEST_PLATFORM_DATABASE_URL must be different from PLATFORM_DATABASE_URL')
    }
    return env.TEST_PLATFORM_DATABASE_URL
  }
  if (!env.PLATFORM_DATABASE_URL) {
    throw new Error('PLATFORM_DATABASE_URL non è impostata: la console di piattaforma ha bisogno del login dedicato (vedi README, "Identità di piattaforma")')
  }
  return env.PLATFORM_DATABASE_URL
}
