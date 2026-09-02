import { ROOT_ID, type ParentOption, type SelectOption } from './types'

/** Label of the virtual root (ROOT_ID) in the Genitore dropdown. */
export const ROOT_OPTION_LABEL = 'Root'

/**
 * Genitore choices: every selectable category plus the root itself. Root has to be a real
 * option — without it an item nested under a category could never be moved back to the top
 * level from the form, and a root-level item had nothing to display but the placeholder.
 *
 * The order mirrors the sidebar's own layout, where a section is pinned above the main list
 * (navbar_position TOP, i.e. Home) or below it (BOTTOM, i.e. Admin): pinned-top sections,
 * then Root, then pinned-bottom sections, then everything else as it came in.
 */
export function buildGenitoreOptions(parents: ParentOption[]): SelectOption[] {
  const inGroup = (position: ParentOption['navbarPosition']) =>
    parents.filter(p => p.navbarPosition === position).map(p => ({ value: p.id, label: p.name }))
  return [
    ...inGroup('TOP'),
    { value: ROOT_ID, label: ROOT_OPTION_LABEL },
    ...inGroup('BOTTOM'),
    ...inGroup(null),
  ]
}

/** A missing parent means "at the root", which the dropdown shows as the Root option. */
export function genitoreValue(idItemParent: number | null): number {
  return idItemParent ?? ROOT_ID
}

/**
 * Inverse of genitoreValue: a raw dropdown selection maps back to `null` only for the Root
 * sentinel. Needed because the menu root is the absence of a parent (Task 5), not a real
 * item — writing the ROOT_ID placeholder itself into id_parent would reference a menu_entry
 * row that doesn't exist.
 */
export function parseGenitoreSelection(value: number): number | null {
  return value === ROOT_ID ? null : value
}

// The Genitore field is locked (disabled, showing Root) only when there's no real choice to
// make: no mutable category exists to nest under (just the immutable Home/Admin sections are
// seeded), so Root is the single option. Otherwise it stays editable in both modes — moving
// an existing item is possible from the form as well as by dragging it in the tree.
export function isGenitoreLocked(parentsCount: number): boolean {
  return parentsCount === 0
}
