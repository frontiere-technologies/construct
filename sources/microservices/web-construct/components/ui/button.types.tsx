import { Button } from './button'

/**
 * L'etichetta accessibile di un bottone con sola icona, imposta dai tipi.
 *
 * Questo file non viene eseguito: esiste perche' `npm run typecheck` lo
 * compili. Ogni `@ts-expect-error` qui sotto e' un'asserzione — se il vincolo
 * che descrive sparisse, la direttiva diventerebbe inutilizzata e TypeScript
 * fallirebbe con "Unused '@ts-expect-error' directive". Il test e' che il
 * codice NON compili.
 *
 * L'inventario del 2026-08-21 ha trovato sei bottoni con sola icona senza nome
 * accessibile. Il caso che decide la questione e' TagInput.tsx:20 contro
 * RoleMultiSelect.tsx:38: stesso bottone, stessa icona X, stessa funzione, due
 * autori — uno ha messo l'aria-label e l'altro no. Nessuna quantita' di
 * attenzione risolve quel problema; un tipo lo risolve.
 */

// Ammesso: bottone con sola icona che porta la sua etichetta.
export const iconWithLabel = <Button size="icon" aria-label="Chiudi" />

// Rifiutato: bottone con sola icona senza etichetta.
// @ts-expect-error size="icon" richiede aria-label
export const iconWithoutLabel = <Button size="icon" />

// Ammesso: un bottone con testo visibile non deve dichiarare un'etichetta.
export const textButton = <Button>Salva</Button>
