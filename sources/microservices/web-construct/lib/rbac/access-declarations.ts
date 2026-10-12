/**
 * Esenzioni dichiarate (specifica 2026-09-01, §6.3). Non controllano niente: dichiarano che la
 * funzione esportata non chiede un permesso del catalogo, e perché. Un'esenzione scritta si legge
 * in revisione e si trova con grep; una dimenticanza no — ed è la differenza che
 * `guards/permission-declared.test.ts` fa valere.
 *
 * Il file non importa niente di proposito: una rotta anonima come /api/health/live che lo usa non
 * deve caricare NextAuth per poter rispondere.
 */

/** La funzione agisce solo sull'utente collegato (profilo, aspetto, lingua, password) e verifica da sé la sessione (DEC-12). */
export function allowSelfService(): void {
  // solo dichiarazione
}

/** La funzione serve chi non ha ancora fatto l'accesso: registrazione, recupero password, sonde, dizionario. */
export function allowAnonymous(): void {
  // solo dichiarazione
}

/** La funzione serve qualunque utente autenticato e non ha un permesso proprio: home, profilo, impostazioni. */
export function allowAnyAuthenticated(): void {
  // solo dichiarazione
}
