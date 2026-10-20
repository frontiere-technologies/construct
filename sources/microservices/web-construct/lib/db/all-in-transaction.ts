/**
 * `Promise.all` per le letture lanciate insieme dentro una transazione (specifica 2026-10-15,
 * §2.5). Aspetta tutti i rami, anche quando uno rifiuta, e solo allora rilancia il primo
 * rifiuto in ordine di tempo (come fa `withTenant` in `tenant-db.ts` con `Promise.allSettled`).
 *
 * Perché: `Promise.all` rifiuta al primo errore e lascia girare gli altri rami. Se la funzione
 * della transazione finisce lì, la transazione si chiude (ROLLBACK) mentre un ramo potrebbe
 * ancora inviare un'istruzione, e postgres.js la manderebbe sulla connessione già restituita al
 * pooler: fuori da ogni transazione (nessun tenant) oppure dentro quella di un'altra richiesta,
 * magari di un altro tenant. Qui la transazione non può finire finché ogni ramo non ha chiuso.
 *
 * Regola per chi lo usa: ogni ramo deve essere una sola istruzione, oppure attendere tutto ciò
 * che avvia. Non aggiunge istruzioni né viaggi: attende soltanto ciò che il chiamante ha già
 * avviato.
 */
export async function allInTransaction<T extends readonly unknown[] | []>(
  values: T,
): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  let failed = false
  let firstReason: unknown
  // Ogni rifiuto passa da qui: il primo nel tempo è quello che si rilancia. Il rilancio è
  // gestito da allSettled, quindi nessun rifiuto resta senza gestore.
  const tracked = Array.from(values as readonly unknown[], value =>
    Promise.resolve(value).catch((reason: unknown) => {
      if (!failed) { failed = true; firstReason = reason }
      throw reason
    }),
  )
  const outcomes = await Promise.allSettled(tracked)
  if (failed) throw firstReason
  return outcomes.map(outcome => (outcome as PromiseFulfilledResult<unknown>).value) as {
    -readonly [P in keyof T]: Awaited<T[P]>
  }
}
