import { DARK_PALETTE, LIGHT_PALETTE, type DerivedPrimary, type PaletteToken, type PrimaryPair } from '@/lib/theme-vars'

export interface PalettePreviewLabels {
  light: string
  dark: string
  primary: string
  hover: string
  surface: string
  background: string
  sidebar: string
}

interface Cell {
  key: 'primary' | 'hover' | 'surface' | 'background' | 'sidebar'
  bg: string
  fg: string
}

function cells(pair: PrimaryPair, palette: Record<PaletteToken, string>): Cell[] {
  return [
    { key: 'primary', bg: pair.primary, fg: pair.foreground },
    { key: 'hover', bg: palette.accent, fg: palette.foreground },
    { key: 'surface', bg: palette.card, fg: palette.foreground },
    { key: 'background', bg: palette.background, fg: palette.foreground },
    { key: 'sidebar', bg: palette.sidebar, fg: palette['sidebar-foreground'] },
  ]
}

/**
 * L'anteprima della tavolozza nei due modi (specifica §6.1). I colori sono quelli
 * veri, calcolati o fissi, non i token: la striscia «Scuro» deve mostrare il modo
 * scuro anche mentre la pagina e' in chiaro.
 */
export function PalettePreview({ derived, labels }: { derived: DerivedPrimary; labels: PalettePreviewLabels }) {
  const rows = [
    { key: 'light', title: labels.light, cells: cells(derived.light, LIGHT_PALETTE) },
    { key: 'dark', title: labels.dark, cells: cells(derived.dark, DARK_PALETTE) },
  ]
  return (
    <div className="space-y-3">
      {rows.map(row => (
        <div key={row.key} data-testid={`theme-preview-${row.key}`}>
          <p className="mb-1 text-xs text-muted-foreground">{row.title}</p>
          <div className="flex overflow-hidden rounded-lg border border-border text-xs font-medium">
            {row.cells.map(cell => (
              <div
                key={cell.key}
                data-testid={`theme-preview-${row.key}-${cell.key}`}
                className="flex h-12 min-w-0 flex-1 items-center justify-center truncate px-1"
                style={{ backgroundColor: cell.bg, color: cell.fg }}
              >
                {labels[cell.key]}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
