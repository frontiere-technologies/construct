import {
  type NavigationItemRow, type UserNavigationTreeDto, type PermissionDelta,
  type Locale, DEFAULT_LOCALE, ITEM_TYPE_CATEGORY,
} from './types'

function labelFor(it: NavigationItemRow, locale: Locale): string {
  return it.item_translation?.[locale]?.name ?? it.item_translation?.[DEFAULT_LOCALE]?.name ?? it.name ?? ''
}

export function buildAuthTree(
  items: NavigationItemRow[],
  authorizedIds: Set<number>,
  rootId: number,
  locale: Locale = DEFAULT_LOCALE,
): UserNavigationTreeDto[] {
  const childrenByParent = new Map<number | null, NavigationItemRow[]>()
  for (const it of items) {
    const arr = childrenByParent.get(it.id_item_parent) ?? []
    arr.push(it)
    childrenByParent.set(it.id_item_parent, arr)
  }
  const build = (parentId: number): UserNavigationTreeDto[] =>
    (childrenByParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.order_position - b.order_position)
      .map(it => ({
        id: it.id_item,
        name: labelFor(it, locale),
        type: it.id_item_type === ITEM_TYPE_CATEGORY ? 'CATEGORY' : 'FUNCTIONALITY',
        parentId: it.id_item_parent,
        authorization: authorizedIds.has(it.id_item),
        children: build(it.id_item),
      }))
  return build(rootId)
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
    next.set(itemId, enabled)
    for (const d of descendantIds(node)) next.set(d, enabled)
  } else {
    next.set(itemId, enabled)
    if (enabled) {
      let p = node.parentId
      while (p != null && byId.has(p)) {
        next.set(p, true)
        p = byId.get(p)!.parentId
      }
    }
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
