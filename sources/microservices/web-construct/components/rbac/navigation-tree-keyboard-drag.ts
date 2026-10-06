/**
 * A11Y-3 — il trascinamento dell'albero di navigazione, da tastiera.
 *
 * L'albero non decide il rilascio "sopra un bersaglio": lo ricava dalla Y del
 * puntatore dentro la riga sorvolata — sotto il 30% e' *prima*, sopra il 70% e'
 * *dopo*, in mezzo e' *dentro* (annidamento come figlio). Da tastiera non c'e'
 * nessun puntatore.
 *
 * La scelta fatta qui e' di **non** duplicare quel modello. Il `KeyboardSensor`
 * di dnd-kit parte da coordinate (0,0) e vi somma quelle che questo modulo
 * restituisce, quindi restituendo coordinate *assolute* si guida un puntatore
 * virtuale: da li' in giu' la geometria che serve mouse e tastiera e' la stessa,
 * e non esistono due definizioni di "dentro" che possono divergere.
 *
 * I tasti seguono il modello degli alberi di file, non le tre bande del mouse:
 * Su e Giu' spostano il punto d'inserimento di una posizione per volta, Destra
 * annida dentro la riga corrente, Sinistra tira fuori. Ogni tasto ha un solo
 * significato, che e' cio' che rende prevedibile una posizione che non si vede.
 */

export type DropPos = 'before' | 'after' | 'into'

/**
 * Dove mirare dentro la riga, in frazione della sua altezza, perche' la
 * geometria condivisa legga la posizione voluta. I valori stanno al centro
 * delle tre bande, non sui bordi: un arrotondamento a mezzo pixel non deve
 * poter cambiare il significato di una pressione di tasto.
 */
export const BAND: Record<DropPos, number> = { before: 0.15, into: 0.5, after: 0.85 }

export interface KeyboardDragRow {
  id: number
  top: number
  height: number
  /** Solo una categoria puo' accogliere figli, quindi solo su una vale "dentro". */
  isCategory: boolean
}

/** Un punto d'inserimento: la riga a cui si riferisce, e da che lato. */
interface Gap { row: number; pos: DropPos }

/**
 * I punti d'inserimento in ordine di lettura: prima della prima riga, poi dopo
 * ciascuna. Sono N+1, e Su/Giu' ci si muovono uno alla volta — mai due, che e'
 * il difetto in cui cade chi tratta "prima" e "dopo" come stati indipendenti di
 * ogni riga.
 */
function gaps(rowCount: number): Gap[] {
  return [{ row: 0, pos: 'before' }, ...Array.from({ length: rowCount }, (_, row) => ({ row, pos: 'after' as DropPos }))]
}

/** Da una coordinata assoluta al punto d'inserimento che rappresenta. */
function locate(y: number, rows: KeyboardDragRow[]): { gap: number; pos: DropPos } | null {
  const row = rows.findIndex(r => y >= r.top && y < r.top + r.height)
  if (row < 0) return null

  const rel = (y - rows[row].top) / rows[row].height
  const pos: DropPos = rel < 0.30 ? 'before' : rel > 0.70 ? 'after' : 'into'
  // 'into' vive sulla riga, non fra due righe: il suo indice di varco e' quello
  // di 'after' sulla stessa riga, cosi' una Giu' da 'dentro' esce verso il basso.
  const gap = pos === 'before' ? row : row + 1
  return { gap, pos }
}

function coordinatesFor(gap: Gap, rows: KeyboardDragRow[], x: number) {
  const row = rows[gap.row]
  return { x, y: Math.round(row.top + BAND[gap.pos] * row.height) }
}

/**
 * La posizione successiva del puntatore virtuale, o `undefined` se il tasto non
 * significa niente qui (dnd-kit lascia allora la posizione invariata).
 *
 * `rows` deve gia' escludere la riga trascinata e i suoi discendenti: annidare
 * un ramo dentro se stesso non e' una posizione da cui l'utente debba passare
 * per arrivare altrove.
 *
 * `start.positioned` dice se una pressione precedente ha gia' collocato il
 * puntatore. Non e' deducibile dalla geometria, ed e' un errore provarci: il
 * puntatore virtuale nasce a (0,0), che sembra "fuori da ogni riga" finche' la
 * prima riga non si trova in cima alla finestra — e allora (0,0) e' una
 * posizione legittima dentro di essa, indistinguibile dall'inizio.
 *
 * `start.anchorY` e' il centro della riga trascinata. La prima pressione parte
 * di li' invece che dalla cima dell'albero: chi sposta un elemento quasi sempre
 * lo sposta di poco, e cominciare lontano vorrebbe dire attraversare l'albero
 * intero per tornare al punto di partenza.
 */
export function nextKeyboardCoordinates(
  key: string,
  current: { x: number; y: number },
  rows: KeyboardDragRow[],
  start: { positioned: boolean; anchorY: number },
): { x: number; y: number } | undefined {
  if (rows.length === 0) return undefined

  const all = gaps(rows.length)

  if (!start.positioned) {
    // Annidare senza una posizione da cui partire non vuol dire niente.
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return undefined
    const ys = all.map(g => coordinatesFor(g, rows, current.x).y)
    const index = key === 'ArrowDown'
      ? ys.findIndex(y => y > start.anchorY)
      : ys.map(y => y < start.anchorY).lastIndexOf(true)
    // Nessun varco da quel lato: l'elemento e' gia' a un capo dell'albero.
    if (index < 0) return coordinatesFor(all[key === 'ArrowDown' ? all.length - 1 : 0], rows, current.x)
    return coordinatesFor(all[index], rows, current.x)
  }

  const here = locate(current.y, rows)
  if (!here) return undefined

  switch (key) {
    case 'ArrowDown': {
      // Da 'dentro' una Giu' esce prima di tutto dall'annidamento, altrimenti
      // scavalcherebbe silenziosamente la posizione appena scelta.
      if (here.pos === 'into') return coordinatesFor({ row: here.gap - 1, pos: 'after' }, rows, current.x)
      const next = Math.min(here.gap + 1, all.length - 1)
      return coordinatesFor(all[next], rows, current.x)
    }
    case 'ArrowUp': {
      if (here.pos === 'into') return coordinatesFor({ row: here.gap - 1, pos: 'before' }, rows, current.x)
      const prev = Math.max(here.gap - 1, 0)
      return coordinatesFor(all[prev], rows, current.x)
    }
    case 'ArrowRight': {
      // Annida dentro la riga a cui il punto d'inserimento appartiene.
      const row = here.pos === 'before' ? here.gap : here.gap - 1
      if (here.pos === 'into' || !rows[row]?.isCategory) return undefined
      return coordinatesFor({ row, pos: 'into' }, rows, current.x)
    }
    case 'ArrowLeft': {
      if (here.pos !== 'into') return undefined
      return coordinatesFor({ row: here.gap - 1, pos: 'after' }, rows, current.x)
    }
    default:
      return undefined
  }
}
