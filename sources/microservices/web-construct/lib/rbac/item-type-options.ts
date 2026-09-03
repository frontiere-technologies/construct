import { ITEM_TYPE_CATEGORY, ITEM_TYPE_FUNCTIONALITY } from './types'

export interface ItemTypeOption {
  key: string
  label: string
  idItemType: 1 | 2
  idFunctionalityType: number | null
}

// Unified item-type options — idItemType 1 = category, 2 = functionality
export const ITEM_TYPES: ItemTypeOption[] = [
  { key: 'category', label: 'Category',                       idItemType: ITEM_TYPE_CATEGORY,      idFunctionalityType: null },
  { key: 'embedded', label: 'Link esterno embedded (iframe)',  idItemType: ITEM_TYPE_FUNCTIONALITY, idFunctionalityType: 1 },
  { key: 'external', label: 'Link esterno (http[s])',          idItemType: ITEM_TYPE_FUNCTIONALITY, idFunctionalityType: 2 },
  { key: 'internal', label: 'Link interno (/path)',            idItemType: ITEM_TYPE_FUNCTIONALITY, idFunctionalityType: 3 },
]

/**
 * Le opzioni che la tendina Tipologia offre, dato il modo del form e — in modifica — la
 * tipologia SALVATA della voce.
 *
 * In creazione tutte e quattro. In modifica solo il proprio lato del confine, e il confine
 * e' uno: `updateNavigationItem` rifiuta il passaggio categoria <-> funzionalita'. Il vincolo
 * resta, il motivo e' cambiato (DEC-22): non esiste piu' una «voce pubblica» da creare per
 * sbaglio, perche' menu_entry non porta piu' id_permission. Quel che sopravvive e' l'altro
 * verso, e l'argomento e' piu' forte di "butterebbe via le concessioni": updateNavigationItem
 * non tocca role_functionality, quindi convertire una funzionalita' in categoria lascerebbe
 * le sue concessioni sopravvivere su una riga ormai classificata contenitore -- invisibili in
 * entrambi gli alberi e non piu' revocabili dall'interfaccia. Righe orfane e ingovernabili.
 * Fra i tre sottotipi di funzionalita' (embedded, link esterno, link interno) invece il
 * permesso non si muove, e il server accetta: restringere e' giusto, disabilitare tutto no.
 *
 * La prima stesura del rifiuto disabilitava l'intera tendina e portava via con se' una cosa
 * che funzionava — trasformare un link interno in esterno su una voce esistente richiedeva
 * cancellarla e ricrearla, perdendone id, tag e posizione nell'albero (DEC-16).
 *
 * `storedItemType` deve venire dai DATI SALVATI, non dallo stato corrente del form: e'
 * la stessa deduzione che il server fa su `id_functionality_type`, e usare lo stato
 * corrente farebbe dipendere il confine da cio' che l'utente ha appena scelto.
 */
export function typeOptionsFor(mode: 'create' | 'edit', storedItemType: 1 | 2): ItemTypeOption[] {
  if (mode === 'create') return ITEM_TYPES
  const side = storedItemType === ITEM_TYPE_CATEGORY ? ITEM_TYPE_CATEGORY : ITEM_TYPE_FUNCTIONALITY
  return ITEM_TYPES.filter(option => option.idItemType === side)
}

/**
 * Il controllo e' bloccato solo dove il lato ha una sola opzione, cioe' su una categoria in
 * modifica: una tendina viva che non puo' cambiare niente e' peggio di una disabilitata che
 * spiega il perche' nel tooltip.
 */
export function isTypeLocked(mode: 'create' | 'edit', storedItemType: 1 | 2): boolean {
  return typeOptionsFor(mode, storedItemType).length === 1
}

/**
 * The option currently described by the stored (idItemType, idFunctionalityType) pair,
 * or `null` when none matches — i.e. nothing has been picked yet, or the item carries a
 * functionality type this form cannot create (REMOTE_DESKTOP, PERMISSION). Matching on
 * idItemType first matters: a functionality with no type yet must NOT fall through to the
 * category entry just because that one also has a null idFunctionalityType.
 */
export function resolveItemType(idItemType: 1 | 2, idFunctionalityType: number | null): ItemTypeOption | null {
  if (idItemType === ITEM_TYPE_CATEGORY) return ITEM_TYPES.find(t => t.idItemType === ITEM_TYPE_CATEGORY) ?? null
  return ITEM_TYPES.find(t => t.idItemType === idItemType && t.idFunctionalityType === idFunctionalityType) ?? null
}
