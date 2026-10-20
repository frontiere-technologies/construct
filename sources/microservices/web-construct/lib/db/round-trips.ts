/**
 * Conta istruzioni e viaggi verso il database, a partire da ciò che postgres.js invia (specifica
 * 2026-10-15, MTP-DEC-5). Con `prepare: false` un'istruzione con parametri costa due viaggi
 * (descrizione, poi esecuzione), una senza parametri uno. Il conto è il totale inviato: non vede
 * quali istruzioni sono partite in coda senza attendere la precedente: per questo serve
 * `answersBetween` (vedi sotto).
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

/**
 * Gli eventi del client misurato, nell'ordine in cui accadono: un'istruzione inviata da postgres.js
 * (`sent`) o una risposta del server arrivata (`answer`, la descrizione delle colonne di una
 * lettura). Il conto totale non distingue due letture in coda da due letture in serie: l'ordine sì.
 */
export type TripEvent = { type: 'sent'; query: string } | { type: 'answer' }

/**
 * Quante risposte del server sono arrivate tra l'invio della prima istruzione che corrisponde a
 * `first` e l'invio della prima che corrisponde a `second` (cercata dopo la prima). 0 vuol dire che
 * la seconda è partita senza aspettare nulla: le due letture sono in coda insieme. Con `await`
 * in serie la seconda parte solo dopo la risposta alla prima e il risultato è almeno 1.
 */
export function answersBetween(events: readonly TripEvent[], first: RegExp, second: RegExp): number {
  const sentAt = (pattern: RegExp, from: number) =>
    events.findIndex((event, index) => index >= from && event.type === 'sent' && pattern.test(event.query))
  const firstIndex = sentAt(first, 0)
  if (firstIndex < 0) throw new Error(`no statement matches ${first}`)
  const secondIndex = sentAt(second, firstIndex + 1)
  if (secondIndex < 0) throw new Error(`no statement matches ${second} after the one matching ${first}`)
  return events.slice(firstIndex + 1, secondIndex).filter(event => event.type === 'answer').length
}
