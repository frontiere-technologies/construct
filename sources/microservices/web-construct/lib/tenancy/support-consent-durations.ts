/**
 * Le durate del permesso di assistenza che il tenant può scegliere (specifica 2026-10-26,
 * MT5-DEC-10): 1 ora, 1 giorno, 1 settimana. Senza dipendenze, perché le usa anche la pagina delle
 * impostazioni nel browser. La scadenza si calcola con `now()` del database, mai con l'orologio del
 * server: qui c'è solo l'intervallo SQL di ogni durata.
 */
export const SUPPORT_DURATIONS = ['1h', '1d', '1w'] as const
export type SupportDuration = (typeof SUPPORT_DURATIONS)[number]

export const SUPPORT_DURATION_INTERVAL: Record<SupportDuration, string> = { '1h': '1 hour', '1d': '1 day', '1w': '7 days' }

export function isSupportDuration(value: unknown): value is SupportDuration {
  return SUPPORT_DURATIONS.includes(value as SupportDuration)
}
