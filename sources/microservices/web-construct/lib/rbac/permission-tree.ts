import {
  type PermissionRow, type UserNavigationTreeDto, type PermissionDelta,
  type Locale, DEFAULT_LOCALE,
} from './types'

function labelFor(p: PermissionRow, locale: Locale): string {
  return p.item_translation?.[locale]?.name ?? p.item_translation?.[DEFAULT_LOCALE]?.name ?? p.name ?? ''
}

/**
 * Un solo albero, costruito da `id_parent` — non più due sottoalberi affiancati a partire da
 * un `rootId` sentinella (0 = Root, -1 = Operations). Le radici sono le righe con `id_parent`
 * nullo, qualunque esse siano: oggi sono ancora quelle due categorie, ma il criterio è
 * strutturale, non un identificativo noto a priori. È anche ciò che chiude la finestra aperta
 * dal Task 5: una `permission` creata dal pannello nasce con `id_parent` nullo (vedi
 * `createNavigationItem` in navigation-actions.ts), e con la costruzione precedente — due
 * chiamate a partire da rootId 0 e -1 — non finiva in nessuna delle due; qui diventa
 * semplicemente un'altra radice, raggiungibile come le altre.
 *
 * I permessi deprecati si scartano prima di costruire (restano sul database, DEC-9 — solo
 * l'albero li nasconde), e la loro esclusione può nascondere anche i loro discendenti non
 * deprecati: la stessa regola della 0018 su menu_entry (nascondere un nodo nasconde il
 * sottoalbero), qui applicata al filtro invece che a una delete.
 */
export function buildAuthTree(
  permissions: PermissionRow[],
  grantedIds: Set<number>,
  locale: Locale = DEFAULT_LOCALE,
): UserNavigationTreeDto[] {
  const live = permissions.filter(p => p.deprecated_at == null)
  const childrenByParent = new Map<number | null, PermissionRow[]>()
  for (const p of live) {
    const arr = childrenByParent.get(p.id_parent) ?? []
    arr.push(p)
    childrenByParent.set(p.id_parent, arr)
  }
  const build = (parentId: number | null): UserNavigationTreeDto[] =>
    (childrenByParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.order_position - b.order_position)
      .map(p => ({
        id: p.id_permission,
        name: labelFor(p, locale),
        type: p.kind === 'CATEGORY' ? 'CATEGORY' as const : 'FUNCTIONALITY' as const,
        // Il tipo decide l'icona (typeIcon in NavigationTree): una chiave, non il tondino di
        // riserva che accanto all'interruttore sembrava un'opzione da selezionare.
        functionalityType: p.kind === 'CATEGORY' ? null : 'PERMISSION' as const,
        parentId: p.id_parent,
        // Spec 3.3: la concessione sta sulle foglie. Una categoria non ha mai una riga propria
        // in role_permission, quindi la sua authorization è sempre false — anche se il database
        // ne conservasse ancora una (vedi la migrazione 0020, che le ripulisce).
        authorization: p.kind === 'CATEGORY' ? false : grantedIds.has(p.id_permission),
        children: build(p.id_permission),
      }))
  return build(null)
}

function indexTree(trees: UserNavigationTreeDto[]) {
  const byId = new Map<number, UserNavigationTreeDto>()
  const walk = (nodes: UserNavigationTreeDto[]) => {
    for (const n of nodes) { byId.set(n.id, n); walk(n.children) }
  }
  walk(trees)
  return byId
}

export function buildAuthMap(trees: UserNavigationTreeDto[]): Map<number, boolean> {
  const map = new Map<number, boolean>()
  const byId = indexTree(trees)
  for (const [id, node] of byId) map.set(id, node.authorization)
  return map
}

export function computeDeltas(
  loaded: Map<number, boolean>,
  current: Map<number, boolean>,
): PermissionDelta[] {
  const ids = new Set<number>([...loaded.keys(), ...current.keys()])
  const deltas: PermissionDelta[] = []
  for (const id of ids) {
    const was = loaded.get(id) ?? false
    const now = current.get(id) ?? false
    if (was !== now) deltas.push({ idItem: id, authorization: now })
  }
  return deltas
}

/**
 * Lo stato di una cartella (DEC-20). Non è un dato: è il riassunto delle foglie del proprio
 * sottoalbero, ricalcolato a ogni disegno. `empty` è il contenitore che non ha nessuna
 * funzionalità sotto di sé — il suo interruttore va disabilitato, non lasciato inerte: un
 * controllo che non risponde e non spiega perché è esattamente il difetto segnalato (BUG-2).
 */
export type FolderState = 'off' | 'partial' | 'on' | 'empty'

