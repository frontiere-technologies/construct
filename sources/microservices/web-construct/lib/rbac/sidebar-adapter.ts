import type { MenuItem, MenuPosition } from '@/types/menu'
import { type MenuEntryRow, type Locale, DEFAULT_LOCALE, FUNCTYPE_EMBEDDED_PAGE, FUNCTYPE_EXTERNAL_LINK } from './types'
import { resolveNavigationText } from './navigation-locales'

/** Presenza della riga = concessione (DEC-7): non c'è un flag da leggere. L'oggetto della
 *  concessione è la VOCE, non un permesso gemello (DEC-17). */
export function resolveGrantedFunctionalityIds(
  roleFunctionalities: { id_role: number; id_menu_entry: number }[],
  roleIds: number[],
): Set<number> {
  const roleSet = new Set(roleIds)
  const ids = new Set<number>()
  for (const rf of roleFunctionalities) if (roleSet.has(rf.id_role)) ids.add(rf.id_menu_entry)
  return ids
}

/**
 * Una funzionalità si vede solo se concessa (DEC-18). Il ramo «id_permission nullo = voce
 * pubblica» è sparito con la colonna: era l'ultimo residuo di
 * `no_permission_need_for_navigation`, e nessuna riga dei dati reali lo usava. Un contenitore
 * non passa da qui — lo mostra `resolveVisibleIds` risalendo dai figli visibili.
 */
function isEntryVisible(entry: MenuEntryRow, grantedIds: Set<number>): boolean {
  return grantedIds.has(entry.id_menu_entry)
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

/**
 * `entries` deve essere la tabella menu_entry INTERA, non una pagina né un
 * sottoinsieme filtrato.
 *
 * Non è una preferenza: il filtro finale che scartava le voci senza genitore emesso è
 * stato rimosso perché la catena degli antenati è sempre risolvibile dentro `entries`
 * (la spiegazione completa è in fondo alla funzione). Su un insieme parziale quella
 * garanzia cade, e la funzione emetterebbe in silenzio voci orfane invece di scartarle.
 * L'unico chiamante di oggi, `getSidebarMenu` in navigation-service.ts, legge la tabella
 * senza where; chi ne aggiunge un altro deve fare lo stesso o rimettere il filtro.
 */
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
