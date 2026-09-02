import type { MenuItem, MenuPosition } from '@/types/menu'
import { type MenuEntryRow, type Locale, DEFAULT_LOCALE, FUNCTYPE_EMBEDDED_PAGE, FUNCTYPE_EXTERNAL_LINK } from './types'
import { resolveNavigationText } from './navigation-locales'

/** Presenza della riga = concessione (DEC-7): non c'è più un flag da leggere. */
export function resolveGrantedPermissionIds(
  rolePermissions: { id_role: number; id_permission: number }[],
  roleIds: number[],
): Set<number> {
  const roleSet = new Set(roleIds)
  const ids = new Set<number>()
  for (const rp of rolePermissions) if (roleSet.has(rp.id_role)) ids.add(rp.id_permission)
  return ids
}

/** id_permission nullo = voce pubblica. Sostituisce no_permission_need_for_navigation. */
function isEntryVisible(entry: MenuEntryRow, grantedIds: Set<number>): boolean {
  return entry.id_permission === null || grantedIds.has(entry.id_permission)
}

function normalizeRoute(link: string | null): string | undefined {
  if (!link) return undefined
  if (link.startsWith('/') || link.startsWith('http')) return link
  return '/' + link
}

/**
 * Una categoria è un contenitore: si mostra se contiene qualcosa di visibile, non se ha una
 * concessione propria — non ne ha mai avuta una che contasse qui (vedi sotto). La risalita
 * dai figli visibili ai genitori resta: è lei che fa apparire il contenitore, non un controllo
 * su di lui. Quello che sparisce è solo la parte che *cercava concessioni sui genitori*: prima
 * (navigation_item) categoria e permesso erano la stessa riga e isRenderable/isUnderOperations
 * dovevano filtrare, riga per riga, anche i genitori attraversati dalla risalita (radice,
 * Operations, i FUNCTYPE_PERMISSION, il config_visibility). Quei filtri non servono più non
 * perché la risalita sia sparita, ma perché il travaso (migrazione 0017+0018) ha già escluso
 * quelle righe da menu_entry: chi arriva fin qui è già un genitore legittimo.
 */
function resolveVisibleIds(entries: MenuEntryRow[], grantedIds: Set<number>): Set<number> {
  const byId = new Map(entries.map(e => [e.id_menu_entry, e]))
  const visible = new Set<number>()
  for (const entry of entries) {
    const isContainer = entry.id_functionality_type === null
    if (isContainer || !isEntryVisible(entry, grantedIds)) continue
    visible.add(entry.id_menu_entry)
    let parent = entry.id_parent != null ? byId.get(entry.id_parent) : undefined
    while (parent && !visible.has(parent.id_menu_entry)) {
      visible.add(parent.id_menu_entry)
      parent = parent.id_parent != null ? byId.get(parent.id_parent) : undefined
    }
  }
  return visible
}

export function mapMenuToSidebar(
  entries: MenuEntryRow[],
  grantedIds: Set<number>,
  locale: Locale = DEFAULT_LOCALE,
  fallbackLocale: Locale = DEFAULT_LOCALE,
): MenuItem[] {
  const visible = resolveVisibleIds(entries, grantedIds)
  const out: MenuItem[] = []
  for (const entry of entries) {
    if (!visible.has(entry.id_menu_entry)) continue
    const isContainer = entry.id_functionality_type === null
    const position: MenuPosition =
      entry.navbar_position === 'TOP' ? 'top' : entry.navbar_position === 'BOTTOM' ? 'bottom' : 'main'
    out.push({
      id: String(entry.id_menu_entry),
      label: resolveNavigationText(entry.item_translation, 'name', locale, fallbackLocale, entry.name),
      icon: entry.icon_path ?? undefined,
      route: isContainer
        ? undefined
        : entry.id_functionality_type === FUNCTYPE_EMBEDDED_PAGE
          ? `/embedded/${entry.id_menu_entry}`
          : normalizeRoute(entry.functionality_link),
      type: isContainer ? 'container' : 'link',
      // Only an external URL can leave the app, so only it carries a tab preference.
      target: entry.id_functionality_type === FUNCTYPE_EXTERNAL_LINK
        ? (entry.open_in_new_tab === 0 ? '_self' : '_blank')
        : undefined,
      parentId: entry.id_parent == null ? null : String(entry.id_parent),
      order: entry.order_position,
      visible: true,
      active: true,
      position,
      collapsible: isContainer ? true : undefined,
      system: entry.is_immutable === 1,
    })
  }
  // Non serve più filtrare per genitore emesso: `resolveVisibleIds` aggiunge sempre l'intera
  // catena di antenati di ogni voce visibile (il while sopra), e ogni antenato così aggiunto
  // è per costruzione un'entry che compare in `entries` (ci arriva da `byId`, costruita su
  // `entries` stessa) — quindi anche lui passa il primo `if` di questo ciclo e finisce in
  // `out`. L'unico modo perché un genitore restasse fuori da `out` sarebbe un id_parent che
  // non referenzia nessuna riga di `entries`, ma menu_entry.id_parent ha una FK verso
  // menu_entry.id_menu_entry (schema.ts) e l'unico chiamante reale (getSidebarMenu, in
  // navigation-service.ts) legge la tabella per intero, senza filtri — quindi quel caso non
  // si presenta mai sui dati veri. Un filtro che verificato così non scarta mai nulla era
  // rumore, non difesa.
  return out
}
