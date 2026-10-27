/**
 * Lo slug che si propone dal nome di un tenant (MT5-DEC-5): minuscole, senza accenti, cifre e
 * trattini (il vincolo del database, 0046: da 3 a 40 caratteri). Una proposta, che la persona può
 * cambiare; se il nome non ha lettere né cifre il risultato è vuoto. Puro: lo usa anche il client.
 */
export function suggestSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}
