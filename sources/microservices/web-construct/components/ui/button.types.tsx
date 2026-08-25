import * as React from 'react'
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

/**
 * `ref` come prop tipizzata (fix round 2, commit 2): `ButtonBase` deriva ora
 * da `React.ComponentPropsWithRef<'button'>` invece di
 * `React.ButtonHTMLAttributes<HTMLButtonElement>`, che non dichiarava `ref`.
 * Prima di questo cambio, `<Button ref={...} />` era un errore di
 * compilazione (non un problema a runtime: React 19 estrae `ref` dai props
 * anche quando arriva da uno spread). Questi due casi provano che il tipo ora
 * lo ammette, sul ramo host e sul ramo `asChild`; il comportamento a runtime
 * resta a carico di React, non di questo file.
 */
const hostRef: React.Ref<HTMLButtonElement> = React.createRef<HTMLButtonElement>()
export const withRef = <Button ref={hostRef}>Salva</Button>

const slotRef: React.Ref<HTMLButtonElement> = React.createRef<HTMLButtonElement>()
export const withRefAsChild = (
  // eslint-disable-next-line @next/next/no-html-link-for-pages
  <Button asChild ref={slotRef}><a href="/roles">Ruoli</a></Button>
)