/** Le funzionalità del sottoalbero di `node`, a qualunque profondità. I contenitori
 *  intermedi si attraversano e non si contano: non sono concedibili. */
function leafIds(node: UserNavigationTreeDto): number[] {
  const out: number[] = []
  const walk = (nodes: UserNavigationTreeDto[]) => {
    for (const n of nodes) {
      if (n.type === 'FUNCTIONALITY') out.push(n.id)
      walk(n.children)
    }
  }
  walk(node.children)
  return out
}

export function folderState(node: UserNavigationTreeDto, map: Map<number, boolean>): FolderState {
  const leaves = leafIds(node)
  if (leaves.length === 0) return 'empty'
  const accese = leaves.filter(id => map.get(id) ?? false).length
  if (accese === 0) return 'off'
  if (accese === leaves.length) return 'on'
  return 'partial'
}

/** Quale foglia l'attore può accendere. Senza limite (l'Amministratore, o un albero che non
 *  conosce l'attore) ogni foglia lo è. DEC-6 limita il concedere, non il revocare: spegnere è
 *  sempre ammesso, e per questo il limite si consulta solo sulle foglie spente. */
export type CanGrant = (id: number) => boolean

const grantAll: CanGrant = () => true

/**
 * Il clic decide il verso da sé, e questo è il punto (BUG-3). Prima lo calcolava il chiamante
 * come `!(map.get(node.id) ?? false)`: su una foglia è corretto, su una cartella — che
 * `buildAuthTree` marcava `authorization: false` per costruzione — quell'espressione valeva
 * sempre `true`, quindi una cartella accendeva e non spegneva mai. Portando la decisione qui
 * dentro non resta un chiamante che possa sbagliarla.
 *
 * Su una cartella la regola è: accendi le foglie se ce n'è almeno una spenta che si può accendere
 * (`off` e `partial` vanno entrambi verso l'accensione — «parziale» non è metà di un ciclo a
 * tre passi, è una condizione da completare), altrimenti spegnile tutte. Accendendo si toccano
 * solo le foglie che `canGrant` ammette (I3 della revisione finale del piano 2026-10-12): le
 * altre restano come sono, e una cartella le cui foglie concedibili sono già tutte accese si
 * spegne invece di restare ferma. La cartella stessa non viene mai scritta nella mappa:
 * `next.has(idCartella)` resta falso in entrambi i versi, ed è ciò che impedisce a
 * `computeDeltas` di generare un delta che il server rifiuterebbe.
 */
export function toggleNode(
  trees: UserNavigationTreeDto[],
  map: Map<number, boolean>,
  itemId: number,
  canGrant: CanGrant = grantAll,
): Map<number, boolean> {
  const byId = indexTree(trees)
  const node = byId.get(itemId)
  const next = new Map(map)
  if (!node) return next

  if (node.type === 'FUNCTIONALITY') {
    const on = map.get(itemId) ?? false
    if (on || canGrant(itemId)) next.set(itemId, !on)
    return next
  }

  const leaves = leafIds(node)
  const toSwitchOn = leaves.filter(id => !(map.get(id) ?? false) && canGrant(id))
  if (toSwitchOn.length) {
    for (const id of toSwitchOn) next.set(id, true)
  } else {
    for (const id of leaves) next.set(id, false)
  }
  return next
}

/** Il clic su `node` cambierebbe qualcosa? Una foglia accesa si spegne sempre, una spenta si
 *  accende solo se concedibile; una cartella si muove se ha una foglia da accendere o da spegnere.
 *  Un interruttore che non cambierebbe niente va disabilitato, non lasciato inerte. */
export function canToggle(node: UserNavigationTreeDto, map: Map<number, boolean>, canGrant: CanGrant = grantAll): boolean {
  const ids = node.type === 'FUNCTIONALITY' ? [node.id] : leafIds(node)
  return ids.some(id => (map.get(id) ?? false) || canGrant(id))
}

/**
 * Timbra la concessione su un albero costruito altrove — per il menu, da `buildNavTree` in
 * nav-tree-builder.ts, che è l'unico posto dove quella gerarchia è vera (BUG-1). Solo sulle
 * funzionalità: un contenitore è un riassunto, non una riga, quindi resta `false` anche se
 * `grantedIds` lo contenesse. È lo stesso presidio che `buildAuthTree` applica alle categorie
 * di `permission`, applicato all'altro albero.
 */
export function stampAuthorization(
  nodes: UserNavigationTreeDto[],
  grantedIds: Set<number>,
): UserNavigationTreeDto[] {
  return nodes.map(n => ({
    ...n,
    authorization: n.type === 'FUNCTIONALITY' && grantedIds.has(n.id),
    children: stampAuthorization(n.children, grantedIds),
  }))
}
