/** Configurazione privata dell'installazione: nessun dato della richiesta la modifica. */
export function readTenancyMode(): 'multi' | 'single' {
  const mode = process.env.CONSTRUCT_TENANCY_MODE
  if (mode === undefined) return 'multi'
  if (mode === 'multi' || mode === 'single') return mode
  throw new Error('Invalid CONSTRUCT_TENANCY_MODE: expected multi or single')
}

export function isMultiTenantEnabled(): boolean {
  return readTenancyMode() === 'multi'
}
