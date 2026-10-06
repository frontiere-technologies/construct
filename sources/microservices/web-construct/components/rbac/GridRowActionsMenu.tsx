'use client'

import { MoreHorizontal } from 'lucide-react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

  if (!params.data) return null
  const rowId = params.node.id ?? ''
  const items = params.getItems(params.data)

  return (
    // `data-grid-no-row-click` is read by DataGrid's onRowClicked wrapper (via .closest())
    // to exclude this actions column from row-click navigation. React's stopPropagation()
    // below only stops the React synthetic event chain — it doesn't stop AG Grid's own
    // native row-click listener, which is attached directly to the DOM outside React.
    <div className="flex h-full items-center justify-center" data-grid-no-row-click onClick={e => e.stopPropagation()}>
      <DropdownMenu>
        {/*
          `asChild` so the trigger stays this project's Button primitive rather than
          becoming a second, differently-styled button.

          This used to carry a long comment explaining why it had no `aria-haspopup`:
          what opened below was a plain list of buttons, and every value the attribute
          accepts promises a real menu widget — roles, arrow-key roving focus, Home/End,
          typeahead — so saying nothing was more honest than picking the least-wrong
          value. That reasoning is spent. What opens below IS a menu now, so Radix sets
          `aria-haspopup="menu"` and `aria-expanded` itself and both are finally true.
        */}
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost" size="icon"
            data-testid={`row-menu-${rowId}`}
            aria-label={t('common.actions.row_actions')}
          >
            <MoreHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        {/*
          `align="start"`: the actions column is pinned to the left edge, so the space
          is always on that side. Radix flips it on its own when it isn't.

          min-w-40 + max-w-xs, not the flat w-40 this used to be, and not the stock
          `min-w-[8rem]` either (twMerge keeps the last `min-w-*`). Labels are authored
          in Admin -> Translations, so their length is a translator's choice, not ours:
          "Set as default" is "Imposta come predefinita" in Italian and can be longer
          elsewhere. A fixed box made every such label spill out of the popup, because
          buttonVariants puts `whitespace-nowrap` on every Button and nothing clipped
          the overflow. The popup keeps its old width as a floor, grows for a longer
          translation, and only past the ceiling does the label ellipse.
        */}
        <DropdownMenuContent align="start" className="min-w-40 max-w-xs">
          {items.map(item => (
            <DropdownMenuItem
              key={item.label}
              disabled={item.disabled}
              onSelect={item.onClick}
            >
              {/* The label needs its own box: the item is a flex row, so a bare text
                  child becomes an anonymous flex item and text-overflow never applies
                  to it — `truncate` on the item itself would do nothing. `min-w-0`
                  because that box is a flex child on the horizontal axis, where the
                  automatic minimum size would otherwise refuse to shrink. */}
              <span className="min-w-0 truncate">{item.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
