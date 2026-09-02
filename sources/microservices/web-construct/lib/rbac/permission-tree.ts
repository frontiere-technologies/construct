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

function descendantIds(node: UserNavigationTreeDto): number[] {
  const out: number[] = []
  const walk = (nodes: UserNavigationTreeDto[]) => {
    for (const n of nodes) { out.push(n.id); walk(n.children) }
  }
  walk(node.children)
  return out
}

export function buildAuthMap(trees: UserNavigationTreeDto[]): Map<number, boolean> {
  const map = new Map<number, boolean>()
  const byId = indexTree(trees)
  for (const [id, node] of byId) map.set(id, node.authorization)
  return map
}

/**
 * Spec 3.3: la concessione sta sulle foglie. Una categoria non riceve mai una riga propria in
 * role_permission — né accendendola né spegnendola — quindi il toggle su una categoria si
 * limita a propagare ai discendenti di tipo FUNCTIONALITY (foglie, comprese quelle sotto una
 * sotto-categoria intermedia), senza mai scrivere `itemId` stesso né una sotto-categoria.
 *
 * Il ramo simmetrico di HOLE-5: la vecchia versione, accendendo una foglia, risaliva gli
 * antenati e li segnava concessi — ma spegnendola non li revocava mai, lasciando concessioni
 * residue sulle categorie (pulite una volta per tutte dalla migrazione 0020). Qui quella
 * risalita sparisce del tutto: una foglia accende o spegne solo se stessa, e poiché una
 * categoria non è mai scritta come concessa, non c'è nulla da revocare quando l'ultima foglia
 * di un ramo si spegne.
 */
export function applyToggle(
  trees: UserNavigationTreeDto[],
  map: Map<number, boolean>,
  itemId: number,
  enabled: boolean,
): Map<number, boolean> {
  const byId = indexTree(trees)
  const node = byId.get(itemId)
  const next = new Map(map)
  if (!node) return next

  if (node.type === 'CATEGORY') {
    for (const d of descendantIds(node)) {
      if (byId.get(d)?.type === 'FUNCTIONALITY') next.set(d, enabled)
    }
  } else {
    next.set(itemId, enabled)
  }
  return next
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
