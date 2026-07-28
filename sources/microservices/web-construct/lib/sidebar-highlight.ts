import type { MenuItem } from '@/types/menu'

/**
 * How a sidebar entry is highlighted:
 * - `active`: the page you're on, or a container holding it
 * - `open`:   a container whose panel is open but which doesn't hold the current page
 * - `none`:   everything else
 *
 * Keeping `open` distinct from `active` is what stops an expanded section from looking exactly
 * like the current page, and the rule is level-agnostic so a section behaves the same whether
 * it sits in the first column or the third.
 */
export type NavHighlight = 'none' | 'open' | 'active'

type NavNode = Pick<MenuItem, 'id' | 'parentId'>

/**
 * The containers between the active route and the top level, ordered top level first — i.e.
 * exactly the chain of panels to open so the current page is on screen, at any depth.
 */
export function activeAncestorPath(items: NavNode[], activeRouteId: string | null): string[] {
  const path: string[] = []
  if (activeRouteId == null) return path
  const byId = new Map(items.map(i => [i.id, i]))
  const seen = new Set<string>()
  let cur = byId.get(activeRouteId)
  while (cur?.parentId != null) {
    const parent = byId.get(cur.parentId)
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    path.unshift(parent.id)
    cur = parent
  }
  return path
}

/** Ids of the containers between the active route and the top level. */
export function activeAncestorIds(items: NavNode[], activeRouteId: string | null): Set<string> {
  return new Set(activeAncestorPath(items, activeRouteId))
}

/**
 * Open or close the container `id` sitting at `depth` in the chain of open panels (depth 0 is a
 * top-level container). Re-picking the one already open there closes it and everything below;
 * picking a different one replaces that level and drops the levels below. There is no depth
 * limit — each entry in the returned path renders one more column.
 */
export function togglePathAt(openPath: string[], depth: number, id: string): string[] {
  if (openPath[depth] === id) return openPath.slice(0, depth)
  return [...openPath.slice(0, depth), id]
}

export function navHighlight(
  item: Pick<MenuItem, 'id' | 'type'>,
  ctx: { activeRouteId: string | null; activeAncestors: Set<string>; openIds: Set<string> },
): NavHighlight {
  if (item.type !== 'container') return item.id === ctx.activeRouteId ? 'active' : 'none'
  if (ctx.activeAncestors.has(item.id)) return 'active'
  return ctx.openIds.has(item.id) ? 'open' : 'none'
}
