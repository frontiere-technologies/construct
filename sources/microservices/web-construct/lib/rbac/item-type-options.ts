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
