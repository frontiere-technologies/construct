import { describe, expect, it } from 'vitest'
import { nextKeyboardCoordinates, type KeyboardDragRow } from './navigation-tree-keyboard-drag'

// Tre righe alte 40, attaccate. La prima e la terza accolgono figli, la seconda no.
const rows: KeyboardDragRow[] = [
  { id: 1, top: 0, height: 40, isCategory: true },
  { id: 2, top: 40, height: 40, isCategory: false },
  { id: 3, top: 80, height: 40, isCategory: true },
]

const at = (y: number) => ({ x: 10, y })
// Gia' posizionato: l'ancora non conta piu'.
const press = (key: string, y: number) =>
  nextKeyboardCoordinates(key, at(y), rows, { positioned: true, anchorY: 0 })
// Prima pressione, con l'elemento trascinato al centro della riga indicata.
const first = (key: string, anchorY: number) =>
  nextKeyboardCoordinates(key, at(0), rows, { positioned: false, anchorY })

// Le coordinate attese, calcolate dalle bande: prima=15%, dentro=50%, dopo=85%.
const BEFORE_1 = 6, INTO_1 = 20, AFTER_1 = 34
const INTO_2 = 60, AFTER_2 = 74
const AFTER_3 = 114

describe('navigation tree keyboard drag', () => {
  it('starts next to the dragged row, not at the top of the tree', () => {
    // Elemento al centro della riga 2 (y=60): la prima Giu' va al varco appena
    // sotto, la prima Su a quello appena sopra.
    expect(first('ArrowDown', 60)).toEqual({ x: 10, y: AFTER_2 })
    expect(first('ArrowUp', 60)).toEqual({ x: 10, y: AFTER_1 })
  })

  it('does not mistake the initial (0,0) for a position inside a row at the top', () => {
    // Il caso che aveva rotto la prima stesura: la riga 1 comincia a y=0, quindi
    // il puntatore virtuale iniziale ci cade dentro. Con il flag esplicito la
    // prima pressione parte comunque dall'ancora.
    expect(first('ArrowDown', 100)).toEqual({ x: 10, y: AFTER_3 })
  })

  it('clamps the first press when the dragged row sits at either end', () => {
    expect(first('ArrowDown', 999)).toEqual({ x: 10, y: AFTER_3 })
    expect(first('ArrowUp', -999)).toEqual({ x: 10, y: BEFORE_1 })
  })

  it('has nothing to nest into before the first press has placed anything', () => {
    expect(first('ArrowRight', 60)).toBeUndefined()
    expect(first('ArrowLeft', 60)).toBeUndefined()
  })

  it('moves one insertion point per press, never two', () => {
    // prima della 1 -> dopo la 1 -> dopo la 2 -> dopo la 3
    expect(press('ArrowDown', BEFORE_1)).toEqual({ x: 10, y: AFTER_1 })
    expect(press('ArrowDown', AFTER_1)).toEqual({ x: 10, y: AFTER_2 })
    expect(press('ArrowDown', AFTER_2)).toEqual({ x: 10, y: AFTER_3 })
  })

  it('walks back up the same way', () => {
    expect(press('ArrowUp', AFTER_3)).toEqual({ x: 10, y: AFTER_2 })
    expect(press('ArrowUp', AFTER_2)).toEqual({ x: 10, y: AFTER_1 })
    expect(press('ArrowUp', AFTER_1)).toEqual({ x: 10, y: BEFORE_1 })
  })

  it('stops at both ends instead of wrapping around', () => {
    expect(press('ArrowUp', BEFORE_1)).toEqual({ x: 10, y: BEFORE_1 })
    expect(press('ArrowDown', AFTER_3)).toEqual({ x: 10, y: AFTER_3 })
  })

  it('nests into the row the insertion point belongs to', () => {
    expect(press('ArrowRight', AFTER_1)).toEqual({ x: 10, y: INTO_1 })
    expect(press('ArrowRight', BEFORE_1)).toEqual({ x: 10, y: INTO_1 })
  })

  it('refuses to nest into a row that cannot hold children', () => {
    expect(press('ArrowRight', AFTER_2), 'la riga 2 non e\' una categoria').toBeUndefined()
  })

  it('refuses to nest twice', () => {
    expect(press('ArrowRight', INTO_1)).toBeUndefined()
  })

  it('pulls back out of a nesting with Left, and only from a nesting', () => {
    expect(press('ArrowLeft', INTO_1)).toEqual({ x: 10, y: AFTER_1 })
    expect(press('ArrowLeft', AFTER_1), 'niente da cui uscire').toBeUndefined()
  })

  it('leaves the nesting before moving on, so Down never skips the chosen spot', () => {
    // Da "dentro la 1" una Giu' deve dare "dopo la 1", non "dopo la 2":
    // altrimenti scavalcherebbe in silenzio la posizione appena scelta.
    expect(press('ArrowDown', INTO_1)).toEqual({ x: 10, y: AFTER_1 })
    expect(press('ArrowUp', INTO_1)).toEqual({ x: 10, y: BEFORE_1 })
  })

  it('nests into a later category too, not only the first', () => {
    expect(press('ArrowRight', AFTER_3)).toEqual({ x: 10, y: 80 + 20 })
  })

  it('ignores keys that mean nothing here, and an empty tree', () => {
    expect(press('Tab', AFTER_1)).toBeUndefined()
    expect(nextKeyboardCoordinates('ArrowDown', at(0), [], { positioned: true, anchorY: 0 })).toBeUndefined()
  })
})

// INTO_2 non e' un punto raggiungibile: la riga 2 non e' una categoria.
void INTO_2
