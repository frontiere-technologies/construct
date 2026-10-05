import { cn } from '@/lib/utils'
import {
  effectivePalette, themePrimary,
  type AppTheme, type PaletteMode, type SurfaceKey,
} from '@/lib/theme-vars'

export interface PalettePreviewLabels {
  light: string
  dark: string
  primary: string
  hover: string
  surface: string
  background: string
  sidebar: string
  /** Il modo dentro una frase, in minuscolo: «chiaro», «scuro». */
  modeLight: string
  modeDark: string
  /** Il suggerimento sul segno di una superficie cambiata. */
  customised: string
  /** Il nome accessibile di una cella. */
  cellName: (cell: { surface: string; mode: string; color: string; customised: boolean }) => string
}

/** Cio' che il pannello di scelta sotto l'anteprima sta cambiando. */
export type ThemeTarget =
  | { kind: 'primary'; mode: PaletteMode }
  | { kind: 'surface'; mode: PaletteMode; key: SurfaceKey }

/** La cella selezionata all'apertura: il colore principale del modo chiaro. */
export const PRIMARY_TARGET: ThemeTarget = { kind: 'primary', mode: 'light' }

/** Ogni cella e' un bersaglio a se': le due «Principale» hanno ciascuna il proprio colore (DEC-10). */
export function sameTarget(a: ThemeTarget, b: ThemeTarget): boolean {
  if (a.kind !== b.kind || a.mode !== b.mode) return false
  return a.kind === 'primary' || (b.kind === 'surface' && a.key === b.key)
}

/** L'etichetta di cella di ogni superficie, nell'ordine della striscia. */
const SURFACE_CELLS: { key: SurfaceKey; label: 'hover' | 'surface' | 'background' | 'sidebar' }[] = [
  { key: 'accent', label: 'hover' },
  { key: 'card', label: 'surface' },
  { key: 'background', label: 'background' },
  { key: 'sidebar', label: 'sidebar' },
]

interface Cell {
  testId: string
  target: ThemeTarget
  label: string
  bg: string
  fg: string
  customised: boolean
}

/** Celle separate, ognuna con i suoi angoli e un bordo sottile sempre visibile. */
const cellCls = 'relative flex h-12 min-w-0 flex-1 items-center justify-center truncate rounded-md border border-border px-1'

/**
 * La cella selezionata: lo stesso segno della voce attiva della sidebar, un anello
 * del colore principale, ma fuori dalla cella e staccato di 2px, cosi' si vede
 * anche sulla cella «Principale». Il fuoco da tastiera e' un contorno interno,
 * perche' l'anello e' gia' preso dalla selezione e i due devono convivere.
 */
const selectedCls = 'ring-2 ring-primary ring-offset-2 ring-offset-card'

/**
 * Gli stili globali dei bottoni (`globals.css`, `@layer base`) alzano e
 * schiariscono un bottone al passaggio e lo sbiadiscono quando e' disattivato:
 * su una cella che mostra un colore vorrebbe dire mostrarne un altro, e
 * spostarla dentro la striscia. Qui si spengono; da disattivata resta il cursore.
 */
const buttonCls = cn(
  cellCls,
  'focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring',
  'enabled:hover:transform-none enabled:hover:filter-none disabled:filter-none',
)

interface PalettePreviewProps {
  theme: AppTheme
  labels: PalettePreviewLabels
  disabled?: boolean
  /** La cella selezionata; con piu' celle per lo stesso bersaglio, tutte. */
  selected?: ThemeTarget
  /** Senza, l'anteprima e' in sola lettura. */
  onSelect?: (target: ThemeTarget) => void
}

/**
 * L'anteprima della tavolozza nei due modi (specifica §6.1). I colori sono quelli
 * veri, calcolati o scelti, non i token: la striscia «Scuro» deve mostrare il modo
 * scuro anche mentre la pagina e' in chiaro.
 *
 * Con `onSelect` ogni cella e' un bottone a due stati (`aria-pressed`) che
 * sceglie cosa cambiare nel pannello sotto: il colore principale di un modo,
 * oppure una superficie di un modo. Una sola cella e' selezionata alla volta, e
 * porta l'anello del colore principale (`selectedCls`).
 */
export function PalettePreview({ theme, labels, disabled, selected, onSelect }: PalettePreviewProps) {
  const primary = themePrimary(theme)
  const rows = (['light', 'dark'] as const).map(mode => {
    const palette = effectivePalette(mode, theme.surfaces[mode])
    const cells: Cell[] = [
      {
        testId: `theme-cell-primary-${mode}`, target: { kind: 'primary', mode }, label: labels.primary,
        bg: primary[mode].primary, fg: primary[mode].foreground,
        // Solo lo scuro puo' essere scelto a parte; il chiaro e' sempre «il» colore principale.
        customised: mode === 'dark' && typeof theme.primaryDark === 'string',
      },
      ...SURFACE_CELLS.map(({ key, label }) => ({
        testId: `theme-cell-${mode}-${key}`,
        target: { kind: 'surface', mode, key } as ThemeTarget,
        label: labels[label],
        bg: palette[key],
        fg: key === 'sidebar' ? palette['sidebar-foreground'] : palette.foreground,
        customised: theme.surfaces[mode][key] !== undefined,
      })),
    ]
    return {
      mode,
      title: mode === 'light' ? labels.light : labels.dark,
      modeName: mode === 'light' ? labels.modeLight : labels.modeDark,
      cells,
    }
  })
  return (
    <div className="space-y-3">
      {rows.map(row => (
        <div key={row.mode} data-testid={`theme-preview-${row.mode}`}>
          <p className="mb-1 text-xs text-muted-foreground">{row.title}</p>
          {/* Niente overflow-hidden e un po' di spazio intorno: l'anello della selezione sta fuori dalla cella. */}
          <div className="flex gap-2 p-1 text-xs font-medium">
            {row.cells.map(cell => {
              const marker = cell.customised && (
                <span
                  aria-hidden="true"
                  title={labels.customised}
                  data-testid={`${cell.testId}-marker`}
                  className="absolute right-1 top-1 h-2 w-2 rounded-full"
                  style={{ backgroundColor: cell.fg }}
                />
              )
              if (!onSelect) {
                return (
                  <div key={cell.testId} data-testid={cell.testId} className={cellCls} style={{ backgroundColor: cell.bg, color: cell.fg }}>
                    {cell.label}
                    {marker}
                  </div>
                )
              }
              const isSelected = selected !== undefined && sameTarget(selected, cell.target)
              const name = labels.cellName({ surface: cell.label, mode: row.modeName, color: cell.bg, customised: cell.customised })
              return (
                <button
                  key={cell.testId}
                  type="button"
                  data-testid={cell.testId}
                  aria-pressed={isSelected}
                  aria-label={name}
                  title={name}
                  disabled={disabled}
                  onClick={() => onSelect(cell.target)}
                  className={cn(buttonCls, isSelected && selectedCls)}
                  style={{ backgroundColor: cell.bg, color: cell.fg }}
                >
                  {cell.label}
                  {marker}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
