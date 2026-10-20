/**
 * Conta istruzioni e viaggi verso il database, a partire da ciò che postgres.js invia (specifica
 * 2026-10-15, MTP-DEC-5). Con `prepare: false` un'istruzione con parametri costa due viaggi
 * (descrizione, poi esecuzione), una senza parametri uno. Il conto è il totale inviato: non vede
 * quali istruzioni sono partite in coda senza attendere la precedente.
 */
export interface RecordedStatement {
  query: string
  parameterCount: number
}

export interface RoundTripCount {
  statements: number
  roundTrips: number
  queries: string[]
}

export function countRoundTrips(recorded: readonly RecordedStatement[]): RoundTripCount {
  return {
    statements: recorded.length,
    roundTrips: recorded.reduce((total, statement) => total + (statement.parameterCount > 0 ? 2 : 1), 0),
    queries: recorded.map(statement => statement.query),
  }
}
