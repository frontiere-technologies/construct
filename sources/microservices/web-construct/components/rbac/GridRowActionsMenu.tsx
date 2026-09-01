'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/context/I18nContext'

export interface RowMenuItem { label: string; onClick: () => void; disabled?: boolean }

export interface GridRowActionsMenuParams<T> extends ICellRendererParams<T> {
  getItems: (data: T) => RowMenuItem[]
}

/**
 * The row-actions column, shared by every grid: always the first column and always
 * pinned left, so it stays visible while the other columns scroll horizontally.
 * `lockPinned` + `lockPosition` keep it there even if a user drags columns around.
 */
export function actionsColumnDef<T>(getItems: (data: T) => RowMenuItem[], headerTooltip?: string): ColDef<T> {
  return {
    colId: 'actions',
    headerName: '',
    headerTooltip,
    pinned: 'left',
    lockPinned: true,
    lockPosition: 'left',
    suppressMovable: true,
    sortable: false,
    filter: false,
    resizable: false,
    width: 56,
    cellRenderer: GridRowActionsMenu,
    cellRendererParams: { getItems },
  }
}

export default function GridRowActionsMenu<T>(params: GridRowActionsMenuParams<T>) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => { setOpen(false); setPos(null) }, [])

  useEffect(() => {
    if (!open) return
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      close()
    }
    document.addEventListener('mousedown', handleOutside)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  if (!params.data) return null
  const rowId = params.node.id ?? ''
  const items = params.getItems(params.data)

  return (
    // `data-grid-no-row-click` is read by DataGrid's onRowClicked wrapper (via .closest())
    // to exclude this actions column from row-click navigation. React's stopPropagation()
    // below only stops the React synthetic event chain — it doesn't stop AG Grid's own
    // native row-click listener, which is attached directly to the DOM outside React.
    <div className="flex h-full items-center justify-center" data-grid-no-row-click onClick={e => e.stopPropagation()}>
      <Button
        variant="ghost" size="icon"
        data-testid={`row-menu-${rowId}`}
        aria-label={t('common.actions.row_actions')}
        // No `aria-haspopup`. Every value the attribute accepts — `menu`,
        // `listbox`, `tree`, `grid`, `dialog`, and `true` (a legacy synonym
        // ARIA 1.0 defines as identical to `menu`, exposed the same way in
        // the accessibility API and announced the same way by screen readers)
        // — promises a specific widget contract. What opens below is a plain
        // list of buttons: no role="menu"/"menuitem", no arrow-key roving
        // focus, no Home/End, no typeahead. None of the accepted values
        // describes it honestly, so the accurate move is to say nothing
        // rather than pick the least-wrong option — an earlier pass here
        // swapped "menu" for "true" believing that claimed less, which is
        // false: the two are specified to be indistinguishable to AT, so
        // that swap was a relabelling, not a fix.
        // `aria-expanded` below carries the part that *is* real: whether the
        // popup is currently open. Implementing the ARIA menu pattern
        // properly — the roles above plus the keyboard navigation they
        // imply — is a separate piece of work, left undone deliberately
        // rather than half-done.
        aria-expanded={open}
        onClick={e => {
          if (open) { close(); return }
          const rect = e.currentTarget.getBoundingClientRect()
          // Opens rightwards from the button (the actions column is pinned to the
          // left edge, so the space is always on that side).
          setPos({ top: rect.bottom + 4, left: rect.left })
          setOpen(true)
        }}
      >
        <MoreHorizontal size={16} />
      </Button>
      {open && pos && createPortal(
        // min-w-40 + max-w-xs, not the flat w-40 this used to be. Labels are
        // authored in Admin -> Translations, so their length is a translator's
        // choice, not ours: "Set as default" is "Imposta come predefinita" in
        // Italian and can be longer elsewhere. A fixed box made every such label
        // spill out of the popup, because buttonVariants puts `whitespace-nowrap`
        // on every Button and nothing clipped the overflow. Now the popup keeps
        // its old width as a floor, grows for a longer translation, and only past
        // the ceiling does the label ellipse.
        // flex-col, and the items no longer carry `w-full`. A percentage width on
        // the children is treated as auto while the parent's intrinsic width is
        // being resolved, which inflated the shrink-to-fit result: measured 336px
        // of "natural" width for labels that need ~130px, so the box hit the
        // ceiling on every menu. In a column flex the parent's max-content is
        // simply the widest item, and `align-items: stretch` still gives each
        // button the full width of the box.
        // I bottoni non portano nessun `min-w-0`, e non e' una svista: la
        // dimensione minima automatica vale sull'asse principale, che in un
        // flex `column` e' quello verticale, quindi `min-width: auto` su queste
        // voci non e' mai stato in gioco. A troncare sono la larghezza del
        // contenitore qui sopra e lo `span` `min-w-0 truncate` la' sotto, che
        // e' un figlio flex del Button (inline-flex, asse orizzontale) e li'
        // invece la regola c'e' davvero.
        <div ref={menuRef} style={{ top: pos.top, left: pos.left }} className="fixed z-50 flex flex-col min-w-40 max-w-xs p-1 rounded-lg border border-border bg-popover shadow-lg">
          {items.map(item => (
            <Button
              key={item.label}
              variant="ghost"
              size="sm"
              className="justify-start text-left"
              disabled={item.disabled}
              onClick={() => { close(); item.onClick() }}
            >
              {/* The label needs its own box: Button is `inline-flex`, so a bare
                  text child becomes an anonymous flex item and text-overflow
                  never applies to it — `truncate` on the Button would do nothing. */}
              <span className="min-w-0 truncate">{item.label}</span>
            </Button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
