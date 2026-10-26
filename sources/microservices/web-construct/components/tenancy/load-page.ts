/**
 * Carica una pagina da capo nel browser (non una navigazione del router di Next). La richiesta parte
 * dal browser con il suo indirizzo, passa dal proxy con il cookie di sessione appena aggiornato e
 * ridisegna tutto, sessione del client compresa. Separata dal componente per poterla sostituire nei
 * test: jsdom non naviga.
 */
export function loadPage(path: string): void {
  window.location.assign(path)
}
